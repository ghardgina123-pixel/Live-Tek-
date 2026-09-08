CREATE OR REPLACE FUNCTION public.store_commission_pct(_store_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN s.partner_type = 'service'::partner_type THEN 0::numeric ELSE 10::numeric END
  FROM public.stores s WHERE s.id = _store_id
$function$;

CREATE OR REPLACE FUNCTION public.calc_transaction_split(_store_id uuid, _amount_aoa numeric)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_pct numeric; v_fee numeric; v_net numeric;
BEGIN
  v_pct := COALESCE(public.store_commission_pct(_store_id), 10);
  v_fee := ROUND(COALESCE(_amount_aoa,0) * v_pct / 100, 2);
  v_net := ROUND(COALESCE(_amount_aoa,0) - v_fee, 2);
  RETURN jsonb_build_object('gross_aoa', ROUND(COALESCE(_amount_aoa,0),2), 'commission_pct', v_pct, 'platform_fee_aoa', v_fee, 'net_aoa', v_net);
END; $function$;