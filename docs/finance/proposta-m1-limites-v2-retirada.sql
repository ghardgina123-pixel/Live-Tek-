-- RETIRADA DO PACOTE ATIVO: referência histórica, não executar.
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

-- M1 / PHASE A : limites versionnées + comptabilité de QUOTA (pas de ledger monétaire).
-- Dépendance stricte: M2 v2 appliquée et attestée, avant toute table/fonction/politique M1.
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
-- app.expected_m2_sha256 deve corresponder ao digest real validado pelo executor/journal.
-- Comentário é atestação do executor privilegiado, NÃO autoridade de clientes.
DO $dependency$
DECLARE o oid; sig text; t text; p record; c record;
 expected text:=current_setting('app.expected_m2_sha256',true);
BEGIN
 SELECT oid INTO o FROM pg_catalog.pg_roles WHERE rolname=current_setting('app.review_owner');
 IF expected IS NULL OR expected !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'm2_checksum_attestation_missing'; END IF;
 FOREACH t IN ARRAY ARRAY['lt_staff_control_v2','lt_root_managers_v2','lt_staff_roles_v2',
   'lt_staff_permissions_v2','lt_staff_role_permissions_v2','lt_staff_members_v2','lt_staff_invites_v2','lt_staff_audit_v2'] LOOP
  SELECT relowner,relrowsecurity,relforcerowsecurity INTO c FROM pg_catalog.pg_class
   WHERE oid=to_regclass('public.'||t);
  IF NOT FOUND OR c.relowner IS DISTINCT FROM o OR NOT c.relrowsecurity OR c.relforcerowsecurity THEN
    RAISE EXCEPTION 'm2_table_owner_or_rls_mismatch:%',t; END IF;
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['lt_review_block_mutation_v2()',
   'lt_staff_allowed_internal_v2(uuid,text)','lt_staff_can_v2(text)','lt_staff_lock_authorize_v2(text)',
   'lt_staff_create_invite_v2(uuid,text,text,text,text)','lt_staff_accept_invite_v2(text)',
   'lt_staff_cancel_invite_v2(uuid,text)','lt_staff_set_status_v2(uuid,text,text)'] LOOP
  SELECT proowner,prosecdef,proconfig INTO p FROM pg_catalog.pg_proc
    WHERE oid=to_regprocedure('public.'||sig);
  IF NOT FOUND OR p.proowner IS DISTINCT FROM o OR NOT p.prosecdef
    OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']::text[] THEN
    RAISE EXCEPTION 'm2_function_attestation_mismatch:%',sig; END IF;
 END LOOP;
 IF pg_catalog.obj_description(to_regclass('public.lt_staff_control_v2'),'pg_class') IS DISTINCT FROM
   ('LiveTeka:M2:v2:approved-sha256='||expected) THEN RAISE EXCEPTION 'm2_approved_checksum_mismatch'; END IF;
END $dependency$;
CREATE TABLE public.lt_financial_markets_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), country_id uuid NOT NULL REFERENCES public.countries(id),
 code text NOT NULL UNIQUE, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
 precision_scale integer NOT NULL CHECK(precision_scale BETWEEN 0 AND 6),
 timezone text NOT NULL, execution_supported boolean NOT NULL DEFAULT false,
 UNIQUE(country_id,code,currency)
);
REVOKE ALL ON public.lt_financial_markets_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_financial_markets_v2 TO service_role;
GRANT SELECT ON public.lt_financial_markets_v2 TO authenticated;
ALTER TABLE public.lt_financial_markets_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_limit_rules_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), market_id uuid REFERENCES public.lt_financial_markets_v2(id),
 currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), min_amount numeric NOT NULL,
 max_daily_amount numeric NOT NULL, timezone text NOT NULL,
 applies_to text[] NOT NULL DEFAULT ARRAY['store','affiliate','courier'],
 combined_daily_cap boolean NOT NULL DEFAULT true, is_active boolean NOT NULL DEFAULT true,
 created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(min_amount::text NOT IN ('NaN','Infinity','-Infinity') AND min_amount>0),
 CHECK(max_daily_amount::text NOT IN ('NaN','Infinity','-Infinity') AND max_daily_amount>=min_amount),
 CHECK(applies_to=ARRAY['store','affiliate','courier']::text[] AND combined_daily_cap)
);
REVOKE ALL ON public.lt_limit_rules_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_limit_rules_v2 TO service_role;
GRANT SELECT ON public.lt_limit_rules_v2 TO authenticated;
ALTER TABLE public.lt_limit_rules_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_limit_history_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid NOT NULL,
 action text NOT NULL, reason text NOT NULL CHECK(btrim(reason)<>''),
 previous_state jsonb, new_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_limit_history_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_limit_history_v2 TO service_role;
