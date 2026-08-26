-- 1) Campos de verificação
ALTER TABLE public.store_subscriptions
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_source text;

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_source text;

-- Origens de verificação aceitas (apenas webhooks reais do gateway)
CREATE OR REPLACE FUNCTION public.is_trusted_payment_source(_source text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT _source IN (
    'multicaixa_express_webhook',
    'multicaixa_express_subscription_webhook'
  );
$$;
REVOKE ALL ON FUNCTION public.is_trusted_payment_source(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_trusted_payment_source(text) TO authenticated, service_role;

-- 2) Activação de subscrição exige confirmação real do gateway
CREATE OR REPLACE FUNCTION public.activate_subscription_by_reference(
  _reference text,
  _external_id text DEFAULT NULL::text,
  _payload jsonb DEFAULT NULL::jsonb,
  _verified_source text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sub record; v_days int; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_sub FROM public.store_subscriptions WHERE reference = _reference;
  IF v_sub.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  -- idempotência: já activa e verificada
  IF v_sub.status = 'active' AND v_sub.verified_at IS NOT NULL
     AND (v_sub.expires_at IS NULL OR v_sub.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', true);
  END IF;

  -- sem confirmação legítima do gateway nada é considerado pago
  IF NOT public.is_trusted_payment_source(_verified_source) THEN
    UPDATE public.store_subscriptions
       SET status = CASE WHEN status = 'active' THEN status ELSE 'pending_verification' END,
           raw_payload = COALESCE(_payload, raw_payload),
           updated_at = v_now
     WHERE id = v_sub.id;
    RETURN jsonb_build_object('ok', false, 'reason', 'gateway_confirmation_required',
                              'subscription_id', v_sub.id, 'status', 'pending_verification');
  END IF;

  SELECT COALESCE(period_days, 30) INTO v_days FROM public.subscription_plans WHERE code = v_sub.plan;

  UPDATE public.store_subscriptions
     SET status = 'active',
         started_at = COALESCE(started_at, v_now),
         expires_at = GREATEST(COALESCE(expires_at, v_now), v_now) + make_interval(days => COALESCE(v_days, 30)),
         grace_until = NULL,
         external_id = COALESCE(_external_id, external_id),
         raw_payload = COALESCE(_payload, raw_payload),
         verified_at = COALESCE(verified_at, v_now),
         verified_source = _verified_source,
         rejection_reason = NULL, cancelled_at = NULL, cancel_reason = NULL, updated_at = v_now
   WHERE id = v_sub.id;

  INSERT INTO public.subscription_payments (subscription_id, store_id, amount_aoa, method, reference, external_id, status, raw_payload, paid_at)
  VALUES (v_sub.id, v_sub.store_id, v_sub.price_aoa, v_sub.payment_method, v_sub.reference, _external_id, 'paid', _payload, v_now)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', false);
END; $function$;

REVOKE ALL ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb, text) TO service_role;

-- 3) Admin não pode fabricar confirmação
CREATE OR REPLACE FUNCTION public.admin_reprocess_subscription(_reference text, _approve boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_sub record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT * INTO v_sub FROM public.store_subscriptions WHERE reference = _reference;
  IF v_sub.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF _approve THEN
    -- só é possível reprocessar um payload já validado pelo gateway
    IF v_sub.verified_at IS NULL OR NOT public.is_trusted_payment_source(v_sub.verified_source) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'gateway_confirmation_required',
                                'subscription_id', v_sub.id, 'status', v_sub.status);
    END IF;
    RETURN public.activate_subscription_by_reference(
      _reference, v_sub.external_id,
      COALESCE(v_sub.raw_payload, '{}'::jsonb) || jsonb_build_object('reprocessed_by', auth.uid(), 'reprocessed_at', now()),
      v_sub.verified_source);
  END IF;

  RETURN public.reject_subscription_by_reference(_reference, 'rejected',
    jsonb_build_object('source', 'admin_reprocess', 'at', now(), 'admin', auth.uid()));
END; $function$;

-- 4) Confirmação verificada de intenção de pagamento + encomenda (só webhook)
CREATE OR REPLACE FUNCTION public.confirm_payment_intent_by_reference(
  _reference text,
  _verified_source text,
  _external_id text DEFAULT NULL,
  _payload jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pi record; v_now timestamptz := now();
BEGIN
  IF NOT public.is_trusted_payment_source(_verified_source) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'gateway_confirmation_required');
  END IF;

  SELECT * INTO v_pi FROM public.payment_intents WHERE reference = _reference;
  IF v_pi.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF v_pi.status = 'paid' AND v_pi.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'order_id', v_pi.order_id, 'idempotent', true);
  END IF;

  UPDATE public.payment_intents
     SET status = 'paid',
         external_id = COALESCE(_external_id, external_id),
         raw_payload = COALESCE(_payload, raw_payload),
         verified_at = COALESCE(verified_at, v_now),
         verified_source = _verified_source
   WHERE id = v_pi.id;

  UPDATE public.orders
     SET status = 'paid', paid_at = COALESCE(paid_at, v_now)
   WHERE id = v_pi.order_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true, 'payment_intent_id', v_pi.id, 'order_id', v_pi.order_id, 'idempotent', false);
END; $function$;

