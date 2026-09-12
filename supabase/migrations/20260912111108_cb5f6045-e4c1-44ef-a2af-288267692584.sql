CREATE OR REPLACE FUNCTION public.agency_live_fee_amount()
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$ SELECT 5000::numeric $$;

REVOKE ALL ON FUNCTION public.agency_live_fee_amount() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agency_live_fee_amount() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_agency_fee_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.amount_aoa := public.agency_live_fee_amount();
    NEW.status := 'pending'::agency_live_fee_status;
    NEW.approved_at := NULL;
    NEW.verified_at := NULL;
    NEW.verified_source := NULL;
  END IF;
  RETURN NEW;
END;
$function$;