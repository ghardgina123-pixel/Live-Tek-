-- Disposable LOCAL PostgreSQL only. No connection to the application database.
CREATE SCHEMA auth;
CREATE ROLE authenticated;
CREATE ROLE anon;
CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon, service_role;
CREATE TYPE public.app_role AS ENUM ('customer','seller','admin');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('test.uid',true),'')::uuid
$$;
CREATE TABLE public.user_roles(user_id uuid, role public.app_role);
CREATE FUNCTION public.has_role(_uid uuid,_role public.app_role) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role=_role)
$$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, raw_user_meta_data jsonb NOT NULL DEFAULT '{}', email text);
CREATE TABLE public.customer_fiscal_profiles (
  user_id uuid PRIMARY KEY, legal_name text, nif text, fiscal_address text,
  province text, municipality text, country_code text NOT NULL DEFAULT 'AO',
  email text, phone text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT,UPDATE,DELETE ON public.customer_fiscal_profiles TO authenticated;
GRANT ALL ON public.customer_fiscal_profiles TO service_role;
ALTER TABLE public.customer_fiscal_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY cfp_own_all ON public.customer_fiscal_profiles FOR ALL TO authenticated
  USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY cfp_admin_select ON public.customer_fiscal_profiles FOR SELECT TO authenticated
  USING(public.has_role(auth.uid(),'admin'));
CREATE TABLE public.security_audit_log(event text,severity text,actor_id uuid,subject_id uuid,metadata jsonb);
-- Existing store ownership policies reproduced exactly for regression checks; financial/store triggers are not simulated.
CREATE TYPE public.store_status AS ENUM ('pending','active','rejected');
CREATE TABLE public.stores(id uuid PRIMARY KEY,owner_id uuid NOT NULL,name text,status public.store_status DEFAULT 'pending',nif text);
GRANT SELECT,INSERT,UPDATE ON public.stores TO authenticated;
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
CREATE POLICY stores_insert_own ON public.stores FOR INSERT TO authenticated WITH CHECK(owner_id=auth.uid());
CREATE POLICY stores_select_active_public ON public.stores FOR SELECT TO public
  USING(status='active' OR owner_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY stores_update_own_or_admin ON public.stores FOR UPDATE TO authenticated
  USING(owner_id=auth.uid() OR public.has_role(auth.uid(),'admin'))
  WITH CHECK(public.has_role(auth.uid(),'admin') OR (owner_id=auth.uid() AND status<>'active'));