REVOKE ALL ON FUNCTION public.confirm_payment_intent_by_reference(text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_payment_intent_by_reference(text, text, text, jsonb) TO service_role;

-- Nenhuma intenção pode ficar paga sem verificação
CREATE OR REPLACE FUNCTION public.enforce_payment_intent_verification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'paid'
     AND (NEW.verified_at IS NULL OR NOT public.is_trusted_payment_source(NEW.verified_source)) THEN
    RAISE EXCEPTION 'payment_intent_not_verified_by_gateway';
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_payment_intent_verification ON public.payment_intents;
CREATE TRIGGER trg_payment_intent_verification
  BEFORE INSERT OR UPDATE ON public.payment_intents
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_intent_verification();

-- Encomendas só passam a paga com intenção verificada
CREATE OR REPLACE FUNCTION public.enforce_order_paid_verification()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'paid'::order_status AND OLD.status IS DISTINCT FROM NEW.status THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_intents pi
      WHERE pi.order_id = NEW.id
        AND pi.status = 'paid'
        AND pi.verified_at IS NOT NULL
        AND public.is_trusted_payment_source(pi.verified_source)
    ) THEN
      RAISE EXCEPTION 'order_payment_not_verified_by_gateway';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_order_paid_verification ON public.orders;
CREATE TRIGGER trg_order_paid_verification
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_paid_verification();

-- 5) RPCs financeiros: apenas receita verificada
CREATE OR REPLACE FUNCTION public.admin_financial_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH verified_orders AS (
    SELECT o.* FROM public.orders o
    WHERE o.paid_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.payment_intents pi
        WHERE pi.order_id = o.id AND pi.status = 'paid'
          AND pi.verified_at IS NOT NULL
          AND public.is_trusted_payment_source(pi.verified_source)
      )
  ), unverified_orders AS (
    SELECT o.* FROM public.orders o
    WHERE o.paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_intents pi
        WHERE pi.order_id = o.id AND pi.status = 'paid'
          AND pi.verified_at IS NOT NULL
          AND public.is_trusted_payment_source(pi.verified_source)
      )
  )
  SELECT jsonb_build_object(
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_paid', (SELECT count(*) FROM verified_orders),
    'orders_pending', (SELECT count(*) FROM public.orders WHERE status = 'pending'),
    'orders_cancelled', (SELECT count(*) FROM public.orders WHERE status = 'cancelled'),
    'gross_aoa', COALESCE((SELECT sum(total_aoa) FROM verified_orders), 0),
    'commission_aoa', COALESCE((SELECT sum(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100) FROM verified_orders o), 0),
    'net_sellers_aoa', COALESCE((SELECT sum(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100)) FROM verified_orders o), 0),
    'gross_unverified_aoa', COALESCE((SELECT sum(total_aoa) FROM unverified_orders), 0),
    'orders_unverified', (SELECT count(*) FROM unverified_orders),
    'signup_fees_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'paid'), 0),
    'signup_fees_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'pending'), 0),
    'subscriptions_active', (SELECT count(*) FROM public.store_subscriptions WHERE status = 'active' AND verified_at IS NOT NULL),
    'subscriptions_paid_aoa', COALESCE((
      SELECT sum(sp.amount_aoa) FROM public.subscription_payments sp
      JOIN public.store_subscriptions ss ON ss.id = sp.subscription_id
      WHERE sp.status = 'paid' AND sp.paid_at IS NOT NULL
        AND ss.verified_at IS NOT NULL
        AND public.is_trusted_payment_source(ss.verified_source)), 0),
    'subscriptions_unverified_aoa', COALESCE((
      SELECT sum(ss.price_aoa) FROM public.store_subscriptions ss
      WHERE ss.verified_at IS NULL AND ss.status <> 'rejected'), 0),
    'payouts_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status IN ('pending','processing')), 0),
    'payouts_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status = 'paid'), 0),
    'stores_total', (SELECT count(*) FROM public.stores),
    'stores_active', (SELECT count(*) FROM public.stores WHERE status = 'active')
  ) INTO res;
  RETURN res;
END;
$function$;

DROP FUNCTION IF EXISTS public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, integer);
CREATE OR REPLACE FUNCTION public.admin_financial_transactions(
  _status text DEFAULT NULL::text,
  _store_id uuid DEFAULT NULL::uuid,
  _method text DEFAULT NULL::text,
  _from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  _limit integer DEFAULT 100
)
RETURNS TABLE(id uuid, created_at timestamp with time zone, paid_at timestamp with time zone, status text, customer_name text, store_name text, store_id uuid, gross_aoa numeric, commission_aoa numeric, net_aoa numeric, payment_method text, reference text, items integer, verified boolean, verified_source text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT o.id, o.created_at, o.paid_at, o.status::text,
         COALESCE(p.display_name, 'Cliente'), s.name, s.id,
         o.total_aoa,
         round(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100, 2),
         round(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100), 2),
         COALESCE(o.payment_method, '—'),
         (SELECT pi.reference FROM public.payment_intents pi WHERE pi.order_id = o.id ORDER BY pi.created_at DESC LIMIT 1),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id),
         EXISTS (SELECT 1 FROM public.payment_intents pi WHERE pi.order_id = o.id AND pi.status = 'paid'
                   AND pi.verified_at IS NOT NULL AND public.is_trusted_payment_source(pi.verified_source)),
         (SELECT pi.verified_source FROM public.payment_intents pi WHERE pi.order_id = o.id AND pi.verified_at IS NOT NULL
            ORDER BY pi.verified_at DESC LIMIT 1)
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.profiles p ON p.id = o.customer_id
  WHERE (_status IS NULL OR o.status::text = _status)
    AND (_store_id IS NULL OR o.store_id = _store_id)
    AND (_method IS NULL OR o.payment_method = _method)
    AND (_from IS NULL OR o.created_at >= _from)
    AND (_to IS NULL OR o.created_at <= _to)
  ORDER BY o.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, integer) TO authenticated, service_role;
