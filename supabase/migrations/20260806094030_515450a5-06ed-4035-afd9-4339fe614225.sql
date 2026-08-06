-- 1. Campos de cancelamento
ALTER TABLE public.store_subscriptions
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

CREATE UNIQUE INDEX IF NOT EXISTS store_subscriptions_reference_key
  ON public.store_subscriptions (reference) WHERE reference IS NOT NULL;

-- 2. Idempotência de faturas
CREATE UNIQUE INDEX IF NOT EXISTS subscription_invoices_unique_period
  ON public.subscription_invoices (subscription_id, period_start);

-- 3. Trigger de fatura tolerante a duplicados
CREATE OR REPLACE FUNCTION public.create_invoice_on_subscription_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_store record;
  v_plan record;
  v_number text;
  v_start timestamptz;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT s.id, s.name, s.phone, s.owner_id, sp.nif
      INTO v_store
      FROM public.stores s
      LEFT JOIN public.store_private sp ON sp.store_id = s.id
     WHERE s.id = NEW.store_id;

    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = NEW.plan;
    v_start := COALESCE(NEW.started_at, now());

    IF EXISTS (SELECT 1 FROM public.subscription_invoices
                WHERE subscription_id = NEW.id AND period_start = v_start) THEN
      RETURN NEW;
    END IF;

    v_number := 'FT-' || to_char(now(), 'YYYY') || '/' || lpad(nextval('public.subscription_invoice_seq')::text, 6, '0');

    INSERT INTO public.subscription_invoices (
      subscription_id, store_id, number, plan_code, plan_name, amount_aoa,
      payment_method, reference, period_start, period_end, status, customer_snapshot
    ) VALUES (
      NEW.id, NEW.store_id, v_number, NEW.plan,
      COALESCE(v_plan.name, initcap(replace(NEW.plan, '_', ' '))),
      NEW.price_aoa, NEW.payment_method, NEW.reference,
      v_start,
      COALESCE(NEW.expires_at, now() + make_interval(days => COALESCE(v_plan.period_days, 30))),
      'paid',
      jsonb_build_object('store_name', v_store.name, 'phone', v_store.phone, 'nif', v_store.nif, 'owner_id', v_store.owner_id)
    )
    ON CONFLICT (subscription_id, period_start) DO NOTHING;

    IF v_store.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_store.owner_id, 'subscription.active', 'Subscrição ativada',
              'O plano ' || COALESCE(v_plan.name, NEW.plan) || ' está ativo. A sua fatura ' || v_number || ' já está disponível.',
              '/lojista/subscricao', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 4. Ativação idempotente por referência
CREATE OR REPLACE FUNCTION public.activate_subscription_by_reference(
  _reference text, _external_id text DEFAULT NULL, _payload jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sub record; v_days int; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_sub FROM public.store_subscriptions WHERE reference = _reference;
  IF v_sub.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_sub.status = 'active' AND (v_sub.expires_at IS NULL OR v_sub.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', true);
  END IF;

  SELECT COALESCE(period_days, 30) INTO v_days FROM public.subscription_plans WHERE code = v_sub.plan;

  UPDATE public.store_subscriptions
     SET status = 'active',
         started_at = COALESCE(started_at, v_now),
         expires_at = v_now + make_interval(days => COALESCE(v_days, 30)),
         external_id = COALESCE(_external_id, external_id),
         raw_payload = COALESCE(_payload, raw_payload),
         rejection_reason = NULL,
         cancelled_at = NULL,
         cancel_reason = NULL,
         updated_at = v_now
   WHERE id = v_sub.id;

  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', false);
END; $$;

CREATE OR REPLACE FUNCTION public.reject_subscription_by_reference(
  _reference text, _status text, _payload jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sub record;
BEGIN
  SELECT * INTO v_sub FROM public.store_subscriptions WHERE reference = _reference;
  IF v_sub.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_sub.status = 'active' THEN
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'ignored', true);
  END IF;
  UPDATE public.store_subscriptions
     SET status = _status, raw_payload = COALESCE(_payload, raw_payload), updated_at = now()
   WHERE id = v_sub.id;
  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', _status);
END; $$;

-- 5. Cancelamento
CREATE OR REPLACE FUNCTION public.cancel_store_subscription(_store_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_owner uuid; v_sub record;
BEGIN
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_sub FROM public.store_subscriptions
   WHERE store_id = _store_id AND plan <> 'signup_fee' AND status IN ('active','pending')
   ORDER BY (status = 'active') DESC, created_at DESC LIMIT 1;
  IF v_sub.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_subscription'); END IF;

  UPDATE public.store_subscriptions
     SET status = 'cancelled', cancelled_at = now(), cancel_reason = _reason,
         expires_at = now(), updated_at = now()
   WHERE id = v_sub.id;

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_owner, 'subscription.cancelled', 'Subscrição cancelada',
          'O seu plano foi cancelado. As faturas anteriores continuam disponíveis.',
          '/lojista/subscricao', v_sub.id);

  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'cancelled');
END; $$;

-- 6. Expiração automática
CREATE OR REPLACE FUNCTION public.expire_due_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row record; v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ss.id, ss.store_id, s.owner_id
      FROM public.store_subscriptions ss
      JOIN public.stores s ON s.id = ss.store_id
     WHERE ss.status = 'active' AND ss.expires_at IS NOT NULL AND ss.expires_at <= now()
  LOOP
    UPDATE public.store_subscriptions SET status = 'expired', updated_at = now() WHERE id = v_row.id;
    IF v_row.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_row.owner_id, 'subscription.expired', 'Subscrição expirada',
              'O seu plano expirou. Renove para continuar a transmitir em direto.',
              '/lojista/subscricao', v_row.id);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

