CREATE OR REPLACE FUNCTION public.can_store_go_live(_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN s.partner_type = 'retail'::public.partner_type THEN true
    WHEN s.partner_type = 'service'::public.partner_type THEN
      COALESCE((public.store_subscription_status(s.id)->>'can_go_live')::boolean, false)
    ELSE false
  END
  FROM public.stores s WHERE s.id = _store_id;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_live_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.store_id IS NOT DISTINCT FROM OLD.store_id THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'live'::public.live_status
     AND NEW.store_id IS NOT DISTINCT FROM OLD.store_id THEN RETURN NEW; END IF;
  IF NOT COALESCE(public.can_store_go_live(NEW.store_id), false) THEN
    RAISE EXCEPTION 'subscription_inactive'
      USING HINT = 'Ative um plano de subscrição para transmitir em direto.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_live_creation_rate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v jsonb; v_uid uuid := auth.uid(); v_type public.partner_type;
BEGIN
  SELECT partner_type INTO v_type FROM public.stores WHERE id=NEW.store_id;
  IF v_type='retail'::public.partner_type OR v_uid IS NULL THEN RETURN NEW; END IF;
  v := public.rate_limit_hit('livecreate:' || v_uid::text, 10, 60, 15);
  IF (v->>'blocked')::boolean THEN
    RAISE EXCEPTION 'rate_limited: tente novamente em % segundos', v->>'retry_after_seconds'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_live_creation_rate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_live_creation_rate() TO service_role;
CREATE OR REPLACE TRIGGER rl_lives_insert
BEFORE INSERT ON public.lives
FOR EACH ROW EXECUTE FUNCTION public.enforce_live_creation_rate();