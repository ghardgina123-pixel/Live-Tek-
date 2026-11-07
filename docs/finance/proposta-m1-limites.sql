-- LIVE TEKÁ M1 v3 — configuração existente; SOMENTE REVISÃO, NÃO APLICAR.
-- Fase limitada: administração da linha Angola atual; sem quotas/ledger/mercados paralelos.
-- Dependência: M2 v3 e autorização expressa. Integração conjunta/países futuros não ativada.
DO $preflight$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.withdrawal_limits WHERE currency='AOA'
  AND min_amount=10000 AND max_daily_amount=200000 AND timezone='Africa/Luanda')
 THEN RAISE EXCEPTION 'angola_limits_mismatch'; END IF;
 IF to_regprocedure('public.staff_can(text)') IS NULL THEN RAISE EXCEPTION 'm2_required'; END IF;
 IF to_regprocedure('public.fin_audit(text,text,text,text,text,text,text,jsonb)') IS NULL
 THEN RAISE EXCEPTION 'existing_audit_required'; END IF;
 IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public'
  AND table_name='withdrawal_limits' AND column_name IN ('country_code','market_code','revision'))
 THEN RAISE EXCEPTION 'equivalent_columns_require_reaudit'; END IF;
END $preflight$;
ALTER TABLE public.withdrawal_limits ADD COLUMN country_code text;
ALTER TABLE public.withdrawal_limits ADD COLUMN market_code text;
ALTER TABLE public.withdrawal_limits ADD COLUMN revision bigint NOT NULL DEFAULT 1;
-- Backfill de metadados apenas. Valores monetários e fuso existentes não alterados.
UPDATE public.withdrawal_limits SET country_code='AO', market_code='AO-main' WHERE currency='AOA';
COMMENT ON COLUMN public.withdrawal_limits.country_code IS
 'Contexto explícito; moedas/mercados futuros não são suportados pelo motor AOA atual.';
COMMENT ON COLUMN public.withdrawal_limits.market_code IS
 'Mercado da configuração existente; chave currency preservada. Múltiplos mercados da mesma moeda exigem evolução compatível separada.';
COMMENT ON COLUMN public.financial_settings.min_withdrawal_aoa IS
 'DEPRECATED: withdrawal_limits.min_amount é a única autoridade; não usar como fallback.';

CREATE FUNCTION public.withdrawal_limit_aoa_required() RETURNS public.withdrawal_limits
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r public.withdrawal_limits;
BEGIN
 SELECT * INTO r FROM public.withdrawal_limits WHERE currency='AOA';
 IF NOT FOUND OR r.country_code IS DISTINCT FROM 'AO' OR r.market_code IS DISTINCT FROM 'AO-main'
  OR r.timezone IS DISTINCT FROM 'Africa/Luanda'
  OR r.min_amount IS NULL OR r.max_daily_amount IS NULL
  OR r.min_amount::text IN ('NaN','Infinity','-Infinity')
  OR r.max_daily_amount::text IN ('NaN','Infinity','-Infinity')
  OR r.min_amount<=0 OR r.max_daily_amount<r.min_amount
  OR round(r.min_amount,2)<>r.min_amount OR round(r.max_daily_amount,2)<>r.max_daily_amount
 THEN RAISE EXCEPTION 'financial_configuration_missing_or_invalid'; END IF;
 RETURN r;
END $fn$;
REVOKE ALL ON FUNCTION public.withdrawal_limit_aoa_required() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT (public.withdrawal_limit_aoa_required()).min_amount
$fn$;
CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT (public.withdrawal_limit_aoa_required()).max_daily_amount
$fn$;
REVOKE ALL ON FUNCTION public.min_withdrawal_aoa(),public.max_daily_withdrawal_aoa() FROM PUBLIC,anon;
-- Leituras de configuração, sem dados pessoais nem alteração financeira.
GRANT EXECUTE ON FUNCTION public.min_withdrawal_aoa(),public.max_daily_withdrawal_aoa() TO authenticated,service_role;

CREATE FUNCTION public.admin_save_withdrawal_limit(
 _country text,_market text,_currency text,_min numeric,_max numeric,_revision bigint,_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r public.withdrawal_limits; n public.withdrawal_limits;
BEGIN
 PERFORM public.staff_authorize('limits.manage');
 IF _country IS DISTINCT FROM 'AO' OR _market IS DISTINCT FROM 'AO-main' OR _currency IS DISTINCT FROM 'AOA'
 THEN RAISE EXCEPTION 'unsupported_market_currency'; END IF;
 IF _min IS NULL OR _max IS NULL OR _revision IS NULL OR _reason IS NULL OR length(btrim(_reason))<3
  OR length(_reason)>2000 OR _min::text IN ('NaN','Infinity','-Infinity')
  OR _max::text IN ('NaN','Infinity','-Infinity') OR _min<=0 OR _max<_min
  OR round(_min,2)<>_min OR round(_max,2)<>_max
 THEN RAISE EXCEPTION 'invalid_limit'; END IF;
 SELECT * INTO r FROM public.withdrawal_limits WHERE currency='AOA' FOR UPDATE;
 IF NOT FOUND OR r.revision<>_revision THEN RAISE EXCEPTION 'configuration_changed_reload'; END IF;
 PERFORM public.withdrawal_limit_aoa_required();
 IF r.min_amount=_min AND r.max_daily_amount=_max THEN
  RETURN jsonb_build_object('ok',true,'unchanged',true,'revision',r.revision); END IF;
 UPDATE public.withdrawal_limits SET min_amount=_min,max_daily_amount=_max,
  revision=revision+1,updated_at=clock_timestamp() WHERE currency='AOA' RETURNING * INTO n;
 PERFORM public.fin_audit('limits.updated','withdrawal_limits','AOA',to_jsonb(r)::text,to_jsonb(n)::text,
  'ok',NULL,jsonb_build_object('reason',btrim(_reason),'country','AO','market','AO-main'));
 RETURN jsonb_build_object('ok',true,'revision',n.revision);
END $fn$;
REVOKE ALL ON FUNCTION public.admin_save_withdrawal_limit(text,text,text,numeric,numeric,bigint,text)
 FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_save_withdrawal_limit(text,text,text,numeric,numeric,bigint,text) TO authenticated;
-- Sem escrita direta por browser; inspeção de memberships é bloqueante antes de aplicação.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.withdrawal_limits FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.withdrawal_limits TO authenticated;
-- Auditoria existente: não criar segundo histórico; impedir truncate das roles da app.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.financial_audit_log FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER financial_audit_no_truncate BEFORE TRUNCATE ON public.financial_audit_log
 FOR EACH STATEMENT EXECUTE FUNCTION public.block_mutation();

-- NÃO É CUTOVER: nenhum RPC de pedido/ledger foi substituído por este ficheiro.
-- BLOQUEANTE: adaptar todos os pedidos/writers à soma e lock comum, refletir UI/RLS
-- e executar os 55 testes no isolado antes de habilitar alterações de limites no painel.
-- Não aprovar este SQL como solução multimoeda ou teto conjunto já implementado.