GRANT SELECT ON public.lt_limit_history_v2 TO authenticated;
ALTER TABLE public.lt_limit_history_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_settlement_accounts_v2 (
 kind text NOT NULL CHECK(kind IN ('store','affiliate','courier')), entity_id uuid NOT NULL,
 beneficiary_id uuid NOT NULL, market_id uuid NOT NULL REFERENCES public.lt_financial_markets_v2(id),
 verified_by uuid NOT NULL, verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(kind,entity_id)
);
REVOKE ALL ON public.lt_settlement_accounts_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_settlement_accounts_v2 TO service_role;
ALTER TABLE public.lt_settlement_accounts_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_quota_reservations_v2 (
 source_kind text NOT NULL CHECK(source_kind IN ('store','affiliate','courier')), source_id uuid NOT NULL,
 beneficiary_id uuid NOT NULL, market_id uuid NOT NULL REFERENCES public.lt_financial_markets_v2(id),
 currency text NOT NULL, rule_id uuid NOT NULL REFERENCES public.lt_limit_rules_v2(id),
 amount numeric NOT NULL CHECK(amount::text NOT IN ('NaN','Infinity','-Infinity') AND amount>0),
 requested_at timestamptz NOT NULL, timezone text NOT NULL, local_day date NOT NULL,
 bucket_start timestamptz NOT NULL, bucket_end timestamptz NOT NULL CHECK(bucket_end>bucket_start),
 origin text NOT NULL CHECK(origin IN ('request','adoption')), PRIMARY KEY(source_kind,source_id)
);
REVOKE ALL ON public.lt_quota_reservations_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_quota_reservations_v2 TO service_role;
GRANT SELECT ON public.lt_quota_reservations_v2 TO authenticated;
ALTER TABLE public.lt_quota_reservations_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_quota_events_v2 (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_kind text NOT NULL, source_id uuid NOT NULL,
 event text NOT NULL CHECK(event IN ('paid','released')), actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(source_kind,source_id) REFERENCES public.lt_quota_reservations_v2(source_kind,source_id),
 UNIQUE(source_kind,source_id)
);
REVOKE ALL ON public.lt_quota_events_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_quota_events_v2 TO service_role;
GRANT SELECT ON public.lt_quota_events_v2 TO authenticated;
ALTER TABLE public.lt_quota_events_v2 ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.lt_finance_gate_v2 (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 enabled boolean NOT NULL DEFAULT false, adapter_release text, reconciliation_attestation text,
 updated_by uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.lt_finance_gate_v2 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.lt_finance_gate_v2 TO service_role;
GRANT SELECT ON public.lt_finance_gate_v2 TO authenticated;
ALTER TABLE public.lt_finance_gate_v2 ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX lt_rules_exact_one_active_v2 ON public.lt_limit_rules_v2(market_id,currency) WHERE is_active AND market_id IS NOT NULL;
CREATE UNIQUE INDEX lt_rules_global_one_active_v2 ON public.lt_limit_rules_v2(currency) WHERE is_active AND market_id IS NULL;
CREATE INDEX lt_quota_bucket_v2 ON public.lt_quota_reservations_v2(beneficiary_id,market_id,currency,local_day);
-- Deux index empêchent les doublons globaux NULL aussi bien que les règles exactes.
CREATE FUNCTION public.lt_rule_validate_v2() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE m public.lt_financial_markets_v2;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=NEW.timezone) THEN RAISE EXCEPTION 'invalid_timezone'; END IF;
 IF NEW.market_id IS NOT NULL THEN
  SELECT * INTO m FROM public.lt_financial_markets_v2 WHERE id=NEW.market_id;
  IF NOT FOUND OR NEW.currency<>m.currency OR NEW.timezone<>m.timezone
    OR round(NEW.min_amount,m.precision_scale)<>NEW.min_amount
    OR round(NEW.max_daily_amount,m.precision_scale)<>NEW.max_daily_amount THEN RAISE EXCEPTION 'market_currency_precision_mismatch'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'is_active') IS DISTINCT FROM (to_jsonb(OLD)-'is_active') THEN
  RAISE EXCEPTION 'rule_version_immutable'; END IF;
 RETURN NEW;
