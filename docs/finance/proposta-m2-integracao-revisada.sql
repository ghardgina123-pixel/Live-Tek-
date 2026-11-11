-- LIVE TEKÁ M2 — equipa operacional sobre autenticação e auditoria existentes.
-- REVISÃO 11/11/2026. NÃO APLICADO. Requer nova aprovação expressa.
-- A tentativa anterior foi cancelada antes de execução. Nenhuma migração autorizada nesta fase.
-- Não modifica user_roles, não cria gestores raiz ou autenticação paralela.
DO $preflight$
BEGIN
 IF to_regclass('public.staff_members') IS NOT NULL OR to_regclass('public.staff_roles') IS NOT NULL
 OR to_regclass('public.staff_invitations') IS NOT NULL OR to_regclass('public.staff_change_requests') IS NOT NULL OR to_regprocedure('public.staff_can(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'equivalent_structure_requires_reaudit'; END IF;
 IF to_regclass('public.user_roles') IS NULL OR to_regclass('public.financial_audit_log') IS NULL
 OR to_regprocedure('public.fin_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'existing_roles_audit_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND rolbypassrls)
 THEN RAISE EXCEPTION 'verified_function_owner_required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid
 JOIN pg_roles m ON m.oid=am.member WHERE r.rolname='postgres' AND m.rolname IN ('anon','authenticated','service_role'))
 THEN RAISE EXCEPTION 'application_must_not_inherit_owner'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users u WHERE u.id='ec01cf61-f7cb-438e-a864-2e7020198658'::uuid
 AND lower(btrim(u.email))='antoniogarciagarcia375@gmail.com' AND u.email_confirmed_at IS NOT NULL
 AND public.has_role(u.id,'admin')) THEN RAISE EXCEPTION 'designated_inviter_identity_mismatch'; END IF;
END $preflight$;
CREATE TABLE public.staff_roles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL UNIQUE,
 category text NOT NULL CHECK(category IN ('contabilista','financeiro','gestor')),
 permissions text[] NOT NULL DEFAULT '{}', version bigint NOT NULL DEFAULT 1,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON public.staff_roles TO authenticated;
