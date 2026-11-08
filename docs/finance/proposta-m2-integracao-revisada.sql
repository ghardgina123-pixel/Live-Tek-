-- LIVE TEKÁ M2 — equipa operacional sobre autenticação e auditoria existentes.
-- SOMENTE REVISÃO. NÃO APLICADO. Aprovação deste SQL e ensaio isolado obrigatórios.
-- Não modifica user_roles, não cria gestores raiz ou autenticação paralela.
DO $preflight$
BEGIN
 IF to_regclass('public.staff_members') IS NOT NULL OR to_regclass('public.staff_roles') IS NOT NULL
 OR to_regclass('public.staff_change_requests') IS NOT NULL OR to_regprocedure('public.staff_can(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'equivalent_structure_requires_reaudit'; END IF;
 IF to_regclass('public.user_roles') IS NULL OR to_regclass('public.financial_audit_log') IS NULL
 OR to_regprocedure('public.fin_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'existing_roles_audit_required'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres' AND rolbypassrls)
 THEN RAISE EXCEPTION 'verified_function_owner_required'; END IF;
 IF EXISTS(SELECT 1 FROM pg_auth_members am JOIN pg_roles r ON r.oid=am.roleid
 JOIN pg_roles m ON m.oid=am.member WHERE r.rolname='postgres' AND m.rolname IN ('anon','authenticated','service_role'))
 THEN RAISE EXCEPTION 'application_must_not_inherit_owner'; END IF;
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
 'finance.execute','finance.invoice.register','limits.read','limits.manage','team.read','team.manage']::text[]
 AND NOT (_category='contabilista' AND _permissions && ARRAY['finance.execute','finance.process']::text[])
 AND (NOT (_permissions && ARRAY['finance.prepare','finance.approve','finance.process','finance.reject','finance.execute','finance.invoice.register']::text[]) OR 'finance.view'=ANY(_permissions))
 AND (NOT ('limits.manage'=ANY(_permissions)) OR 'limits.read'=ANY(_permissions))
 AND (NOT ('team.manage'=ANY(_permissions)) OR 'team.read'=ANY(_permissions))
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
  IF m.status<>'active' OR _permission='team.approve' THEN RETURN false; END IF;
  SELECT * INTO r FROM public.staff_roles WHERE id=m.role_id;
  IF NOT FOUND OR NOT public.staff_permissions_valid(m.permissions,r.category) THEN RETURN false; END IF;
  RETURN _permission=ANY(m.permissions);
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
 IF NOT public.has_role(q.requested_by,'admin') AND NOT EXISTS(SELECT 1 FROM public.staff_members s
 WHERE s.user_id=q.requested_by AND s.status='active' AND 'team.manage'=ANY(s.permissions))
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
DECLARE a uuid; t uuid; r public.staff_roles; m public.staff_members; token text;
BEGIN
 a:=public.staff_authorize('team.manage');
 IF _email IS NULL OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000 THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT id INTO STRICT t FROM auth.users WHERE lower(btrim(email))=lower(btrim(_email)) AND email_confirmed_at IS NOT NULL;
 IF t=a OR public.has_role(t,'admin') THEN RAISE EXCEPTION 'self_or_admin_invitation_forbidden'; END IF;
 SELECT * INTO r FROM public.staff_roles WHERE id=_role_id;
 IF NOT FOUND OR NOT public.staff_permissions_valid(r.permissions,r.category) THEN RAISE EXCEPTION 'invalid_role'; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=t FOR UPDATE;
 IF FOUND AND m.status NOT IN ('invited','revoked') THEN RAISE EXCEPTION 'member_already_exists'; END IF;
 token:=encode(extensions.gen_random_bytes(32),'hex');
 INSERT INTO public.staff_members(user_id,role_id,permissions,invited_by,invite_token_hash,invite_expires_at)
 VALUES(t,r.id,r.permissions,a,extensions.digest(token,'sha256'),clock_timestamp()+interval '7 days')
 ON CONFLICT(user_id) DO UPDATE SET role_id=EXCLUDED.role_id,permissions=EXCLUDED.permissions,status='invited',
 invited_by=a,invited_at=clock_timestamp(),accepted_at=NULL,invite_token_hash=EXCLUDED.invite_token_hash,
 invite_expires_at=EXCLUDED.invite_expires_at,invitation_delivery='not_queued',version=staff_members.version+1,updated_at=clock_timestamp()
 RETURNING * INTO m;
 PERFORM public.fin_audit('team.invited','staff_members',t::text,NULL,(to_jsonb(m)-'invite_token_hash')::text,'ok',NULL,jsonb_build_object('reason',_reason));
 -- Returned only to the authenticated server flow for immediate email delivery; never log.
 RETURN jsonb_build_object('user_id',t,'token',token,'version',m.version,'expires_at',m.invite_expires_at);
