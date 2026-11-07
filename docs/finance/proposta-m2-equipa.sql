-- LIVE TEKÁ — REVISÃO CORRETIVA v2 · 2026-11-07
-- DOCUMENTO DE PROPOSTA. NÃO EXECUTAR / NÃO APLICAR SEM NOVA AUTORIZAÇÃO.
-- Nada neste ficheiro foi executado. Testes funcionais e reversão: PENDENTES.
-- Instalação futura numa transação do executor; sem BEGIN/COMMIT neste documento.
-- Contrato: PostgreSQL 15+, auth.uid(), auth.users, public.countries existentes.
-- NÃO substitui has_role, auxiliares AOA, pedidos, liquidação, ledger ou políticas atuais.
-- Pré-requisitos de execução futura, por ligação dedicada:
--   app.review_owner = role NOLOGIN isolada, sem membros não-superuser nem
--                      pertença a outras roles; mesmo proprietário em M2 e M1.
--   app.review_actor = UUID REAL do gestor, confirmado no diretório de auth.
-- Essas definições NÃO são autoridade para clientes; usadas apenas na instalação.
-- Sem CREATE ROLE, REVOKE de membership de plataforma ou redução de isolamento.

-- M2 / PHASE A : fondation RBAC dormante, à installer AVANT M1.
-- Répétition contrôlée: journal de migration + SHA256 dans la procédure du document MD.
-- CREATE strict volontaire: une deuxième exécution manuelle échoue et est annulée;
-- ne pas masquer un schéma divergent avec IF NOT EXISTS / ON CONFLICT DO NOTHING.
DO $preflight$
DECLARE o text := current_setting('app.review_owner',true); a uuid;
BEGIN
  IF o IS NULL OR o IN ('anon','authenticated','service_role','postgres','supabase_admin') THEN
    RAISE EXCEPTION 'review_owner_missing_or_unsafe';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=o AND NOT rolcanlogin
    AND NOT rolsuper AND NOT rolbypassrls) THEN RAISE EXCEPTION 'isolated_nologin_owner_required'; END IF;
  -- Isolamento transitivo de TODOS os principals não-superuser, não só três roles.
  -- Política estrita: nenhuma exceção de executor não-superuser neste pacote.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname<>o AND NOT rolsuper
    AND pg_catalog.pg_has_role(oid,o,'MEMBER')) THEN RAISE EXCEPTION 'owner_membership_not_isolated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname<>o
    AND pg_catalog.pg_has_role(o,oid,'MEMBER')) THEN RAISE EXCEPTION 'owner_inherits_other_role'; END IF;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) THEN
    RAISE EXCEPTION 'approved_isolated_superuser_executor_required'; END IF;
  IF NOT pg_catalog.has_schema_privilege(o,'public','CREATE') THEN RAISE EXCEPTION 'owner_transfer_schema_create_missing'; END IF;
  IF to_regprocedure('auth.uid()') IS NULL OR to_regprocedure('public.has_role(uuid,public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'required_auth_functions_missing'; END IF;
  IF NOT pg_catalog.has_function_privilege(o,'auth.uid()','EXECUTE')
    OR NOT pg_catalog.has_function_privilege(o,'public.has_role(uuid,public.app_role)','EXECUTE') THEN
    RAISE EXCEPTION 'owner_auth_function_execute_missing'; END IF;
  a := nullif(current_setting('app.review_actor',true),'')::uuid;
  IF a IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id=a AND email_confirmed_at IS NOT NULL)
    OR NOT public.has_role(a,'admin') THEN RAISE EXCEPTION 'confirmed_real_admin_required'; END IF;
  IF NOT pg_catalog.has_column_privilege(o,'auth.users','id','SELECT')
    OR NOT pg_catalog.has_column_privilege(o,'auth.users','email','SELECT')
    OR NOT pg_catalog.has_column_privilege(o,'auth.users','email_confirmed_at','SELECT') THEN
    RAISE EXCEPTION 'owner_auth_read_not_provisioned';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(o,'public','USAGE')
    OR NOT pg_catalog.has_schema_privilege(o,'auth','USAGE') THEN RAISE EXCEPTION 'owner_schema_usage_missing'; END IF;
