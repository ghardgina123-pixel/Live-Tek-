-- ============ 0. SNAPSHOT (backup/registo da configuração actual) ============
CREATE TABLE IF NOT EXISTS public.security_config_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
GRANT ALL ON public.security_config_snapshots TO service_role;
ALTER TABLE public.security_config_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scs_admin_read ON public.security_config_snapshots;
CREATE POLICY scs_admin_read ON public.security_config_snapshots
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
GRANT SELECT ON public.security_config_snapshots TO authenticated;

INSERT INTO public.security_config_snapshots (label, payload)
SELECT 'fase1-pre-hardening', jsonb_build_object(
  'function_acl', (
    SELECT jsonb_agg(jsonb_build_object('name', p.proname, 'acl', COALESCE(p.proacl::text, 'DEFAULT_PUBLIC')))
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  ),
  'policies', (
    SELECT jsonb_agg(to_jsonb(x)) FROM (
      SELECT tablename, policyname, cmd, roles::text AS roles, qual, with_check
      FROM pg_policies WHERE schemaname = 'public'
    ) x
  ),
  'table_grants', (
    SELECT jsonb_agg(to_jsonb(y)) FROM (
      SELECT table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role')
    ) y
  )
);

-- ============ V-01: activação/rejeição de subscrições ============
REVOKE ALL ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_subscription_by_reference(text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_subscription_by_reference(text, text, jsonb) TO service_role;

-- ============ V-03: tarefas automáticas (cron) ============
REVOKE ALL ON FUNCTION public.expire_due_subscriptions() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.subscription_renewal_notices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_subscriptions() TO service_role;
GRANT EXECUTE ON FUNCTION public.subscription_renewal_notices() TO service_role;

-- ============ Funções administrativas: fora do alcance de anon ============
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND (p.proname LIKE 'admin\_%' OR p.proname IN (
            'cancel_store_subscription','store_live_usage','seller_signup_status',
            'seller_create_delivery','request_payout',
            'affiliate_dashboard','affiliate_withdrawable','affiliate_get_or_create_code',
            'affiliate_register_referral','courier_withdrawable'))
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ============ Funções de trigger: não precisam de EXECUTE para nenhum papel de app ============
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- ============ V-02: telefone / dados pessoais em profiles ============
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, avatar_url, is_online, last_seen_at, country_id,
              country_code, language_code, partner_type, created_at, updated_at)
  ON public.profiles TO anon, authenticated;
GRANT UPDATE (display_name, avatar_url, phone, country_id, country_code, language_code)
  ON public.profiles TO authenticated;

-- Cada utilizador continua a ler o seu próprio telefone
REVOKE ALL ON FUNCTION public.get_own_phone() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_own_phone() TO authenticated, service_role;

-- Administradores continuam a poder consultar o telefone quando necessário
CREATE OR REPLACE FUNCTION public.admin_user_phone(_user_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT phone INTO v FROM public.profiles WHERE id = _user_id;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_user_phone(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_user_phone(uuid) TO authenticated, service_role;