END;
$fn$;

CREATE TRIGGER lt_rule_validate_v2 BEFORE INSERT OR UPDATE ON public.lt_limit_rules_v2 FOR EACH ROW EXECUTE FUNCTION public.lt_rule_validate_v2();
CREATE TRIGGER lt_rules_no_delete_v2 BEFORE DELETE ON public.lt_limit_rules_v2 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE FUNCTION public.lt_resolve_rule_internal_v2(p_market uuid, p_currency text, p_kind text) RETURNS public.lt_limit_rules_v2
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE m public.lt_financial_markets_v2; r public.lt_limit_rules_v2;
BEGIN
 IF p_market IS NULL OR p_currency IS NULL OR p_kind IS NULL OR p_kind NOT IN ('store','affiliate','courier') THEN
  RAISE EXCEPTION 'invalid_financial_context'; END IF;
 SELECT * INTO m FROM public.lt_financial_markets_v2 WHERE id=p_market;
 IF NOT FOUND OR NOT m.execution_supported OR m.currency<>p_currency THEN RAISE EXCEPTION 'unsupported_market_currency'; END IF;
 -- Présence règle spécifique inactive = refus, JAMAIS fallback global pour contourner suspension.
 IF EXISTS(SELECT 1 FROM public.lt_limit_rules_v2 WHERE market_id=p_market AND currency=p_currency) THEN
  SELECT * INTO r FROM public.lt_limit_rules_v2 WHERE market_id=p_market AND currency=p_currency AND is_active;
 ELSE
  SELECT * INTO r FROM public.lt_limit_rules_v2 WHERE market_id IS NULL AND currency=p_currency AND is_active;
 END IF;
 IF NOT FOUND OR r.id IS NULL OR r.min_amount IS NULL OR r.max_daily_amount IS NULL
    OR r.timezone<>m.timezone OR NOT(p_kind=ANY(r.applies_to)) OR NOT r.combined_daily_cap THEN
  RAISE EXCEPTION 'financial_configuration_missing_or_invalid'; END IF;
 RETURN r;
END;
$fn$;