END $preflight$;
CREATE TABLE public.lt_staff_control_v2 (
 user_id uuid PRIMARY KEY, status text NOT NULL CHECK(status IN ('active','suspended','revoked')),
 version bigint NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_staff_control_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_control_v2 TO service_role;
GRANT SELECT ON public.lt_staff_control_v2 TO authenticated;
ALTER TABLE public.lt_staff_control_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_root_managers_v2 (
 user_id uuid PRIMARY KEY REFERENCES public.lt_staff_control_v2(user_id), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_root_managers_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_root_managers_v2 TO service_role;
GRANT SELECT ON public.lt_root_managers_v2 TO authenticated;
ALTER TABLE public.lt_root_managers_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_roles_v2 (
 code text PRIMARY KEY CHECK(code IN ('contabilista','financeiro','operador_equipa')),
 is_active boolean NOT NULL DEFAULT true
);
REVOKE ALL ON public.lt_staff_roles_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_roles_v2 TO service_role;
GRANT SELECT ON public.lt_staff_roles_v2 TO authenticated;
ALTER TABLE public.lt_staff_roles_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_permissions_v2 (
 code text PRIMARY KEY, sensitive boolean NOT NULL DEFAULT true
);
REVOKE ALL ON public.lt_staff_permissions_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_permissions_v2 TO service_role;
GRANT SELECT ON public.lt_staff_permissions_v2 TO authenticated;
ALTER TABLE public.lt_staff_permissions_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_role_permissions_v2 (
 role_code text NOT NULL REFERENCES public.lt_staff_roles_v2(code),
 permission text NOT NULL REFERENCES public.lt_staff_permissions_v2(code), PRIMARY KEY(role_code,permission)
);
REVOKE ALL ON public.lt_staff_role_permissions_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_role_permissions_v2 TO service_role;
GRANT SELECT ON public.lt_staff_role_permissions_v2 TO authenticated;
ALTER TABLE public.lt_staff_role_permissions_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_members_v2 (
 user_id uuid PRIMARY KEY REFERENCES public.lt_staff_control_v2(user_id),
 role_code text NOT NULL REFERENCES public.lt_staff_roles_v2(code), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_staff_members_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_members_v2 TO service_role;
GRANT SELECT ON public.lt_staff_members_v2 TO authenticated;
ALTER TABLE public.lt_staff_members_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_invites_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL CHECK(email=lower(btrim(email))),
 role_code text NOT NULL REFERENCES public.lt_staff_roles_v2(code), token_hash text NOT NULL UNIQUE,
 inviter uuid NOT NULL REFERENCES public.lt_staff_control_v2(user_id), inviter_version bigint NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','cancelled','expired')),
 expires_at timestamptz NOT NULL, accepted_by uuid, accepted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_staff_invites_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_invites_v2 TO service_role;
ALTER TABLE public.lt_staff_invites_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_staff_audit_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
 action text NOT NULL, subject_id text NOT NULL, reason text NOT NULL CHECK(btrim(reason)<>''),
 previous_state jsonb, new_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_staff_audit_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_staff_audit_v2 TO service_role;
GRANT SELECT ON public.lt_staff_audit_v2 TO authenticated;
ALTER TABLE public.lt_staff_audit_v2 ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX lt_staff_one_pending_email_v2 ON public.lt_staff_invites_v2(email) WHERE status='pending';
-- Catalogue initial: aucun grant positif individuel ni édition de rôle partagé exposés.
INSERT INTO public.lt_staff_roles_v2(code) VALUES ('contabilista'),('financeiro'),('operador_equipa');
INSERT INTO public.lt_staff_permissions_v2(code,sensitive) VALUES
 ('finance.view',false),('finance.prepare',false),('finance.approve',true),('finance.execute',true),
 ('finance.reject',true),('finance.invoice.register',true),('limits.manage',true),
 ('limits.audit.read',true),('team.read',true),('team.invite',true),('team.suspend',true),
 ('team.reactivate',true),('team.revoke',true),('team.audit.read',true);
INSERT INTO public.lt_staff_role_permissions_v2(role_code,permission) VALUES
 ('contabilista','finance.view'),('contabilista','finance.prepare'),
 ('financeiro','finance.view'),('financeiro','finance.prepare'),
 ('operador_equipa','team.read');
-- Financeiro NÃO recebe aprovação/execução nesta fundação.
-- Gestor raiz só recebe gestão da equipa/limites; NÃO autoridade financeira automática.
DO $bootstrap$
DECLARE a uuid := current_setting('app.review_actor')::uuid;
BEGIN
 INSERT INTO public.lt_staff_control_v2(user_id,status) VALUES(a,'active');
 INSERT INTO public.lt_root_managers_v2(user_id,created_by) VALUES(a,a);
 INSERT INTO public.lt_staff_audit_v2(actor_id,action,subject_id,reason,new_state)
 VALUES(a,'bootstrap_root',a::text,'Inicialização autorizada do gestor real',jsonb_build_object('status','active','root',true));
END $bootstrap$;
CREATE FUNCTION public.lt_review_block_mutation_v2() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
BEGIN RAISE EXCEPTION 'immutable_record:%',TG_TABLE_NAME; END;
$fn$;

CREATE FUNCTION public.lt_staff_allowed_internal_v2(p_user uuid, p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
SELECT p_user IS NOT NULL AND EXISTS (
 SELECT 1 FROM public.lt_staff_control_v2 c WHERE c.user_id=p_user AND c.status='active'
 AND (
  (EXISTS(SELECT 1 FROM public.lt_root_managers_v2 r WHERE r.user_id=c.user_id)
   AND p_permission IN ('limits.manage','limits.audit.read','team.read','team.invite','team.suspend',
                        'team.reactivate','team.revoke','team.audit.read'))
  OR EXISTS(SELECT 1 FROM public.lt_staff_members_v2 m
    JOIN public.lt_staff_roles_v2 r ON r.code=m.role_code AND r.is_active
    JOIN public.lt_staff_role_permissions_v2 g ON g.role_code=r.code
    WHERE m.user_id=c.user_id AND g.permission=p_permission
      AND NOT (r.code='contabilista' AND p_permission='finance.execute'))
 ))
$fn$;

CREATE FUNCTION public.lt_staff_can_v2(p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
SELECT public.lt_staff_allowed_internal_v2(auth.uid(),p_permission)
$fn$;

CREATE FUNCTION public.lt_staff_lock_authorize_v2(p_permission text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid := auth.uid();
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 -- Sérialise mutations d'autorisation et appels sensibles; acquis avant les locks financiers.
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:staff:authorization:v2',0));
 IF NOT public.lt_staff_allowed_internal_v2(a,p_permission) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 RETURN a;
END;
$fn$;

CREATE FUNCTION public.lt_staff_create_invite_v2(p_actor uuid, p_email text, p_role text, p_token_hash text, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE c public.lt_staff_control_v2; i uuid; e text:=lower(btrim(p_email));
BEGIN
 -- EXECUTE service_role seulement: backend authentifie p_actor avant cet appel.
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:staff:authorization:v2',0));
 SELECT * INTO c FROM public.lt_staff_control_v2 WHERE user_id=p_actor;
 IF NOT FOUND OR NOT public.lt_staff_allowed_internal_v2(p_actor,'team.invite')
  OR NOT EXISTS(SELECT 1 FROM public.lt_root_managers_v2 WHERE user_id=p_actor) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF e IS NULL OR e='' OR p_reason IS NULL OR btrim(p_reason)=''
  OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
  OR p_role IS NULL OR p_role NOT IN ('contabilista','financeiro','operador_equipa') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lt_staff_roles_v2 WHERE code=p_role AND is_active)
   OR EXISTS(SELECT 1 FROM public.lt_staff_role_permissions_v2 WHERE role_code=p_role AND permission NOT IN
      ('finance.view','finance.prepare','team.read')) THEN RAISE EXCEPTION 'role_outside_delegation_cap'; END IF;
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND lower(btrim(email))=e) THEN RAISE EXCEPTION 'self_invitation_forbidden'; END IF;
 -- Pas de remplacement silencieux d'un invite pending, même expiré: annulation explicite requise.
 INSERT INTO public.lt_staff_invites_v2(email,role_code,token_hash,inviter,inviter_version,expires_at)
 VALUES(e,p_role,p_token_hash,p_actor,c.version,clock_timestamp()+interval '7 days') RETURNING id INTO i;
 INSERT INTO public.lt_staff_audit_v2(actor_id,action,subject_id,reason,new_state)
 VALUES(p_actor,'invite_created',i::text,p_reason,jsonb_build_object('role',p_role,'email',e,'inviter_version',c.version));
 RETURN i;
END;
$fn$;

CREATE FUNCTION public.lt_staff_accept_invite_v2(p_token_hash text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); e text; i public.lt_staff_invites_v2; c public.lt_staff_control_v2;
BEGIN
 IF a IS NULL OR p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:staff:authorization:v2',0));
 SELECT lower(btrim(email)) INTO e FROM auth.users WHERE id=a AND email_confirmed_at IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT * INTO i FROM public.lt_staff_invites_v2 WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' OR i.email<>e OR i.expires_at<=clock_timestamp()
  OR i.inviter=a THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT * INTO c FROM public.lt_staff_control_v2 WHERE user_id=i.inviter;
 IF NOT FOUND OR c.version<>i.inviter_version OR NOT public.lt_staff_allowed_internal_v2(i.inviter,'team.invite') THEN
  RAISE EXCEPTION 'invalid_invitation'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lt_staff_roles_v2 WHERE code=i.role_code AND is_active)
  OR EXISTS(SELECT 1 FROM public.lt_staff_role_permissions_v2 WHERE role_code=i.role_code
      AND permission NOT IN ('finance.view','finance.prepare','team.read'))
  OR EXISTS(SELECT 1 FROM public.lt_staff_control_v2 WHERE user_id=a)
  OR public.has_role(a,'admin') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 INSERT INTO public.lt_staff_control_v2(user_id,status) VALUES(a,'active');
 INSERT INTO public.lt_staff_members_v2(user_id,role_code,created_by) VALUES(a,i.role_code,i.inviter);
 UPDATE public.lt_staff_invites_v2 SET status='accepted',accepted_by=a,accepted_at=clock_timestamp() WHERE id=i.id;
 INSERT INTO public.lt_staff_audit_v2(actor_id,action,subject_id,reason,new_state)
 VALUES(a,'invite_accepted',i.id::text,'Aceitação pelo email confirmado destinatário',jsonb_build_object('user_id',a,'role',i.role_code));
 RETURN a;
END;
$fn$;

CREATE FUNCTION public.lt_staff_cancel_invite_v2(p_id uuid, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid; i public.lt_staff_invites_v2;
BEGIN
 a:=public.lt_staff_lock_authorize_v2('team.invite');
 IF p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'reason_required'; END IF;
 SELECT * INTO i FROM public.lt_staff_invites_v2 WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' THEN RAISE EXCEPTION 'invite_not_pending'; END IF;
 UPDATE public.lt_staff_invites_v2 SET status='cancelled' WHERE id=p_id;
 INSERT INTO public.lt_staff_audit_v2(actor_id,action,subject_id,reason,previous_state,new_state)
 VALUES(a,'invite_cancelled',p_id::text,p_reason,
  jsonb_build_object('status',i.status),jsonb_build_object('status','cancelled'));
END;
$fn$;

CREATE FUNCTION public.lt_staff_set_status_v2(p_user uuid, p_status text, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid; c public.lt_staff_control_v2;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('active','suspended','revoked') OR p_reason IS NULL OR btrim(p_reason)='' THEN
  RAISE EXCEPTION 'invalid_status_or_reason'; END IF;
 a:=public.lt_staff_lock_authorize_v2(CASE p_status WHEN 'active' THEN 'team.reactivate' WHEN 'suspended' THEN 'team.suspend' ELSE 'team.revoke' END);
 IF p_user IS NULL OR p_user=a OR EXISTS(SELECT 1 FROM public.lt_root_managers_v2 WHERE user_id=p_user) THEN
  RAISE EXCEPTION 'self_or_root_change_forbidden'; END IF;
 SELECT * INTO c FROM public.lt_staff_control_v2 WHERE user_id=p_user FOR UPDATE;
 IF NOT FOUND OR c.status='revoked' THEN RAISE EXCEPTION 'missing_or_terminal_principal'; END IF;
 IF EXISTS(SELECT 1 FROM public.lt_staff_members_v2 m JOIN public.lt_staff_role_permissions_v2 g ON g.role_code=m.role_code
     WHERE m.user_id=p_user AND g.permission NOT IN ('finance.view','finance.prepare','team.read')) THEN
  RAISE EXCEPTION 'sensitive_member_requires_independent_approval_not_available'; END IF;
 IF c.status=p_status THEN RETURN; END IF;
 UPDATE public.lt_staff_control_v2 SET status=p_status,version=version+1,updated_at=clock_timestamp() WHERE user_id=p_user;
 INSERT INTO public.lt_staff_audit_v2(actor_id,action,subject_id,reason,previous_state,new_state)
 SELECT a,'status_changed',p_user::text,p_reason,to_jsonb(c),to_jsonb(n) FROM public.lt_staff_control_v2 n WHERE n.user_id=p_user;
END;
$fn$;

-- NON inclus: grants individuels positifs, modification de rôles partagés,
-- attribution root, finance.approve/execute/reject, augmentation de délégation.
-- Aucun endpoint ne les permet. Une phase future exige proposal/approver indépendants,
-- payload immuable/versionné, cap explicite et revalidation; ne pas simuler ce mécanisme.
-- Appels existants has_role/admin et RLS historiques restent intacts en phase A.
-- Suspension v2 est effective uniquement sur v2: activation globale BLOQUÉE tant que
-- inventaire/cutover des chemins legacy, workers, RLS permissives et user_roles est incomplet.
-- Propriétaire commun vérifié: contourne RLS uniquement pour les tables dont il est propriétaire.
-- Pas de FORCE RLS: les évaluateurs internes ne doivent pas récursivement appeler leurs politiques.
DO $ownership$
DECLARE o text := current_setting('app.review_owner'); r record;
BEGIN
  EXECUTE format('ALTER TABLE public.lt_staff_control_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_root_managers_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_roles_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_permissions_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_role_permissions_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_members_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_invites_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_staff_audit_v2 OWNER TO %I',o);
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('lt_review_block_mutation_v2','lt_staff_allowed_internal_v2','lt_staff_can_v2','lt_staff_lock_authorize_v2','lt_staff_create_invite_v2','lt_staff_accept_invite_v2','lt_staff_cancel_invite_v2','lt_staff_set_status_v2') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',r.signature,o);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',r.signature);
  END LOOP;
END $ownership$;
GRANT EXECUTE ON FUNCTION public.lt_staff_can_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lt_staff_create_invite_v2(uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lt_staff_accept_invite_v2(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lt_staff_cancel_invite_v2(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lt_staff_set_status_v2(uuid,text,text) TO authenticated;
CREATE POLICY lt_staff_control_v2_read_v2 ON public.lt_staff_control_v2 FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_root_managers_v2_read_v2 ON public.lt_root_managers_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_staff_roles_v2_read_v2 ON public.lt_staff_roles_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_staff_permissions_v2_read_v2 ON public.lt_staff_permissions_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_staff_role_permissions_v2_read_v2 ON public.lt_staff_role_permissions_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_staff_members_v2_read_v2 ON public.lt_staff_members_v2 FOR SELECT TO authenticated USING (user_id=auth.uid() OR public.lt_staff_can_v2('team.read'));
CREATE POLICY lt_staff_audit_v2_read_v2 ON public.lt_staff_audit_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('team.audit.read'));
CREATE TRIGGER lt_staff_audit_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_staff_audit_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_audit_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_audit_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_control_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_control_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_root_managers_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_root_managers_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_roles_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_roles_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_permissions_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_permissions_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_role_permissions_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_role_permissions_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_members_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_members_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_staff_invites_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_staff_invites_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
-- Préflight ultérieur: auditer ACL effectives/inherited de TOUTES les signatures ci-dessus,
-- propriétaire isolé, extensions, auth.uid EXECUTE, et absence de writers hors RPCs.
-- Toute impossibilité de provisioning du propriétaire fait ABORTER, pas élargir les grants.

-- Digest do ficheiro M2: calculado/verificado pelo executor antes da transação.
DO $attestation$
DECLARE d text:=current_setting('app.review_package_sha256',true);
BEGIN
 IF d IS NULL OR d !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'approved_package_checksum_required'; END IF;
 EXECUTE format('COMMENT ON TABLE public.lt_staff_control_v2 IS %L','LiveTeka:M2:v2:approved-sha256='||d);
END $attestation$;