GRANT ALL ON public.staff_roles TO service_role;
ALTER TABLE public.staff_roles ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.staff_members (
 user_id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES public.staff_roles(id),
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','suspended','revoked')),
 permissions text[] NOT NULL DEFAULT '{}', version bigint NOT NULL DEFAULT 1,
 invited_by uuid NOT NULL, invited_at timestamptz NOT NULL DEFAULT clock_timestamp(), accepted_at timestamptz,
 invite_token_hash bytea, invite_expires_at timestamptz,
 invitation_delivery text NOT NULL DEFAULT 'not_queued' CHECK(invitation_delivery IN ('not_queued','queued','failed','suppressed')),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT(user_id,role_id,status,permissions,version,invited_by,invited_at,accepted_at,invite_expires_at,invitation_delivery,updated_at) ON public.staff_members TO authenticated;
GRANT ALL ON public.staff_members TO service_role;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
CREATE TABLE public.staff_change_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operation text NOT NULL CHECK(operation IN ('role.save','member.permissions')),
 payload jsonb NOT NULL, requested_by uuid NOT NULL, requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 reviewed_by uuid, reviewed_at timestamptz, reason text NOT NULL, review_reason text
);
GRANT SELECT ON public.staff_change_requests TO authenticated;
GRANT ALL ON public.staff_change_requests TO service_role;
ALTER TABLE public.staff_change_requests ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.staff_permissions_valid(_permissions text[],_category text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT _permissions IS NOT NULL AND _category IN ('contabilista','financeiro','gestor')
 AND array_position(_permissions,NULL) IS NULL
 AND _permissions <@ ARRAY['finance.view','finance.prepare','finance.approve','finance.process','finance.reject',
 'finance.execute','finance.invoice.register','limits.read','limits.manage','team.read','team.manage','team.approve']::text[]
 AND NOT (_category='contabilista' AND _permissions && ARRAY['finance.execute','finance.process']::text[])
 AND (NOT (_permissions && ARRAY['finance.prepare','finance.approve','finance.process','finance.reject','finance.execute','finance.invoice.register']::text[]) OR 'finance.view'=ANY(_permissions))
 AND (NOT ('limits.manage'=ANY(_permissions)) OR 'limits.read'=ANY(_permissions))
 AND (NOT (_permissions && ARRAY['team.manage','team.approve']::text[]) OR 'team.read'=ANY(_permissions))
 AND (NOT ('team.approve'=ANY(_permissions)) OR _category='gestor')
$fn$;
REVOKE ALL ON FUNCTION public.staff_permissions_valid(text[],text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.staff_can(_permission text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); m public.staff_members; r public.staff_roles;
BEGIN
 IF a IS NULL OR _permission IS NULL OR _permission NOT IN
 ('finance.view','finance.prepare','finance.approve','finance.process','finance.reject','finance.execute',
 'finance.invoice.register','limits.read','limits.manage','team.read','team.manage','team.approve') THEN RETURN false; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=a;
 IF FOUND THEN
  IF m.status<>'active' THEN RETURN false; END IF;
  SELECT * INTO r FROM public.staff_roles WHERE id=m.role_id;
  IF NOT FOUND OR NOT public.staff_permissions_valid(m.permissions,r.category) THEN RETURN false; END IF;
  RETURN _permission=ANY(m.permissions) AND (_permission<>'team.approve' OR r.category='gestor');
 END IF;
 RETURN public.has_role(a,'admin');
END $fn$;
ALTER FUNCTION public.staff_can(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.staff_can(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_can(text) TO authenticated;
CREATE FUNCTION public.staff_authorize(_permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid();
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 IF NOT public.staff_can(_permission) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 RETURN a;
END $fn$;
ALTER FUNCTION public.staff_authorize(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.staff_authorize(text) FROM PUBLIC,anon,authenticated,service_role;
-- Identidade protegida, fixada ao UUID real confirmado; nunca usar email do browser/JWT metadata.
CREATE FUNCTION public.staff_inviter_valid(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT _user='ec01cf61-f7cb-438e-a864-2e7020198658'::uuid
 AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=_user
 AND lower(btrim(u.email))='antoniogarciagarcia375@gmail.com' AND u.email_confirmed_at IS NOT NULL)
 AND public.has_role(_user,'admin')
 AND NOT EXISTS(SELECT 1 FROM public.staff_members m WHERE m.user_id=_user AND m.status<>'active')
$fn$;
ALTER FUNCTION public.staff_inviter_valid(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.staff_inviter_valid(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.staff_invite_authorize() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid();
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 IF a IS NULL OR NOT public.staff_inviter_valid(a) THEN RAISE EXCEPTION 'designated_inviter_only'; END IF;
 RETURN a;
END $fn$;
ALTER FUNCTION public.staff_invite_authorize() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.staff_invite_authorize() FROM PUBLIC,anon,authenticated,service_role;
-- Complemento mínimo necessário: convite por email antes de existir auth.users/user_id.
-- Não alterar a PK de staff_members, nem criar contas fictícias ou autenticação paralela.
CREATE TABLE public.staff_invitations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
 role_id uuid NOT NULL REFERENCES public.staff_roles(id), role_version bigint NOT NULL,
 permissions text[] NOT NULL, invited_by uuid NOT NULL, token_hash bytea,
 expires_at timestamptz NOT NULL, version bigint NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')),
 delivery text NOT NULL DEFAULT 'not_queued' CHECK(delivery IN ('not_queued','queued','failed','suppressed')),
 accepted_by uuid, accepted_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(email=lower(btrim(email)))
);
GRANT SELECT(id,email,role_id,role_version,permissions,invited_by,expires_at,version,status,delivery,
 accepted_by,accepted_at,created_at,updated_at) ON public.staff_invitations TO authenticated;
GRANT ALL ON public.staff_invitations TO service_role;
ALTER TABLE public.staff_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_invitations_read ON public.staff_invitations FOR SELECT TO authenticated
 USING(public.staff_can('team.read'));
CREATE TRIGGER staff_invitations_no_truncate BEFORE TRUNCATE ON public.staff_invitations
 FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();

CREATE POLICY staff_roles_read ON public.staff_roles FOR SELECT TO authenticated
 USING(public.staff_can('team.read') OR EXISTS(SELECT 1 FROM public.staff_members m WHERE m.user_id=auth.uid() AND m.role_id=staff_roles.id));
CREATE POLICY staff_members_read ON public.staff_members FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.staff_can('team.read'));
CREATE POLICY staff_changes_read ON public.staff_change_requests FOR SELECT TO authenticated
 USING(requested_by=auth.uid() OR public.staff_can('team.read'));

CREATE FUNCTION public.admin_request_staff_change(_operation text,_payload jsonb,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; id uuid; m public.staff_members; r public.staff_roles; perms text[]; c text;
BEGIN
 a:=public.staff_authorize('team.manage');
 IF _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 OR _payload IS NULL
 OR jsonb_typeof(_payload)<>'object' THEN RAISE EXCEPTION 'invalid_change'; END IF;
 IF _operation='role.save' THEN
  c:=_payload->>'category';
  IF _payload->>'name' IS NULL OR length(btrim(_payload->>'name')) NOT BETWEEN 2 AND 80 THEN RAISE EXCEPTION 'invalid_role_name'; END IF;
  IF NULLIF(_payload->>'id','') IS NOT NULL THEN
   SELECT * INTO r FROM public.staff_roles WHERE id=(_payload->>'id')::uuid;
   IF NOT FOUND OR r.version IS DISTINCT FROM (_payload->>'version')::bigint THEN RAISE EXCEPTION 'configuration_changed_reload'; END IF;
   -- Role edits cannot indirectly change the requester's or approver's own category.
   IF EXISTS(SELECT 1 FROM public.staff_members x WHERE x.user_id=a AND x.role_id=r.id) THEN RAISE EXCEPTION 'self_change_forbidden'; END IF;
  END IF;
 ELSIF _operation='member.permissions' THEN
  IF (_payload->>'user_id')::uuid=a THEN RAISE EXCEPTION 'self_change_forbidden'; END IF;
  SELECT * INTO m FROM public.staff_members WHERE user_id=(_payload->>'user_id')::uuid;
  IF NOT FOUND OR m.status='revoked' OR m.version IS DISTINCT FROM (_payload->>'version')::bigint THEN RAISE EXCEPTION 'configuration_changed_reload'; END IF;
  SELECT * INTO r FROM public.staff_roles WHERE id=(_payload->>'role_id')::uuid;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_role'; END IF;
  c:=r.category;
 ELSE RAISE EXCEPTION 'invalid_operation'; END IF;
 IF jsonb_typeof(_payload->'permissions') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_permissions'; END IF;
 SELECT COALESCE(array_agg(v),'{}'::text[]) INTO perms FROM jsonb_array_elements_text(_payload->'permissions') v;
 IF NOT public.staff_permissions_valid(perms,c) THEN RAISE EXCEPTION 'invalid_permissions'; END IF;
 INSERT INTO public.staff_change_requests(operation,payload,requested_by,reason)
 VALUES(_operation,_payload,a,btrim(_reason)) RETURNING staff_change_requests.id INTO id;
 PERFORM public.fin_audit('team.change.requested','staff_roles',id::text,NULL,_payload::text,'ok',NULL,jsonb_build_object('reason',_reason));
 RETURN jsonb_build_object('ok',true,'request_id',id,'status','pending');
END $fn$;

CREATE FUNCTION public.admin_review_staff_change(_id uuid,_approve boolean,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; q public.staff_change_requests; m public.staff_members; r public.staff_roles;
 old_state text; new_state text; perms text[]; target uuid;
BEGIN
 a:=public.staff_authorize('team.approve');
 IF _approve IS NULL OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 THEN RAISE EXCEPTION 'reason_required'; END IF;
 SELECT * INTO q FROM public.staff_change_requests WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR q.status<>'pending' THEN RAISE EXCEPTION 'missing_or_terminal_request'; END IF;
 IF q.requested_by=a THEN RAISE EXCEPTION 'self_approval_forbidden'; END IF;
 -- The initiating account must still have authority when its request is approved.
 IF NOT EXISTS(SELECT 1 FROM public.staff_members x JOIN public.staff_roles y ON y.id=x.role_id
 WHERE x.user_id=q.requested_by AND x.status='active' AND public.staff_permissions_valid(x.permissions,y.category)
 AND 'team.manage'=ANY(x.permissions)) AND NOT (public.has_role(q.requested_by,'admin')
 AND NOT EXISTS(SELECT 1 FROM public.staff_members x WHERE x.user_id=q.requested_by))
 THEN RAISE EXCEPTION 'requester_no_longer_authorized'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_members s WHERE s.user_id=q.requested_by AND s.status<>'active')
 THEN RAISE EXCEPTION 'requester_no_longer_authorized'; END IF;
 IF _approve THEN
  SELECT COALESCE(array_agg(v),'{}'::text[]) INTO perms FROM jsonb_array_elements_text(q.payload->'permissions') v;
  IF q.operation='role.save' THEN
   IF NOT public.staff_permissions_valid(perms,q.payload->>'category') THEN RAISE EXCEPTION 'invalid_permissions'; END IF;
   target:=NULLIF(q.payload->>'id','')::uuid;
   IF target IS NULL THEN
    INSERT INTO public.staff_roles(name,category,permissions,created_by)
    VALUES(btrim(q.payload->>'name'),q.payload->>'category',perms,q.requested_by) RETURNING * INTO r;
   ELSE
    SELECT * INTO r FROM public.staff_roles WHERE id=target FOR UPDATE;
    IF NOT FOUND OR r.version IS DISTINCT FROM (q.payload->>'version')::bigint THEN RAISE EXCEPTION 'configuration_changed_reload'; END IF;
    IF EXISTS(SELECT 1 FROM public.staff_members s WHERE s.role_id=r.id AND s.user_id IN (a,q.requested_by)) THEN RAISE EXCEPTION 'self_change_forbidden'; END IF;
    IF EXISTS(SELECT 1 FROM public.staff_members s WHERE s.role_id=r.id AND NOT public.staff_permissions_valid(s.permissions,q.payload->>'category')) THEN RAISE EXCEPTION 'category_conflicts_with_member_permissions'; END IF;
    old_state:=to_jsonb(r)::text;
    UPDATE public.staff_roles SET name=btrim(q.payload->>'name'),category=q.payload->>'category',permissions=perms,
    version=version+1,updated_at=clock_timestamp() WHERE id=r.id RETURNING * INTO r;
   END IF;
   new_state:=to_jsonb(r)::text;
  ELSE
   target:=(q.payload->>'user_id')::uuid;
   IF target IN (a,q.requested_by) OR public.has_role(target,'admin') THEN RAISE EXCEPTION 'self_or_admin_change_forbidden'; END IF;
   SELECT * INTO m FROM public.staff_members WHERE user_id=target FOR UPDATE;
   SELECT * INTO r FROM public.staff_roles WHERE id=(q.payload->>'role_id')::uuid;
   IF m.user_id IS NULL OR r.id IS NULL OR m.status='revoked' OR m.version IS DISTINCT FROM (q.payload->>'version')::bigint THEN RAISE EXCEPTION 'configuration_changed_reload'; END IF;
   IF NOT public.staff_permissions_valid(perms,r.category) THEN RAISE EXCEPTION 'invalid_permissions'; END IF;
   old_state:=(to_jsonb(m)-'invite_token_hash')::text;
   UPDATE public.staff_members SET role_id=r.id,permissions=perms,version=version+1,updated_at=clock_timestamp()
   WHERE user_id=m.user_id RETURNING * INTO m;
   new_state:=(to_jsonb(m)-'invite_token_hash')::text;
  END IF;
 END IF;
 UPDATE public.staff_change_requests SET status=CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
 reviewed_by=a,reviewed_at=clock_timestamp(),review_reason=btrim(_reason) WHERE id=q.id;
 PERFORM public.fin_audit('team.change.'||CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
 CASE WHEN q.operation='role.save' THEN 'staff_roles' ELSE 'staff_members' END,q.id::text,old_state,new_state,'ok',NULL,
 jsonb_build_object('reason',_reason,'requested_by',q.requested_by));
 RETURN jsonb_build_object('ok',true,'status',CASE WHEN _approve THEN 'approved' ELSE 'rejected' END);
END $fn$;

CREATE FUNCTION public.admin_invite_staff(_email text,_role_id uuid,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; t uuid; r public.staff_roles; i public.staff_invitations; token text; e text;
BEGIN
 a:=public.staff_invite_authorize();
 e:=lower(btrim(_email));
 IF e IS NULL OR length(e)>254 OR e !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT u.id INTO t FROM auth.users u WHERE lower(btrim(u.email))=e;
 IF t=a OR public.has_role(t,'admin') THEN RAISE EXCEPTION 'self_or_admin_invitation_forbidden'; END IF;
 IF EXISTS(SELECT 1 FROM public.staff_members m WHERE m.user_id=t AND m.status<>'revoked')
 THEN RAISE EXCEPTION 'member_already_exists'; END IF;
 SELECT * INTO r FROM public.staff_roles WHERE id=_role_id;
 IF NOT FOUND OR NOT public.staff_permissions_valid(r.permissions,r.category) THEN RAISE EXCEPTION 'invalid_role'; END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO public.staff_invitations(email,role_id,role_version,permissions,invited_by,token_hash,expires_at)
 VALUES(e,r.id,r.version,r.permissions,a,extensions.digest(token,'sha256'),clock_timestamp()+interval '7 days')
 ON CONFLICT(email) DO UPDATE SET role_id=EXCLUDED.role_id,role_version=EXCLUDED.role_version,
 permissions=EXCLUDED.permissions,invited_by=a,token_hash=EXCLUDED.token_hash,expires_at=EXCLUDED.expires_at,
 status='pending',delivery='not_queued',accepted_by=NULL,accepted_at=NULL,
 version=staff_invitations.version+1,updated_at=clock_timestamp() RETURNING * INTO i;
 PERFORM public.fin_audit('team.invited','staff_members',i.id::text,NULL,
 (to_jsonb(i)-'token_hash')::text,'ok',NULL,jsonb_build_object('reason',_reason));
 -- Token entregue uma vez ao fluxo autenticado de Gestor 1; nunca logar/retornar ao browser.
 RETURN jsonb_build_object('invitation_id',i.id,'token',token,'version',i.version,'expires_at',i.expires_at);
END $fn$;
-- _user é o UUID do convite, não um UUID fictício de utilizador sem conta.
CREATE FUNCTION public.staff_invitation_recipient(_user uuid,_token text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE i public.staff_invitations; r public.staff_roles;
BEGIN
 PERFORM public.staff_invite_authorize();
 SELECT * INTO i FROM public.staff_invitations WHERE id=_user;
 IF NOT FOUND OR i.invited_by<>auth.uid() OR i.status<>'pending' OR i.expires_at<=clock_timestamp()
 OR _token IS NULL OR _token !~ '^[a-f0-9]{64}$' OR i.token_hash IS NULL
 OR i.token_hash<>extensions.digest(_token,'sha256') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT * INTO r FROM public.staff_roles WHERE id=i.role_id;
 IF NOT FOUND OR r.version<>i.role_version OR r.permissions IS DISTINCT FROM i.permissions
 OR NOT public.staff_permissions_valid(i.permissions,r.category) THEN RAISE EXCEPTION 'invitation_role_changed'; END IF;
 RETURN i.email;
END $fn$;
CREATE FUNCTION public.staff_invitation_delivery(_user uuid,_version bigint,_delivery text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 PERFORM public.staff_invite_authorize();
 IF _delivery IS NULL OR _delivery NOT IN ('queued','failed','suppressed') THEN RAISE EXCEPTION 'invalid_delivery'; END IF;
 UPDATE public.staff_invitations SET delivery=_delivery,updated_at=clock_timestamp()
 WHERE id=_user AND invited_by=auth.uid() AND version=_version AND status='pending'
 AND expires_at>clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation_changed'; END IF;
 -- queued é fila confirmada, nunca prova de chegada à caixa do destinatário.
 PERFORM public.fin_audit('team.invitation.'||_delivery,'staff_members',_user::text,NULL,_delivery,'ok',NULL);
END $fn$;
CREATE FUNCTION public.admin_revoke_staff_invitation(_id uuid,_version bigint,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE i public.staff_invitations;
BEGIN
 PERFORM public.staff_invite_authorize();
 IF _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 THEN RAISE EXCEPTION 'reason_required'; END IF;
 SELECT * INTO i FROM public.staff_invitations WHERE id=_id FOR UPDATE;
 IF NOT FOUND OR i.status<>'pending' OR i.version IS DISTINCT FROM _version THEN RAISE EXCEPTION 'invitation_changed'; END IF;
 UPDATE public.staff_invitations SET status='revoked',token_hash=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
 PERFORM public.fin_audit('team.invitation.revoked','staff_members',i.id::text,NULL,'revoked','ok',NULL,jsonb_build_object('reason',_reason));
 RETURN jsonb_build_object('ok',true);
END $fn$;
CREATE FUNCTION public.accept_staff_invite(_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); e text; i public.staff_invitations; r public.staff_roles; m public.staff_members; n public.staff_members;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF _token IS NULL OR _token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 SELECT lower(btrim(u.email)) INTO e FROM auth.users u WHERE u.id=a AND u.email_confirmed_at IS NOT NULL;
 IF e IS NULL OR public.has_role(a,'admin') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT * INTO i FROM public.staff_invitations WHERE email=e AND status='pending' FOR UPDATE;
 IF NOT FOUND OR i.invited_by=a OR i.expires_at<=clock_timestamp() OR i.token_hash IS NULL
 OR i.token_hash<>extensions.digest(_token,'sha256') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 IF NOT public.staff_inviter_valid(i.invited_by) THEN RAISE EXCEPTION 'inviter_no_longer_authorized'; END IF;
 SELECT * INTO r FROM public.staff_roles WHERE id=i.role_id;
 IF NOT FOUND OR r.version<>i.role_version OR r.permissions IS DISTINCT FROM i.permissions
 OR NOT public.staff_permissions_valid(i.permissions,r.category) THEN RAISE EXCEPTION 'invitation_role_changed'; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=a FOR UPDATE;
 IF FOUND AND m.status<>'revoked' THEN RAISE EXCEPTION 'member_already_exists'; END IF;
 INSERT INTO public.staff_members(user_id,role_id,status,permissions,invited_by,invited_at,accepted_at)
 VALUES(a,r.id,'active',i.permissions,i.invited_by,i.created_at,clock_timestamp())
 ON CONFLICT(user_id) DO UPDATE SET role_id=EXCLUDED.role_id,status='active',permissions=EXCLUDED.permissions,
 invited_by=EXCLUDED.invited_by,invited_at=EXCLUDED.invited_at,accepted_at=EXCLUDED.accepted_at,
 invite_token_hash=NULL,invite_expires_at=NULL,version=staff_members.version+1,updated_at=clock_timestamp()
 RETURNING * INTO n;
 UPDATE public.staff_invitations SET status='accepted',token_hash=NULL,accepted_by=a,
 accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=i.id;
 PERFORM public.fin_audit('team.accepted','staff_members',a::text,(to_jsonb(m)-'invite_token_hash')::text,
 (to_jsonb(n)-'invite_token_hash')::text,'ok',NULL,jsonb_build_object('invitation_id',i.id));
 RETURN jsonb_build_object('ok',true);
END $fn$;
CREATE FUNCTION public.admin_set_staff_status(_user uuid,_status text,_version bigint,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; m public.staff_members; n public.staff_members;
BEGIN
 a:=public.staff_authorize('team.manage');
 IF _user IS NULL OR _user=a OR public.has_role(_user,'admin') OR _status IS NULL
 OR _status NOT IN ('active','suspended','revoked') OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 THEN RAISE EXCEPTION 'invalid_or_self_change'; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND OR m.version IS DISTINCT FROM _version OR m.status='revoked'
 OR (m.accepted_at IS NULL AND _status<>'revoked') THEN RAISE EXCEPTION 'missing_terminal_or_conflict'; END IF;
 IF m.status=_status THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
 UPDATE public.staff_members SET status=_status,version=version+1,updated_at=clock_timestamp(),
 invite_token_hash=CASE WHEN _status='revoked' THEN NULL ELSE invite_token_hash END WHERE user_id=_user RETURNING * INTO n;
 PERFORM public.fin_audit('team.status','staff_members',_user::text,(to_jsonb(m)-'invite_token_hash')::text,(to_jsonb(n)-'invite_token_hash')::text,'ok',NULL,jsonb_build_object('reason',_reason));
 RETURN jsonb_build_object('ok',true,'version',n.version);
END $fn$;
-- Creation/changes use reviewed requests; no direct writes or implicit role promotion.
-- Permission changes affect members only through explicit member.permissions approval,
-- never silently grant new role defaults to every existing member.
ALTER FUNCTION public.admin_request_staff_change(text,jsonb,text) OWNER TO postgres;
ALTER FUNCTION public.admin_review_staff_change(uuid,boolean,text) OWNER TO postgres;
ALTER FUNCTION public.admin_revoke_staff_invitation(uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.admin_invite_staff(text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.staff_invitation_recipient(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.staff_invitation_delivery(uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.accept_staff_invite(text) OWNER TO postgres;
ALTER FUNCTION public.admin_set_staff_status(uuid,text,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_request_staff_change(text,jsonb,text),public.admin_review_staff_change(uuid,boolean,text),
public.admin_invite_staff(text,uuid,text),public.staff_invitation_recipient(uuid,text),public.staff_invitation_delivery(uuid,bigint,text),
public.admin_revoke_staff_invitation(uuid,bigint,text),public.accept_staff_invite(text),public.admin_set_staff_status(uuid,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_staff_change(text,jsonb,text),public.admin_review_staff_change(uuid,boolean,text),
public.admin_invite_staff(text,uuid,text),public.staff_invitation_recipient(uuid,text),public.staff_invitation_delivery(uuid,bigint,text),
public.admin_revoke_staff_invitation(uuid,bigint,text),public.accept_staff_invite(text),public.admin_set_staff_status(uuid,text,bigint,text) TO authenticated;
CREATE TRIGGER staff_members_no_truncate BEFORE TRUNCATE ON public.staff_members FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER staff_roles_no_truncate BEFORE TRUNCATE ON public.staff_roles FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER staff_changes_no_truncate BEFORE TRUNCATE ON public.staff_change_requests FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