CREATE FUNCTION public.lt_admin_save_limit_v2(p_market uuid, p_currency text, p_min numeric, p_max numeric, p_reason text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid; m public.lt_financial_markets_v2; prev public.lt_limit_rules_v2; n uuid;
BEGIN
 a:=public.lt_staff_lock_authorize_v2('limits.manage');
 IF p_market IS NULL OR p_currency IS NULL OR p_reason IS NULL OR btrim(p_reason)=''
  OR p_min IS NULL OR p_max IS NULL OR p_min::text IN ('NaN','Infinity','-Infinity')
  OR p_max::text IN ('NaN','Infinity','-Infinity') OR p_min<=0 OR p_max<p_min THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 -- Ordre: autorisation -> lock marché partagé/exclusif -> bénéficiaire -> ressource -> demande.
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:market:'||p_market::text||':'||p_currency,0));
 SELECT * INTO m FROM public.lt_financial_markets_v2 WHERE id=p_market;
 IF NOT FOUND OR m.currency<>p_currency OR NOT m.execution_supported
   OR round(p_min,m.precision_scale)<>p_min OR round(p_max,m.precision_scale)<>p_max THEN RAISE EXCEPTION 'unsupported_market_or_precision'; END IF;
 SELECT * INTO prev FROM public.lt_limit_rules_v2 WHERE market_id=p_market AND currency=p_currency AND is_active FOR UPDATE;
 -- Réduction du plafond n'efface pas consommation passée: nouveaux appels refusés jusqu'à disponible.
 UPDATE public.lt_limit_rules_v2 SET is_active=false WHERE id=prev.id;
 INSERT INTO public.lt_limit_rules_v2(market_id,currency,min_amount,max_daily_amount,timezone,created_by)
 VALUES(p_market,p_currency,p_min,p_max,m.timezone,a) RETURNING id INTO n;
 INSERT INTO public.lt_limit_history_v2(actor_id,action,reason,previous_state,new_state)
 SELECT a,'rule_replaced',p_reason,CASE WHEN prev.id IS NULL THEN NULL ELSE to_jsonb(prev) END,to_jsonb(r)
 FROM public.lt_limit_rules_v2 r WHERE id=n;
 RETURN n;
END;
$fn$;

CREATE FUNCTION public.lt_admin_set_limit_active_v2(p_rule uuid, p_active boolean, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE a uuid; r public.lt_limit_rules_v2;
BEGIN
 a:=public.lt_staff_lock_authorize_v2('limits.manage');
 IF p_active IS NULL OR p_reason IS NULL OR btrim(p_reason)='' THEN RAISE EXCEPTION 'invalid_activation'; END IF;
 SELECT * INTO r FROM public.lt_limit_rules_v2 WHERE id=p_rule;
 IF NOT FOUND OR r.market_id IS NULL THEN RAISE EXCEPTION 'missing_or_global_rule_requires_deployment'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:market:'||r.market_id::text||':'||r.currency,0));
 SELECT * INTO r FROM public.lt_limit_rules_v2 WHERE id=p_rule FOR UPDATE;
 IF r.is_active=p_active THEN RETURN; END IF;
 IF p_active AND EXISTS(SELECT 1 FROM public.lt_limit_rules_v2 WHERE market_id=r.market_id AND currency=r.currency AND is_active) THEN
  RAISE EXCEPTION 'another_rule_active'; END IF;
 UPDATE public.lt_limit_rules_v2 SET is_active=p_active WHERE id=p_rule;
 INSERT INTO public.lt_limit_history_v2(actor_id,action,reason,previous_state,new_state)
 SELECT a,'activation_changed',p_reason,to_jsonb(r),to_jsonb(n) FROM public.lt_limit_rules_v2 n WHERE id=p_rule;
END;
$fn$;

CREATE FUNCTION public.lt_quota_reserve_internal_v2(p_kind text, p_source uuid, p_entity uuid, p_amount numeric, p_requested_at timestamptz) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE ac public.lt_settlement_accounts_v2; m public.lt_financial_markets_v2;
 r public.lt_limit_rules_v2; prev public.lt_quota_reservations_v2; t timestamptz; d date;
 used numeric; s timestamptz; e timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.lt_finance_gate_v2 WHERE singleton AND enabled
  AND adapter_release IS NOT NULL AND reconciliation_attestation IS NOT NULL) THEN RAISE EXCEPTION 'v2_cutover_not_authorized'; END IF;
 IF p_source IS NULL OR p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<=0
  OR p_requested_at IS NULL THEN RAISE EXCEPTION 'invalid_reservation'; END IF;
 SELECT * INTO ac FROM public.lt_settlement_accounts_v2 WHERE kind=p_kind AND entity_id=p_entity;
 IF NOT FOUND OR ac.beneficiary_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'unverified_or_foreign_settlement_account'; END IF;
 -- Doit être appelé par adaptateur APRÈS lock marché + bénéficiaire et AVANT lock ressource.
 -- Ces locks sont repris ici, mais ne corrigent PAS une inversion déjà acquise par un appelant.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lt:market:'||ac.market_id::text||':'||
  (SELECT currency FROM public.lt_financial_markets_v2 WHERE id=ac.market_id),0));
 SELECT * INTO m FROM public.lt_financial_markets_v2 WHERE id=ac.market_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'market_missing'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:quota:'||ac.beneficiary_id::text||':'||ac.market_id::text||':'||m.currency,0));
 SELECT * INTO prev FROM public.lt_quota_reservations_v2 WHERE source_kind=p_kind AND source_id=p_source;
 IF FOUND THEN
  IF prev.beneficiary_id<>ac.beneficiary_id OR prev.market_id<>ac.market_id OR prev.currency<>m.currency
    OR prev.amount<>p_amount OR prev.requested_at<>p_requested_at THEN RAISE EXCEPTION 'idempotency_mismatch'; END IF;
  RETURN;
 END IF;
 r:=public.lt_resolve_rule_internal_v2(ac.market_id,m.currency,p_kind);
 t:=clock_timestamp(); -- instant capturé après attente, et non now() au début de transaction.
 IF p_requested_at>t OR p_requested_at<t-interval '5 minutes' THEN RAISE EXCEPTION 'adoption_requires_separate_reconciliation'; END IF;
 d:=(t AT TIME ZONE r.timezone)::date;
 s:=d::timestamp AT TIME ZONE r.timezone; e:=(d+1)::timestamp AT TIME ZONE r.timezone;
 IF p_amount<r.min_amount OR round(p_amount,m.precision_scale)<>p_amount THEN RAISE EXCEPTION 'below_minimum_or_invalid_precision'; END IF;
 SELECT coalesce(sum(q.amount),0) INTO used FROM public.lt_quota_reservations_v2 q
 WHERE q.beneficiary_id=ac.beneficiary_id AND q.market_id=ac.market_id AND q.currency=m.currency AND q.local_day=d
 AND NOT EXISTS(SELECT 1 FROM public.lt_quota_events_v2 ev WHERE ev.source_kind=q.source_kind AND ev.source_id=q.source_id AND ev.event='released');
 IF used+p_amount>r.max_daily_amount THEN RAISE EXCEPTION 'combined_daily_limit_exceeded'; END IF;
 -- Pas de vérification de saldo ici: l'adaptateur/ledger source la réalise dans la même transaction.
 INSERT INTO public.lt_quota_reservations_v2(source_kind,source_id,beneficiary_id,market_id,currency,rule_id,
  amount,requested_at,timezone,local_day,bucket_start,bucket_end,origin)
 VALUES(p_kind,p_source,ac.beneficiary_id,ac.market_id,m.currency,r.id,p_amount,p_requested_at,r.timezone,d,s,e,'request');
