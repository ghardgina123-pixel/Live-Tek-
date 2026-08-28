CREATE OR REPLACE FUNCTION public.store_subscription_status(_store_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_store record;
  v_sub record;
  v_plan_name text := NULL;
  v_required boolean;
  v_state text;
BEGIN
  SELECT id, owner_id, partner_type, service_category INTO v_store FROM public.stores WHERE id = _store_id;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  v_required := (v_store.partner_type = 'service'::partner_type);

  SELECT * INTO v_sub FROM public.store_subscriptions ss
   WHERE ss.store_id = _store_id AND ss.plan <> 'signup_fee'
     AND ss.status IN ('active','grace','suspended')
   ORDER BY CASE ss.status WHEN 'active' THEN 1 WHEN 'grace' THEN 2 ELSE 3 END,
            ss.expires_at DESC NULLS LAST
   LIMIT 1;

  IF v_sub.id IS NOT NULL THEN
    SELECT sp.name INTO v_plan_name FROM public.subscription_plans sp WHERE sp.code = v_sub.plan;
  END IF;

  v_state := CASE
    WHEN v_sub.id IS NULL THEN 'inactive'
    WHEN v_sub.status = 'active' AND (v_sub.expires_at IS NULL OR v_sub.expires_at > now()) THEN 'active'
    WHEN v_sub.status = 'grace' THEN 'grace'
    WHEN v_sub.status = 'suspended' THEN 'suspended'
    ELSE 'inactive' END;

  RETURN jsonb_build_object(
    'partner_type', v_store.partner_type::text,
    'service_category', v_store.service_category,
    'subscription_required', v_required,
    'subscription_status', v_state,
    'plan_code', v_sub.plan,
    'plan_name', v_plan_name,
    'price_aoa', v_sub.price_aoa,
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'grace_until', v_sub.grace_until,
    'days_remaining', CASE WHEN v_sub.expires_at IS NULL THEN NULL
                           ELSE GREATEST(0, CEIL(EXTRACT(epoch FROM (v_sub.expires_at - now()))/86400))::int END,
    'max_lives_per_month', NULL,
    'can_go_live', (NOT v_required) OR v_state IN ('active','grace')
  );
END; $function$;