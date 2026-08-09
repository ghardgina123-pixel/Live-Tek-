-- ============================================================
-- 1) RATE LIMITING GENÉRICO
-- ============================================================
CREATE OR REPLACE FUNCTION public.rate_limit_hit(
  _key text, _max_attempts int, _window_minutes int, _block_minutes int
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record; v_until timestamptz;
BEGIN
  SELECT blocked_until INTO v_until FROM public.login_attempts
   WHERE key = _key AND blocked_until IS NOT NULL AND blocked_until > now();
  IF v_until IS NOT NULL THEN
    RETURN jsonb_build_object('blocked', true,
      'retry_after_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_until - now())))::int));
  END IF;

  INSERT INTO public.login_attempts (key, attempts, first_attempt_at, last_attempt_at)
  VALUES (_key, 1, now(), now())
  ON CONFLICT (key) DO UPDATE
    SET attempts = CASE WHEN public.login_attempts.first_attempt_at < now() - make_interval(mins => _window_minutes)
          THEN 1 ELSE public.login_attempts.attempts + 1 END,
        first_attempt_at = CASE WHEN public.login_attempts.first_attempt_at < now() - make_interval(mins => _window_minutes)
          THEN now() ELSE public.login_attempts.first_attempt_at END,
        last_attempt_at = now(),
        blocked_until = NULL
  RETURNING * INTO v_row;

  IF v_row.attempts > _max_attempts THEN
    UPDATE public.login_attempts
       SET blocked_until = now() + make_interval(mins => _block_minutes), attempts = 0, first_attempt_at = now()
     WHERE key = _key RETURNING blocked_until INTO v_until;
    RETURN jsonb_build_object('blocked', true,
      'retry_after_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_until - now())))::int));
  END IF;

  RETURN jsonb_build_object('blocked', false, 'retry_after_seconds', 0);
END; $$;

REVOKE ALL ON FUNCTION public.rate_limit_hit(text,int,int,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_hit(text,int,int,int) TO service_role;

-- Trigger genérico: TG_ARGV = prefixo, max, janela(min), bloqueio(min)
CREATE OR REPLACE FUNCTION public.enforce_rate_limit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb; v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN NEW; END IF; -- chamadas server_role/cron não são limitadas
  v := public.rate_limit_hit(TG_ARGV[0] || ':' || v_uid::text,
        TG_ARGV[1]::int, TG_ARGV[2]::int, TG_ARGV[3]::int);
  IF (v->>'blocked')::boolean THEN
    RAISE EXCEPTION 'rate_limited: tente novamente em % segundos', v->>'retry_after_seconds'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.enforce_rate_limit() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS rl_messages ON public.messages;
CREATE TRIGGER rl_messages BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('msg', '30', '1', '5');

DROP TRIGGER IF EXISTS rl_live_messages ON public.live_messages;
CREATE TRIGGER rl_live_messages BEFORE INSERT ON public.live_messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('livemsg', '20', '1', '5');

DROP TRIGGER IF EXISTS rl_conversations ON public.conversations;
CREATE TRIGGER rl_conversations BEFORE INSERT ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('conv', '20', '60', '30');

DROP TRIGGER IF EXISTS rl_orders ON public.orders;
CREATE TRIGGER rl_orders BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('order', '15', '60', '60');

DROP TRIGGER IF EXISTS rl_payment_intents ON public.payment_intents;
CREATE TRIGGER rl_payment_intents BEFORE INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('payintent', '20', '60', '30');

DROP TRIGGER IF EXISTS rl_store_subscriptions ON public.store_subscriptions;
CREATE TRIGGER rl_store_subscriptions BEFORE INSERT ON public.store_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('sub', '10', '60', '60');

DROP TRIGGER IF EXISTS rl_property_visit_requests ON public.property_visit_requests;
CREATE TRIGGER rl_property_visit_requests BEFORE INSERT ON public.property_visit_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('visit', '20', '60', '60');

DROP TRIGGER IF EXISTS rl_payout_requests ON public.payout_requests;
CREATE TRIGGER rl_payout_requests BEFORE INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_rate_limit('payout', '5', '1440', '1440');

-- ============================================================
-- 2) PAYMENT INTENTS — valores sempre calculados no servidor
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_payment_intent_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; split jsonb;
BEGIN
  SELECT id, customer_id, store_id, total_aoa, status INTO o
    FROM public.orders WHERE id = NEW.order_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  IF auth.uid() IS NOT NULL THEN
    IF o.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    IF o.status <> 'pending'::order_status THEN RAISE EXCEPTION 'order_not_payable'; END IF;
    NEW.status := 'pending';
  END IF;

  split := public.calc_transaction_split(o.store_id, o.total_aoa);
  NEW.amount_aoa       := (split->>'gross_aoa')::numeric;
  NEW.commission_pct   := (split->>'commission_pct')::numeric;
  NEW.platform_fee_aoa := (split->>'platform_fee_aoa')::numeric;
  NEW.store_amount_aoa := (split->>'net_aoa')::numeric;
  IF NEW.reference IS NULL OR length(trim(NEW.reference)) = 0 THEN
    NEW.reference := 'LM-' || upper(left(replace(o.id::text,'-',''), 8)) || '-' || to_char(now(),'YYYYMMDDHH24MISS');
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payment_intent_integrity ON public.payment_intents;
CREATE TRIGGER payment_intent_integrity BEFORE INSERT ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_intent_integrity();

CREATE OR REPLACE FUNCTION public.guard_payment_intent_update() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'payment_intent_immutable';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS payment_intent_guard_update ON public.payment_intents;
CREATE TRIGGER payment_intent_guard_update BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_intent_update();

-- ============================================================
-- 3) STORE SUBSCRIPTIONS — plano/preço definidos pelo servidor
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_subscription_integrity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; is_admin boolean := public.has_role(auth.uid(), 'admin'::app_role);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO p FROM public.subscription_plans WHERE code = NEW.plan AND is_active = true;
    IF p.id IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;
    NEW.price_aoa := p.price_aoa;
    IF auth.uid() IS NOT NULL AND NOT is_admin THEN
      NEW.status := 'pending';
      NEW.started_at := NULL; NEW.expires_at := NULL; NEW.grace_until := NULL;
      NEW.cancelled_at := NULL; NEW.external_id := NULL; NEW.raw_payload := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND NOT is_admin THEN
    NEW.plan := OLD.plan;
    NEW.price_aoa := OLD.price_aoa;
    NEW.status := OLD.status;
    NEW.started_at := OLD.started_at;
    NEW.expires_at := OLD.expires_at;
    NEW.grace_until := OLD.grace_until;
    NEW.external_id := OLD.external_id;
    NEW.raw_payload := OLD.raw_payload;
    NEW.reference := OLD.reference;
    NEW.store_id := OLD.store_id;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS subscription_integrity ON public.store_subscriptions;
CREATE TRIGGER subscription_integrity BEFORE INSERT OR UPDATE ON public.store_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_integrity();

-- ============================================================
-- 4) REALTIME — scoping de tópicos privados
-- ============================================================
CREATE OR REPLACE FUNCTION public.can_access_realtime_topic(_topic text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); v_id text;
BEGIN
  IF uid IS NULL OR _topic IS NULL THEN RETURN false; END IF;

  -- tópicos pessoais: notif-<uid> / notify-<uid>
  IF _topic = 'notif-' || uid::text OR _topic = 'notify-' || uid::text THEN RETURN true; END IF;

  -- painéis de gestão: apenas admin
  IF _topic LIKE 'admin-%' THEN RETURN public.has_role(uid, 'admin'::app_role); END IF;

  -- conversas privadas: conv-<id> / chat-presence-<id>
  IF _topic LIKE 'conv-%' OR _topic LIKE 'chat-presence-%' THEN
    v_id := regexp_replace(_topic, '^(conv-|chat-presence-)', '');
    IF v_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN _topic = 'conv-list'; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.conversations c
      LEFT JOIN public.stores s ON s.id = c.store_id
      WHERE c.id = v_id::uuid AND (c.customer_id = uid OR s.owner_id = uid));
  END IF;

  -- painel do lojista / subscrições da loja
  IF _topic LIKE 'lojista-lives-%' OR _topic LIKE 'store-subs-%' THEN
    v_id := regexp_replace(_topic, '^(lojista-lives-|store-subs-)', '');
    IF v_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM public.stores s WHERE s.id = v_id::uuid AND s.owner_id = uid)
        OR public.has_role(uid, 'admin'::app_role);
  END IF;

  -- rastreio de entrega: apenas participantes
  IF _topic LIKE 'track-%' THEN
    v_id := regexp_replace(_topic, '^track-', '');
    IF v_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
    RETURN public.is_delivery_participant(v_id::uuid, uid);
  END IF;

  -- lives públicas (chat/câmaras) e listagem pública
  IF _topic LIKE 'live-%' OR _topic LIKE 'live-cam-%' OR _topic = 'home-lives' THEN RETURN true; END IF;

  -- painel de produção da live: dono da loja da live ou admin
  IF _topic LIKE 'lojista-live-%' OR _topic LIKE 'live-events-%' THEN
    v_id := regexp_replace(_topic, '^(lojista-live-|live-events-)', '');
    IF v_id !~ '^[0-9a-fA-F-]{36}$' THEN RETURN false; END IF;
    RETURN EXISTS (
      SELECT 1 FROM public.lives l JOIN public.stores s ON s.id = l.store_id
      WHERE l.id = v_id::uuid AND s.owner_id = uid)
      OR public.has_role(uid, 'admin'::app_role);
  END IF;

  RETURN false;
END; $$;

GRANT EXECUTE ON FUNCTION public.can_access_realtime_topic(text) TO authenticated;
REVOKE ALL ON FUNCTION public.can_access_realtime_topic(text) FROM anon;

DROP POLICY IF EXISTS "authenticated_can_subscribe" ON realtime.messages;
DROP POLICY IF EXISTS "realtime_scoped_subscribe" ON realtime.messages;
DROP POLICY IF EXISTS "realtime_scoped_write" ON realtime.messages;

CREATE POLICY "realtime_scoped_subscribe" ON realtime.messages
  FOR SELECT TO authenticated
  USING (public.can_access_realtime_topic((realtime.topic())::text));

CREATE POLICY "realtime_scoped_write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_realtime_topic((realtime.topic())::text));