END;
$fn$;

CREATE FUNCTION public.lt_quota_terminal_internal_v2(p_kind text, p_source uuid, p_event text, p_actor uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp AS $fn$
DECLARE q public.lt_quota_reservations_v2; ev public.lt_quota_events_v2;
BEGIN
 IF p_actor IS NULL OR p_event IS NULL OR p_event NOT IN ('paid','released') THEN RAISE EXCEPTION 'invalid_quota_event'; END IF;
 SELECT * INTO q FROM public.lt_quota_reservations_v2 WHERE source_kind=p_kind AND source_id=p_source;
 IF NOT FOUND THEN RAISE EXCEPTION 'unreconciled_request'; END IF;
 -- Pas besoin de règle actuelle active pour traiter/reconcilier une ancienne réserve.
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('lt:market:'||q.market_id::text||':'||q.currency,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('lt:quota:'||q.beneficiary_id::text||':'||q.market_id::text||':'||q.currency,0));
 SELECT * INTO ev FROM public.lt_quota_events_v2 WHERE source_kind=p_kind AND source_id=p_source;
 IF FOUND THEN
  IF ev.event<>p_event THEN RAISE EXCEPTION 'terminal_quota_conflict'; END IF;
  RETURN;
 END IF;
 -- Précondition obligatoire adaptateur: transition source réelle, définitive, légitime dans CETTE transaction.
 -- Le callback paid exige preuve bancaire officielle; cette fonction privée n'est pas une preuve.
 INSERT INTO public.lt_quota_events_v2(source_kind,source_id,event,actor_id) VALUES(p_kind,p_source,p_event,p_actor);
END;
$fn$;

-- Bootstrap autorisé futur: identité réelle, pays exact et configuration legacy attestée.
DO $angola$
DECLARE c uuid; a uuid:=current_setting('app.review_actor')::uuid; m uuid; r uuid;
BEGIN
 SELECT id INTO c FROM public.countries WHERE code='AO' AND currency_code='AOA';
 IF NOT FOUND THEN RAISE EXCEPTION 'angola_aoa_missing_or_invalid'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.withdrawal_limits WHERE currency='AOA' AND min_amount=10000
  AND max_daily_amount=200000 AND timezone='Africa/Luanda') THEN RAISE EXCEPTION 'legacy_angola_limits_mismatch'; END IF;
 INSERT INTO public.lt_financial_markets_v2(country_id,code,currency,precision_scale,timezone,execution_supported)
 VALUES(c,'AO-main','AOA',2,'Africa/Luanda',true) RETURNING id INTO m;
 INSERT INTO public.lt_limit_rules_v2(market_id,currency,min_amount,max_daily_amount,timezone,created_by)
 VALUES(m,'AOA',10000,200000,'Africa/Luanda',a) RETURNING id INTO r;
 INSERT INTO public.lt_limit_history_v2(actor_id,action,reason,new_state)
 SELECT a,'bootstrap_angola','Configuração inicial Angola preservada 10.000/200.000 AOA',to_jsonb(n)
 FROM public.lt_limit_rules_v2 n WHERE id=r;
 INSERT INTO public.lt_finance_gate_v2(singleton,enabled,updated_by) VALUES(true,false,a);
