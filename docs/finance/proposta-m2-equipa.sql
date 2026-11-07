-- LIVE TEKÁ M2 v3 — complemento da autorização existente; SOMENTE REVISÃO.
-- Sem nova autenticação, user_roles.admin, gestor raiz ou ledger paralelo.
-- Estado de vínculo ausente no catálogo; concessões sensíveis não incluídas/não ativadas.
-- BLOQUEANTE: revisão de ownership/ACL/RLS recursiva ainda PENDENTE; não instalar
-- enquanto não existir ensaio isolado. Reconvites não suportados: vínculo é único.
DO $preflight$
BEGIN
 IF to_regclass('public.user_roles') IS NULL OR to_regclass('public.financial_audit_log') IS NULL
 THEN RAISE EXCEPTION 'existing_roles_audit_required'; END IF;
 IF to_regclass('public.staff_members') IS NOT NULL
  OR to_regprocedure('public.staff_can(text)') IS NOT NULL
 THEN RAISE EXCEPTION 'equivalent_structure_requires_reaudit'; END IF;
END $preflight$;
CREATE TABLE public.staff_members (
 user_id uuid PRIMARY KEY,
 category text NOT NULL CHECK(category IN ('contabilista','financeiro','gestor')),
 status text NOT NULL DEFAULT 'invited' CHECK(status IN ('invited','active','suspended','revoked')),
 version bigint NOT NULL DEFAULT 1,
 invited_by uuid NOT NULL,
 invited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 accepted_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON public.staff_members TO authenticated;
GRANT SELECT ON public.staff_members TO service_role;
ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;
-- Não adicionar FK a auth.users: vínculo UUID acompanha identidade existente.

CREATE FUNCTION public.staff_can(_permission text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); m public.staff_members;
BEGIN
 IF a IS NULL OR _permission IS NULL OR _permission NOT IN
 ('finance.view','finance.prepare','finance.approve','finance.process','finance.reject',
  'finance.execute','finance.invoice.register','limits.manage','team.manage','team.read')
 THEN RETURN false; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=a;
 -- Deny-first: vínculo presente sobrepõe papel admin legado.
 IF FOUND THEN
  IF m.status<>'active' THEN RETURN false; END IF;
  IF m.category='contabilista' AND _permission='finance.execute' THEN RETURN false; END IF;
  -- Primeira fase: conjuntos sem poderes sensíveis nem redelegação.
  RETURN m.category IN ('contabilista','financeiro') AND _permission IN ('finance.view','finance.prepare');
 END IF;
 -- Compatibilidade dos gestores atuais, sem promover funcionários.
 RETURN public.has_role(a,'admin');
END $fn$;
REVOKE ALL ON FUNCTION public.staff_can(text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.staff_can(text) TO authenticated;

CREATE FUNCTION public.staff_authorize(_permission text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid();
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 -- Ordem obrigatória: autorização -> beneficiário -> locks legados -> linhas.
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 IF NOT public.staff_can(_permission) THEN RAISE EXCEPTION 'not_authorized'; END IF;
 RETURN a;
END $fn$;
REVOKE ALL ON FUNCTION public.staff_authorize(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.admin_invite_staff(_email text,_category text,_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; t uuid; e text:=lower(btrim(_email)); n public.staff_members;
BEGIN
 a:=public.staff_authorize('team.manage');
 IF _category IS NULL OR _category NOT IN ('contabilista','financeiro') OR e IS NULL OR e=''
  OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000
 THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 -- Contas já registadas e confirmadas: sem token transmissível e sem novo signup.
 SELECT id INTO STRICT t FROM auth.users WHERE lower(btrim(email))=e AND email_confirmed_at IS NOT NULL;
 IF t=a OR public.has_role(t,'admin') THEN RAISE EXCEPTION 'self_or_admin_invitation_forbidden'; END IF;
 INSERT INTO public.staff_members(user_id,category,invited_by) VALUES(t,_category,a) RETURNING * INTO n;
 PERFORM public.fin_audit('team.invited','staff_members',t::text,NULL,to_jsonb(n)::text,'ok',NULL,
  jsonb_build_object('reason',btrim(_reason)));
 RETURN t;
END $fn$;
REVOKE ALL ON FUNCTION public.admin_invite_staff(text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_invite_staff(text,text,text) TO authenticated;

CREATE FUNCTION public.accept_staff_invite() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid:=auth.uid(); m public.staff_members; n public.staff_members;
BEGIN
 IF a IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:staff:authorization',0));
 SELECT * INTO m FROM public.staff_members WHERE user_id=a FOR UPDATE;
 IF NOT FOUND OR m.status<>'invited' OR m.invited_by=a
  OR m.invited_at<=clock_timestamp()-interval '7 days'
  OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=a AND email_confirmed_at IS NOT NULL)
  OR public.has_role(a,'admin') THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
 -- Convidante só pode ser admin legado ativo, sem vínculo revogado/suspenso.
 IF NOT public.has_role(m.invited_by,'admin')
  OR EXISTS(SELECT 1 FROM public.staff_members WHERE user_id=m.invited_by)
 THEN RAISE EXCEPTION 'inviter_no_longer_authorized'; END IF;
 UPDATE public.staff_members SET status='active',accepted_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1
 WHERE user_id=a RETURNING * INTO n;
 PERFORM public.fin_audit('team.accepted','staff_members',a::text,to_jsonb(m)::text,to_jsonb(n)::text,'ok',NULL);
 RETURN jsonb_build_object('ok',true);
END $fn$;
REVOKE ALL ON FUNCTION public.accept_staff_invite() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.accept_staff_invite() TO authenticated;

CREATE FUNCTION public.admin_set_staff_status(_user uuid,_status text,_version bigint,_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE a uuid; m public.staff_members; n public.staff_members;
BEGIN
 a:=public.staff_authorize('team.manage');
 IF _user IS NULL OR a=_user OR _status IS NULL OR _status NOT IN ('active','suspended','revoked')
  OR _version IS NULL OR _reason IS NULL OR length(btrim(_reason))<3 OR length(_reason)>2000
 THEN RAISE EXCEPTION 'invalid_or_self_change'; END IF;
 SELECT * INTO m FROM public.staff_members WHERE user_id=_user FOR UPDATE;
 IF NOT FOUND OR m.status='revoked' OR m.version<>_version OR m.accepted_at IS NULL
  OR public.has_role(_user,'admin') THEN RAISE EXCEPTION 'missing_terminal_or_conflict'; END IF;
 IF m.status=_status THEN RETURN jsonb_build_object('ok',true,'unchanged',true); END IF;
 UPDATE public.staff_members SET status=_status,version=version+1,updated_at=clock_timestamp()
 WHERE user_id=_user RETURNING * INTO n;
 PERFORM public.fin_audit('team.status','staff_members',_user::text,to_jsonb(m)::text,to_jsonb(n)::text,
  'ok',NULL,jsonb_build_object('reason',btrim(_reason)));
 RETURN jsonb_build_object('ok',true,'version',n.version);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_set_staff_status(uuid,text,bigint,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_staff_status(uuid,text,bigint,text) TO authenticated;
CREATE POLICY staff_members_read ON public.staff_members FOR SELECT TO authenticated
 USING(user_id=auth.uid() OR public.staff_can('team.read'));
CREATE TRIGGER staff_members_no_truncate BEFORE TRUNCATE ON public.staff_members
 FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();

-- BLOQUEANTE: nenhuma nova permissão habilitada nos caminhos atuais por este SQL.
-- Adaptar cada RPC/RLS/server function e guard do painel numa integração indivisível.
-- Nunca adicionar uma política permissiva para contornar as políticas existentes.
-- Estado legado admin preservado; suspensão de admins exige workflow independente
-- e transição universal ainda não incluídos. Não anunciar suspensão universal.
-- Não há grants sensíveis positivos nem promoção de papéis neste pacote limitado.
-- Futuro workflow granular deve ser revisto antes de poderes de aprovação/execução/delegação.
-- Owners SECURITY DEFINER: usar proprietário existente só após inspeção de ACL/memberships;
-- nenhum CREATE ROLE ou REVOKE de pertença da plataforma; preflight efetivo ainda PENDENTE.