SELECT cron.schedule('expire-subscriptions', '7 * * * *', $cron$ SELECT public.expire_due_subscriptions(); $cron$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-subscriptions');

-- 7. Consumo de lives do mês
CREATE OR REPLACE FUNCTION public.store_live_usage(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_used int; v_limit int; v_plan text;
BEGIN
  SELECT COUNT(*)::int INTO v_used FROM public.lives
   WHERE store_id = _store_id AND created_at >= date_trunc('month', now());

  SELECT sp.max_lives_per_month, sp.code INTO v_limit, v_plan
    FROM public.store_subscriptions ss
    JOIN public.subscription_plans sp ON sp.code = ss.plan
   WHERE ss.store_id = _store_id AND ss.status = 'active'
     AND (ss.expires_at IS NULL OR ss.expires_at > now())
   ORDER BY ss.expires_at DESC NULLS LAST LIMIT 1;

  RETURN jsonb_build_object(
    'plan_code', v_plan,
    'used', v_used,
    'limit', v_limit,
    'unlimited', v_limit IS NULL,
    'remaining', CASE WHEN v_limit IS NULL THEN NULL ELSE GREATEST(0, v_limit - v_used) END
  );
END; $$;

-- 8. Bloqueio de lives (plano inativo + limite mensal)
CREATE OR REPLACE FUNCTION public.enforce_live_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_usage jsonb; v_limit int; v_used int;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'live'::live_status THEN RETURN NEW; END IF;

  IF NOT public.can_store_go_live(NEW.store_id) THEN
    RAISE EXCEPTION 'subscription_inactive'
      USING HINT = 'Ative um plano de subscrição para transmitir em direto.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_usage := public.store_live_usage(NEW.store_id);
    v_limit := NULLIF(v_usage->>'limit', '')::int;
    v_used := COALESCE((v_usage->>'used')::int, 0);
    IF v_limit IS NOT NULL AND v_used >= v_limit THEN
      RAISE EXCEPTION 'live_limit_reached'
        USING HINT = 'Atingiu o limite de lives do seu plano este mês. Faça upgrade para continuar.';
    END IF;
  END IF;

  RETURN NEW;
END; $$;

-- 9. Painel administrativo
CREATE OR REPLACE FUNCTION public.admin_list_subscriptions(_status text DEFAULT NULL)
RETURNS TABLE(
  id uuid, store_id uuid, store_name text, owner_email text, plan text, plan_name text,
  status text, price_aoa numeric, reference text, payment_method text, external_id text,
  started_at timestamptz, expires_at timestamptz, cancelled_at timestamptz,
  created_at timestamptz, invoice_count int
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN QUERY
  SELECT ss.id, ss.store_id, s.name, u.email::text, ss.plan, sp.name, ss.status, ss.price_aoa,
         ss.reference, ss.payment_method, ss.external_id, ss.started_at, ss.expires_at,
         ss.cancelled_at, ss.created_at,
         (SELECT COUNT(*)::int FROM public.subscription_invoices si WHERE si.subscription_id = ss.id)
    FROM public.store_subscriptions ss
    JOIN public.stores s ON s.id = ss.store_id
    LEFT JOIN public.subscription_plans sp ON sp.code = ss.plan
    LEFT JOIN auth.users u ON u.id = s.owner_id
   WHERE (_status IS NULL OR ss.status = _status)
   ORDER BY ss.created_at DESC;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reprocess_subscription(_reference text, _approve boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _approve THEN
    RETURN public.activate_subscription_by_reference(_reference, NULL,
      jsonb_build_object('source', 'admin_reprocess', 'at', now(), 'admin', auth.uid()));
  END IF;
  RETURN public.reject_subscription_by_reference(_reference, 'rejected',
    jsonb_build_object('source', 'admin_reprocess', 'at', now(), 'admin', auth.uid()));
END; $$;

-- 10. Permissões
REVOKE EXECUTE ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reject_subscription_by_reference(text, text, jsonb) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_due_subscriptions() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_subscription_by_reference(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_due_subscriptions() TO service_role;

REVOKE EXECUTE ON FUNCTION public.cancel_store_subscription(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_live_usage(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_list_subscriptions(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reprocess_subscription(text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_store_subscription(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_live_usage(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_subscriptions(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reprocess_subscription(text, boolean) TO authenticated, service_role;