END $angola$;
-- Aucune affectation arbitraire d'un pays depuis profiles, aucune conversion AOA implicite.
-- Aucun backfill de bénéficiaires historiques sans preuve d'attribution ni de saldo historique.
-- Marchés/identités de règlement sont un registre immuable, sans RPC d'édition publique.
-- Changement fuso/global/support moeda: phase séparée avec activation au prochain boundary,
-- pas une édition en place; vieux buckets préservés et consommation réconciliée.
-- Propriétaire commun vérifié: contourne RLS uniquement pour les tables dont il est propriétaire.
-- Pas de FORCE RLS: les évaluateurs internes ne doivent pas récursivement appeler leurs politiques.
DO $ownership$
DECLARE o text := current_setting('app.review_owner'); r record;
BEGIN
  EXECUTE format('ALTER TABLE public.lt_financial_markets_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_limit_rules_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_limit_history_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_settlement_accounts_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_quota_reservations_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_quota_events_v2 OWNER TO %I',o);
  EXECUTE format('ALTER TABLE public.lt_finance_gate_v2 OWNER TO %I',o);
  FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('lt_rule_validate_v2','lt_resolve_rule_internal_v2','lt_admin_save_limit_v2','lt_admin_set_limit_active_v2','lt_quota_reserve_internal_v2','lt_quota_terminal_internal_v2') LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO %I',r.signature,o);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',r.signature);
  END LOOP;
END $ownership$;
GRANT EXECUTE ON FUNCTION public.lt_admin_save_limit_v2(uuid,text,numeric,numeric,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lt_admin_set_limit_active_v2(uuid,boolean,text) TO authenticated;
CREATE POLICY lt_financial_markets_v2_read_v2 ON public.lt_financial_markets_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('limits.manage'));
CREATE POLICY lt_limit_rules_v2_read_v2 ON public.lt_limit_rules_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('limits.manage'));
CREATE POLICY lt_limit_history_v2_read_v2 ON public.lt_limit_history_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('limits.audit.read'));
CREATE POLICY lt_quota_reservations_v2_read_v2 ON public.lt_quota_reservations_v2 FOR SELECT TO authenticated USING (beneficiary_id=auth.uid() OR public.lt_staff_can_v2('limits.audit.read'));
CREATE POLICY lt_quota_events_v2_read_v2 ON public.lt_quota_events_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('limits.audit.read'));
CREATE POLICY lt_finance_gate_v2_read_v2 ON public.lt_finance_gate_v2 FOR SELECT TO authenticated USING (public.lt_staff_can_v2('limits.manage'));
CREATE TRIGGER lt_financial_markets_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_financial_markets_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_financial_markets_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_financial_markets_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_settlement_accounts_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_settlement_accounts_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_settlement_accounts_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_settlement_accounts_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_limit_history_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_limit_history_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_limit_history_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_limit_history_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_quota_reservations_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_quota_reservations_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_quota_reservations_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_quota_reservations_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_quota_events_v2_immutable_v2 BEFORE UPDATE OR DELETE ON public.lt_quota_events_v2
 FOR EACH ROW EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_quota_events_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_quota_events_v2
 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_limit_rules_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_limit_rules_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
CREATE TRIGGER lt_finance_gate_v2_no_truncate_v2 BEFORE TRUNCATE ON public.lt_finance_gate_v2 FOR EACH STATEMENT EXECUTE FUNCTION public.lt_review_block_mutation_v2();
-- IMPORTANT: ce paquet ne contient aucun adaptateur financier exécutable, aucune
-- activation du gate et aucune modification des RPCs existantes. C'est volontaire.
-- Ne pas présenter lt_quota_* comme enforcement du trafic actuel.
-- Contrat complet d'adaptateurs/adoption/cutover/repli et matrice: document MD.
-- Remplacer les helpers AOA avant ces adaptateurs casserait les consommateurs
-- (NULL contourne IF; signatures sans contexte ne peuvent pas résoudre un marché).
