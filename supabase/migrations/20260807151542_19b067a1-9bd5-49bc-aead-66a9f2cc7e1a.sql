ALTER TABLE public.subscription_plans ALTER COLUMN max_lives_per_month SET DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.store_live_usage(_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_used int; v_plan text;
BEGIN
  SELECT COUNT(*)::int INTO v_used FROM public.lives
   WHERE store_id = _store_id AND created_at >= date_trunc('month', now());

  SELECT sp.code INTO v_plan
    FROM public.store_subscriptions ss
    JOIN public.subscription_plans sp ON sp.code = ss.plan
   WHERE ss.store_id = _store_id AND ss.status = 'active'
     AND (ss.expires_at IS NULL OR ss.expires_at > now())
   ORDER BY ss.expires_at DESC NULLS LAST LIMIT 1;

  -- Lives ilimitadas em todos os planos.
  RETURN jsonb_build_object(
    'plan_code', v_plan,
    'used', v_used,
    'limit', NULL,
    'unlimited', true,
    'remaining', NULL
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.enforce_live_subscription()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'live'::live_status THEN RETURN NEW; END IF;

  IF NOT public.can_store_go_live(NEW.store_id) THEN
    RAISE EXCEPTION 'subscription_inactive'
      USING HINT = 'Ative um plano de subscrição para transmitir em direto.';
  END IF;

  -- Sem limite de quantidade de lives em nenhum plano.
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.store_subscription_status(_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store record;
  v_sub record;
  v_plan record;
  v_required boolean;
  v_active boolean;
BEGIN
  SELECT id, owner_id, partner_type INTO v_store FROM public.stores WHERE id = _store_id;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;

  v_required := (v_store.partner_type = 'service'::partner_type);

  SELECT * INTO v_sub
    FROM public.store_subscriptions ss
   WHERE ss.store_id = _store_id
     AND ss.plan <> 'signup_fee'
     AND ss.status = 'active'
     AND (ss.expires_at IS NULL OR ss.expires_at > now())
   ORDER BY ss.expires_at DESC NULLS LAST
   LIMIT 1;

  IF v_sub.id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = v_sub.plan;
  END IF;

  v_active := v_sub.id IS NOT NULL;

  RETURN jsonb_build_object(
    'partner_type', v_store.partner_type::text,
    'subscription_required', v_required,
    'subscription_status', CASE WHEN v_active THEN 'active' ELSE 'inactive' END,
    'plan_code', v_sub.plan,
    'plan_name', v_plan.name,
    'price_aoa', v_sub.price_aoa,
    'expires_at', v_sub.expires_at,
    'max_lives_per_month', NULL,
    'can_go_live', (NOT v_required) OR v_active
  );
END; $function$;