END $fn$;
CREATE FUNCTION public.staff_invitation_recipient(_user uuid,_token text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE m public.staff_members; e text;
BEGIN
 PERFORM public.staff_authorize('team.manage');
 SELECT * INTO m FROM public.staff_members WHERE user_id=_user;
 IF NOT FOUND OR m.invited_by<>auth.uid() OR m.status<>'invited' OR m.invite_expires_at<=clock_timestamp()
 OR _token IS NULL OR _token !~ '^[a-f0-9]{64}$' OR m.invite_token_hash IS NULL
 OR m.invite_token_hash<>extensions.digest(_token,'sha256') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT email INTO e FROM auth.users WHERE id=_user AND email_confirmed_at IS NOT NULL;
 IF e IS NULL THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 RETURN e;
END $fn$;
CREATE FUNCTION public.staff_invitation_delivery(_user uuid,_version bigint,_delivery text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
BEGIN
 PERFORM public.staff_authorize('team.manage');
 IF _delivery IS NULL OR _delivery NOT IN ('queued','failed','suppressed') THEN RAISE EXCEPTION 'invalid_delivery'; END IF;
 UPDATE public.staff_members SET invitation_delivery=_delivery,updated_at=clock_timestamp()
 WHERE user_id=_user AND invited_by=auth.uid() AND version=_version AND status='invited';
 IF NOT FOUND THEN RAISE EXCEPTION 'invitation_changed'; END IF;
 PERFORM public.fin_audit('team.invitation.'||_delivery,'staff_members',_user::text,NULL,_delivery,'ok',NULL);
END $fn$;
CREATE FUNCTION public.accept_staff_invite(_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); m public.staff_members; n public.staff_members; inviter public.staff_members;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF _token IS NULL OR _token !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 SELECT * INTO m FROM public.staff_members WHERE user_id=a FOR UPDATE;
 IF NOT FOUND OR m.status<>'invited' OR m.invited_by=a OR m.invite_expires_at IS NULL
 OR m.invite_expires_at<=clock_timestamp() OR m.invite_token_hash IS NULL
 OR m.invite_token_hash<>extensions.digest(_token,'sha256') OR public.has_role(a,'admin')
 OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a AND email_confirmed_at IS NOT NULL) THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 SELECT * INTO inviter FROM public.staff_members WHERE user_id=m.invited_by;
 IF FOUND THEN
  IF inviter.status<>'active' OR NOT ('team.manage'=ANY(inviter.permissions)) THEN RAISE EXCEPTION 'inviter_no_longer_authorized'; END IF;
 ELSIF NOT public.has_role(m.invited_by,'admin') THEN RAISE EXCEPTION 'inviter_no_longer_authorized'; END IF;
 UPDATE public.staff_members SET status='active',invite_token_hash=NULL,accepted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
 WHERE user_id=a RETURNING * INTO n;
 PERFORM public.fin_audit('team.accepted','staff_members',a::text,(to_jsonb(m)-'invite_token_hash')::text,(to_jsonb(n)-'invite_token_hash')::text,'ok',NULL);
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
ALTER FUNCTION public.admin_invite_staff(text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.staff_invitation_recipient(uuid,text) OWNER TO postgres;
ALTER FUNCTION public.staff_invitation_delivery(uuid,bigint,text) OWNER TO postgres;
ALTER FUNCTION public.accept_staff_invite(text) OWNER TO postgres;
ALTER FUNCTION public.admin_set_staff_status(uuid,text,bigint,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_request_staff_change(text,jsonb,text),public.admin_review_staff_change(uuid,boolean,text),
public.admin_invite_staff(text,uuid,text),public.staff_invitation_recipient(uuid,text),public.staff_invitation_delivery(uuid,bigint,text),
public.accept_staff_invite(text),public.admin_set_staff_status(uuid,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_request_staff_change(text,jsonb,text),public.admin_review_staff_change(uuid,boolean,text),
public.admin_invite_staff(text,uuid,text),public.staff_invitation_recipient(uuid,text),public.staff_invitation_delivery(uuid,bigint,text),
public.accept_staff_invite(text),public.admin_set_staff_status(uuid,text,bigint,text) TO authenticated;
CREATE TRIGGER staff_members_no_truncate BEFORE TRUNCATE ON public.staff_members FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER staff_roles_no_truncate BEFORE TRUNCATE ON public.staff_roles FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER staff_changes_no_truncate BEFORE TRUNCATE ON public.staff_change_requests FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();
