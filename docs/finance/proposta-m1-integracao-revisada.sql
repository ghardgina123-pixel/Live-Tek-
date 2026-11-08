-- LIVE TEKÁ — integração de operações financeiras existentes. SOMENTE REVISÃO.
-- Executar somente depois de M2 revisto aprovado; nenhuma alteração aplicada.

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
 PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:limits:configuration',0));
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



CREATE FUNCTION public.user_withdrawn_today(_user_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
 SELECT COALESCE((SELECT SUM(w.amount_aoa) FROM public.store_withdrawals w
 WHERE w.requested_by=_user_id AND w.status<>'REJECTED'
 AND w.created_at>=public.withdrawal_day_start('AOA')),0)
 + COALESCE((SELECT SUM(p.amount_aoa) FROM public.payout_requests p
 WHERE p.user_id=_user_id AND p.kind IN ('affiliate','courier')
 AND p.status NOT IN ('cancelled','rejected')
 AND p.created_at>=public.withdrawal_day_start('AOA')),0)
$fn$;
REVOKE ALL ON FUNCTION public.user_withdrawn_today(uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.withdrawal_day_start(_currency text DEFAULT 'AOA') RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE r public.withdrawal_limits;
BEGIN
 IF _currency IS DISTINCT FROM 'AOA' THEN RAISE EXCEPTION 'unsupported_market_currency'; END IF;
 r:=public.withdrawal_limit_aoa_required();
 RETURN date_trunc('day',now() AT TIME ZONE r.timezone) AT TIME ZONE r.timezone;
END $fn$;
REVOKE ALL ON FUNCTION public.withdrawal_day_start(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.withdrawal_day_start(text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.request_store_withdrawal(_store_id uuid, _amount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; b record; v_id uuid; v_amt numeric := ROUND(_amount, 2);
        v_max numeric; v_min numeric; v_today numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:not_owner',NULL);
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('liveteka:limits:configuration',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:withdrawal:AOA:'||auth.uid()::text,0));
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||_store_id::text));
  IF _amount IS NULL OR _amount::text IN ('NaN','Infinity','-Infinity') OR _amount<=0 OR round(_amount,2)<>_amount THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:invalid_amount',NULL, jsonb_build_object('amount',v_amt));
    RETURN jsonb_build_object('ok',false,'reason','invalid_amount');
  END IF;
  v_max := public.max_daily_withdrawal_aoa();
  v_min := public.min_withdrawal_aoa();
  v_today := public.user_withdrawn_today(auth.uid());
  IF v_today + v_amt > v_max THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:daily_limit',NULL,
      jsonb_build_object('amount',v_amt,'withdrawn_today',v_today,'max_daily',v_max));
    RETURN jsonb_build_object('ok',false,'reason','daily_limit','max_daily_aoa',v_max,'remaining_today_aoa',GREATEST(v_max - v_today,0));
  END IF;
  IF v_amt < v_min THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:below_minimum',NULL,
      jsonb_build_object('amount',v_amt,'min_amount',v_min));
    RETURN jsonb_build_object('ok',false,'reason','below_minimum_limit','min_amount_aoa',v_min);
  END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  IF v_amt > b.available THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:insufficient_balance',NULL, jsonb_build_object('amount',v_amt,'available',b.available));
    RETURN jsonb_build_object('ok',false,'reason','insufficient_balance');
  END IF;
  IF EXISTS (SELECT 1 FROM public.store_withdrawals WHERE store_id=_store_id AND status IN ('PENDING_REVIEW','APPROVED','PROCESSING')) THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:open_request',NULL);
    RETURN jsonb_build_object('ok',false,'reason','open_request');
  END IF;
  INSERT INTO public.store_withdrawals(store_id, requested_by, amount_aoa) VALUES (_store_id, auth.uid(), v_amt) RETURNING id INTO v_id;
  INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_available, delta_reserved, origin, event_ref, idempotency_key, created_by)
  VALUES (_store_id, v_id, 'withdrawal_reserve', v_amt, -v_amt, v_amt, 'withdrawal_request', 'withdrawal:'||v_id, 'wd_reserve:'||v_id, auth.uid());
  PERFORM public.fin_audit('withdrawal_request','withdrawal',v_id::text,NULL,'PENDING_REVIEW','ok','wd_reserve:'||v_id, jsonb_build_object('amount',v_amt));
  RETURN jsonb_build_object('ok',true,'id',v_id);
END $function$;

CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'multicaixa_express'::text, _destination jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_available numeric; v_amount numeric;
        v_min numeric; v_remaining numeric; v_id uuid; v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('liveteka:limits:configuration',0));
  PERFORM pg_advisory_xact_lock(hashtextextended('liveteka:withdrawal:AOA:'||v_uid::text,0));
  PERFORM pg_advisory_xact_lock(hashtext('payout:'||v_uid::text||':'||_kind));
  v_state := CASE WHEN _kind = 'affiliate' THEN public.affiliate_withdrawable() ELSE public.courier_withdrawable() END;
  v_min := public.min_withdrawal_aoa();
  IF (v_state->>'has_open_request')::boolean THEN
    PERFORM public.fin_audit('payout_request',_kind,v_uid::text,NULL,NULL,'rejected:open_request',NULL);
    RETURN jsonb_build_object('ok', false, 'reason', 'open_request');
  END IF;
  v_available := COALESCE((v_state->>'available_aoa')::numeric, 0);
  IF v_available <= 0 THEN
    PERFORM public.fin_audit('payout_request',_kind,v_uid::text,NULL,NULL,'rejected:insufficient_balance',NULL, jsonb_build_object('available',v_available));
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'available_aoa', v_available);
  END IF;
  v_remaining := GREATEST(public.max_daily_withdrawal_aoa() - public.user_withdrawn_today(v_uid), 0);
  IF v_remaining <= 0 THEN
    PERFORM public.fin_audit('payout_request',_kind,v_uid::text,NULL,NULL,'rejected:daily_limit',NULL);
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_limit', 'max_daily_aoa', public.max_daily_withdrawal_aoa());
  END IF;
  v_amount := LEAST(v_available, v_remaining);
  IF v_amount < v_min THEN
    PERFORM public.fin_audit('payout_request',_kind,v_uid::text,NULL,NULL,'rejected:below_minimum',NULL,
      jsonb_build_object('amount',v_amount,'available',v_available,'min_amount',v_min));
    RETURN jsonb_build_object('ok', false, 'reason', 'below_minimum_limit', 'min_amount_aoa', v_min, 'available_aoa', v_available);
  END IF;
  v_due := now() + interval '72 hours';
  INSERT INTO public.payout_requests (user_id, kind, amount_aoa, method, destination, due_at)
  VALUES (v_uid, _kind, v_amount, COALESCE(NULLIF(_method,''), 'multicaixa_express'), COALESCE(_destination, '{}'::jsonb), v_due)
  RETURNING id INTO v_id;
  PERFORM public.fin_audit('payout_request',_kind,v_id::text,NULL,'pending','ok',NULL,
    jsonb_build_object('amount_aoa',v_amount,'user_id',v_uid,'due_at',v_due));
  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_uid, 'payout.requested', 'Pedido de levantamento registado',
          'Kz ' || to_char(v_amount, 'FM999G999G999D00') || ' — processamento até ' || to_char(v_due, 'DD/MM/YYYY HH24:MI') || '.',
          CASE WHEN _kind = 'affiliate' THEN '/afiliados' ELSE '/transportador' END, v_id);
  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES ('payout.requested', 'Novo pedido de levantamento',
          jsonb_build_object('payout_id', v_id, 'user_id', v_uid, 'kind', _kind, 'amount_aoa', v_amount, 'due_at', v_due));
  RETURN jsonb_build_object('ok', true, 'payout_id', v_id, 'amount_aoa', v_amount, 'due_at', v_due, 'status', 'pending');
END $function$;

CREATE OR REPLACE FUNCTION public.affiliate_withdrawable()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_aff uuid; v_released numeric := 0; v_requested numeric := 0; v_open record; v_min numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_aff FROM public.affiliate_accounts WHERE user_id = v_uid;
  IF v_aff IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_aoa),0) INTO v_released
      FROM public.affiliate_commissions WHERE affiliate_id = v_aff AND status IN ('released','paid');
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'affiliate' AND status NOT IN ('cancelled','rejected');
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'affiliate' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  v_min := public.min_withdrawal_aoa();
  RETURN jsonb_build_object(
    'available_aoa', GREATEST(ROUND(v_released - v_requested, 2), 0),
    'min_amount_aoa', v_min,
    'below_minimum', GREATEST(ROUND(v_released - v_requested, 2), 0) < v_min,
    'max_daily_aoa', public.max_daily_withdrawal_aoa(),
    'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.user_withdrawn_today(v_uid), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.courier_withdrawable()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_courier uuid; v_earned numeric := 0; v_requested numeric := 0;
        v_deliveries int := 0; v_open record; v_min numeric; v_available numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_courier FROM public.couriers WHERE user_id = v_uid;
  IF v_courier IS NOT NULL THEN
    SELECT COALESCE(SUM(o.shipping_aoa),0), COUNT(*) INTO v_earned, v_deliveries
      FROM public.deliveries d JOIN public.orders o ON o.id = d.order_id
      WHERE d.courier_id = v_courier AND d.status = 'delivered';
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'courier' AND status NOT IN ('cancelled','rejected');
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'courier' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  v_available := GREATEST(ROUND(v_earned - v_requested, 2), 0);
  v_min := public.min_withdrawal_aoa();
  RETURN jsonb_build_object(
    'is_courier', v_courier IS NOT NULL, 'deliveries_done', v_deliveries,
    'earned_aoa', ROUND(v_earned, 2), 'withdrawn_aoa', ROUND(v_requested, 2),
    'available_aoa', v_available, 'min_amount_aoa', v_min, 'below_minimum', v_available < v_min,
    'max_daily_aoa', public.max_daily_withdrawal_aoa(),
    'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.user_withdrawn_today(v_uid), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END $function$;

CREATE OR REPLACE FUNCTION public.store_ledger_summary(_store_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE v_owner uuid; b record; v_sales numeric; v_comm numeric; v_withdrawn numeric;
 v_max numeric; v_min numeric; v_today numeric;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 SELECT owner_id INTO v_owner FROM public.stores WHERE id=_store_id;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
 IF v_owner<>auth.uid() AND NOT public.staff_can('finance.view') THEN RAISE EXCEPTION 'not_authorized'; END IF;
 SELECT * INTO b FROM public.ledger_balances(_store_id);
 SELECT COALESCE(SUM(gross_aoa),0),COALESCE(SUM(commission_aoa),0) INTO v_sales,v_comm
 FROM public.ledger_entries WHERE store_id=_store_id AND kind='sale_credit';
 SELECT COALESCE(SUM(net_aoa),0) INTO v_withdrawn FROM public.ledger_entries WHERE store_id=_store_id AND kind='withdrawal_paid';
 v_max:=public.max_daily_withdrawal_aoa(); v_min:=public.min_withdrawal_aoa();
 v_today:=public.user_withdrawn_today(v_owner);
 RETURN jsonb_build_object('available_aoa',b.available,'pending_aoa',b.pending,'reserved_aoa',b.reserved,
 'sales_aoa',v_sales,'commissions_aoa',v_comm,'withdrawn_aoa',v_withdrawn,
 'min_amount_aoa',v_min,'below_minimum',b.available<v_min,'max_daily_withdrawal_aoa',v_max,
 'withdrawn_today_aoa',v_today,'remaining_today_aoa',GREATEST(v_max-v_today,0));
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_financial_summary()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE res jsonb;
BEGIN
  IF NOT public.staff_can('finance.view') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  WITH verified_orders AS (
    SELECT o.* FROM public.orders o
    WHERE o.paid_at IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.payment_intents pi
        WHERE pi.order_id = o.id AND pi.status = 'paid'
          AND pi.verified_at IS NOT NULL
          AND public.is_trusted_payment_source(pi.verified_source)
      )
  ), unverified_orders AS (
    SELECT o.* FROM public.orders o
    WHERE o.paid_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.payment_intents pi
        WHERE pi.order_id = o.id AND pi.status = 'paid'
          AND pi.verified_at IS NOT NULL
          AND public.is_trusted_payment_source(pi.verified_source)
      )
  )
  SELECT jsonb_build_object(
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_paid', (SELECT count(*) FROM verified_orders),
    'orders_pending', (SELECT count(*) FROM public.orders WHERE status = 'pending'),
    'orders_cancelled', (SELECT count(*) FROM public.orders WHERE status = 'cancelled'),
    'gross_aoa', COALESCE((SELECT sum(total_aoa) FROM verified_orders), 0),
    'commission_aoa', COALESCE((SELECT sum(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100) FROM verified_orders o), 0),
    'net_sellers_aoa', COALESCE((SELECT sum(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100)) FROM verified_orders o), 0),
    'gross_unverified_aoa', COALESCE((SELECT sum(total_aoa) FROM unverified_orders), 0),
    'orders_unverified', (SELECT count(*) FROM unverified_orders),
    'signup_fees_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'paid'), 0),
    'signup_fees_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'pending'), 0),
    'subscriptions_active', (SELECT count(*) FROM public.store_subscriptions WHERE status = 'active' AND verified_at IS NOT NULL),
    'subscriptions_paid_aoa', COALESCE((
      SELECT sum(sp.amount_aoa) FROM public.subscription_payments sp
      JOIN public.store_subscriptions ss ON ss.id = sp.subscription_id
      WHERE sp.status = 'paid' AND sp.paid_at IS NOT NULL
        AND ss.verified_at IS NOT NULL
        AND public.is_trusted_payment_source(ss.verified_source)), 0),
    'subscriptions_unverified_aoa', COALESCE((
      SELECT sum(ss.price_aoa) FROM public.store_subscriptions ss
      WHERE ss.verified_at IS NULL AND ss.status <> 'rejected'), 0),
    'payouts_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status IN ('pending','processing')), 0),
    'payouts_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status = 'paid'), 0),
    'stores_total', (SELECT count(*) FROM public.stores),
    'stores_active', (SELECT count(*) FROM public.stores WHERE status = 'active')
  ) INTO res;
  RETURN res;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_financial_transactions(_status text DEFAULT NULL::text, _store_id uuid DEFAULT NULL::uuid, _method text DEFAULT NULL::text, _from timestamp with time zone DEFAULT NULL::timestamp with time zone, _to timestamp with time zone DEFAULT NULL::timestamp with time zone, _limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, created_at timestamp with time zone, paid_at timestamp with time zone, status text, customer_name text, store_name text, store_id uuid, gross_aoa numeric, commission_aoa numeric, net_aoa numeric, payment_method text, reference text, items integer, verified boolean, verified_source text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.staff_can('finance.view') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT o.id, o.created_at, o.paid_at, o.status::text,
         COALESCE(p.display_name, 'Cliente'), s.name, s.id,
         o.total_aoa,
         round(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100, 2),
         round(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100), 2),
         COALESCE(o.payment_method, '—'),
         (SELECT pi.reference FROM public.payment_intents pi WHERE pi.order_id = o.id ORDER BY pi.created_at DESC LIMIT 1),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id),
         EXISTS (SELECT 1 FROM public.payment_intents pi WHERE pi.order_id = o.id AND pi.status = 'paid'
                   AND pi.verified_at IS NOT NULL AND public.is_trusted_payment_source(pi.verified_source)),
         (SELECT pi.verified_source FROM public.payment_intents pi WHERE pi.order_id = o.id AND pi.verified_at IS NOT NULL
            ORDER BY pi.verified_at DESC LIMIT 1)
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.profiles p ON p.id = o.customer_id
  WHERE (_status IS NULL OR o.status::text = _status)
    AND (_store_id IS NULL OR o.store_id = _store_id)
    AND (_method IS NULL OR o.payment_method = _method)
    AND (_from IS NULL OR o.created_at >= _from)
    AND (_to IS NULL OR o.created_at <= _to)
  ORDER BY o.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_payout_requests()
 RETURNS TABLE(id uuid, user_id uuid, user_name text, kind text, amount_aoa numeric, method text, status text, created_at timestamp with time zone, due_at timestamp with time zone, processed_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.staff_can('finance.view') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.user_id, COALESCE(p.display_name, 'Utilizador'), pr.kind,
         pr.amount_aoa, pr.method, pr.status, pr.created_at, pr.due_at, pr.processed_at
  FROM public.payout_requests pr
  LEFT JOIN public.profiles p ON p.id = pr.user_id
  ORDER BY pr.created_at DESC
  LIMIT 200;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_platform_fiscal_documents(_state text DEFAULT NULL::text, _limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, doc_kind text, full_number text, series text, number bigint, store_id uuid, store_name text, order_id uuid, subscription_id uuid, total_aoa numeric, currency_code text, issued_at timestamp with time zone, fiscal_state text, agt_number text, agt_series text, agt_issued_at timestamp with time zone, agt_total_aoa numeric, agt_pdf_path text, agt_registered_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT i.id, i.doc_kind, i.full_number, i.series, i.number,
         i.store_id, s.name, i.order_id, i.subscription_id,
         i.total_aoa, i.currency_code, i.issued_at,
         i.fiscal_state, i.agt_number, i.agt_series, i.agt_issued_at,
         i.agt_total_aoa, i.agt_pdf_path, i.agt_registered_at
    FROM public.invoices i
    LEFT JOIN public.stores s ON s.id = i.store_id
   WHERE public.staff_can('finance.view')
     AND i.issuer_kind = 'platform'
     AND (_state IS NULL OR i.fiscal_state = _state)
   ORDER BY i.issued_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
$function$;

CREATE OR REPLACE FUNCTION public.admin_register_external_invoice(_invoice_id uuid, _number text, _series text, _issued_at timestamp with time zone, _total_aoa numeric, _pdf_path text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_inv record;
BEGIN
  PERFORM public.staff_authorize('finance.invoice.register');
  IF _number IS NULL OR btrim(_number) = '' THEN RAISE EXCEPTION 'invalid_document_number'; END IF;
  IF _series IS NULL OR btrim(_series) = '' THEN RAISE EXCEPTION 'invalid_document_series'; END IF;
  IF _issued_at IS NULL THEN RAISE EXCEPTION 'invalid_issue_date'; END IF;
  IF _total_aoa IS NULL OR _total_aoa < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'invoice_not_found'; END IF;
  IF v_inv.issuer_kind <> 'platform' THEN RAISE EXCEPTION 'only_platform_documents'; END IF;
  IF v_inv.fiscal_state = 'externally_issued' THEN RAISE EXCEPTION 'already_registered'; END IF;

  UPDATE public.invoices
     SET fiscal_state = 'externally_issued',
         agt_number = btrim(_number),
         agt_series = btrim(_series),
         agt_issued_at = _issued_at,
         agt_total_aoa = round(_total_aoa, 2),
         agt_pdf_path = _pdf_path,
         agt_registered_by = auth.uid(),
         agt_registered_at = now(),
         updated_at = now()
   WHERE id = _invoice_id;

  PERFORM public.fin_audit('finance.invoice.register','invoices',_invoice_id::text,to_jsonb(v_inv)::text,
    (SELECT to_jsonb(i)::text FROM public.invoices i WHERE i.id=_invoice_id),'ok',NULL);
  RETURN _invoice_id;
END; $function$;


CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid,_status text DEFAULT 'paid',_note text DEFAULT NULL,_bank_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE w public.payout_requests; n public.payout_requests; a uuid; permission text; target text;
BEGIN
 permission:=CASE _status WHEN 'processing' THEN 'finance.process' WHEN 'paid' THEN 'finance.execute'
 WHEN 'cancelled' THEN 'finance.reject' WHEN 'rejected' THEN 'finance.reject' END;
 IF permission IS NULL THEN RAISE EXCEPTION 'invalid_status'; END IF;
 a:=public.staff_authorize(permission);
 SELECT * INTO w FROM public.payout_requests WHERE id=_payout_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 IF w.user_id=a THEN RAISE EXCEPTION 'self_approval_forbidden'; END IF;
 IF w.status NOT IN ('pending','processing') THEN
  PERFORM public.fin_audit('payout_'||_status,w.kind,w.id::text,w.status,w.status,'rejected:terminal',NULL);
  RETURN jsonb_build_object('ok',false,'reason','invalid_transition','current_status',w.status);
 END IF;
 -- Permission is not bank evidence. No manual reference can finalize a payment.
 IF _status='paid' THEN
  PERFORM public.fin_audit('payout_paid',w.kind,w.id::text,w.status,w.status,'rejected:bank_confirmation_required',NULL);
  RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required');
 END IF;
 IF _status IN ('cancelled','rejected') AND (_note IS NULL OR length(btrim(_note))<3) THEN RAISE EXCEPTION 'reason_required'; END IF;
 target:=CASE WHEN _status='rejected' THEN 'cancelled' ELSE _status END;
 IF target=w.status THEN RETURN jsonb_build_object('ok',true,'unchanged',true,'status',w.status); END IF;
 UPDATE public.payout_requests SET status=target,note=COALESCE(_note,note),
 processed_at=CASE WHEN target='cancelled' THEN clock_timestamp() ELSE processed_at END,
 updated_at=clock_timestamp() WHERE id=w.id RETURNING * INTO n;
 PERFORM public.fin_audit('payout_'||_status,w.kind,w.id::text,to_jsonb(w)::text,to_jsonb(n)::text,'ok',NULL,
 jsonb_build_object('requested_status',_status,'reason',_note));
 INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
 VALUES(w.user_id,'payout.'||target,CASE WHEN target='cancelled' THEN 'Levantamento cancelado' ELSE 'Levantamento em processamento' END,
 'Kz '||to_char(w.amount_aoa,'FM999G999G999D00'),CASE WHEN w.kind='affiliate' THEN '/afiliados' ELSE '/transportador' END,w.id);
 RETURN jsonb_build_object('ok',true,'status',target);
END $fn$;
CREATE OR REPLACE FUNCTION public.admin_withdrawal_action(_id uuid,_action text,_bank_reference text DEFAULT NULL,_proof_path text DEFAULT NULL,_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $fn$
DECLARE w public.store_withdrawals; n public.store_withdrawals; owner_id uuid; a uuid; permission text; target text;
BEGIN
 permission:=CASE _action WHEN 'approve' THEN 'finance.approve' WHEN 'process' THEN 'finance.process'
 WHEN 'pay' THEN 'finance.execute' WHEN 'reject' THEN 'finance.reject' END;
 IF permission IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
 a:=public.staff_authorize(permission);
 SELECT * INTO w FROM public.store_withdrawals WHERE id=_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
 SELECT s.owner_id INTO owner_id FROM public.stores s WHERE s.id=w.store_id;
 IF owner_id=a OR w.requested_by=a THEN RAISE EXCEPTION 'self_approval_forbidden'; END IF;
 IF w.status IN ('PAID','REJECTED') THEN
  PERFORM public.fin_audit('withdrawal_'||_action,'withdrawal',w.id::text,w.status,w.status,'rejected:terminal',NULL);
  RETURN jsonb_build_object('ok',false,'reason','invalid_transition');
 END IF;
 IF _action='pay' THEN
  PERFORM public.fin_audit('withdrawal_pay','withdrawal',w.id::text,w.status,w.status,'rejected:bank_confirmation_required',NULL);
  RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required');
 END IF;
 IF _action='process' AND w.reviewed_by=a THEN RAISE EXCEPTION 'separation_of_duties_required'; END IF;
 target:=CASE _action WHEN 'approve' THEN 'APPROVED' WHEN 'process' THEN 'PROCESSING' WHEN 'reject' THEN 'REJECTED' END;
 IF target='REJECTED' AND (_reason IS NULL OR length(btrim(_reason))<3) THEN RAISE EXCEPTION 'reason_required'; END IF;
 UPDATE public.store_withdrawals SET status=target,
 reviewed_by=CASE WHEN target IN ('APPROVED','REJECTED') THEN a ELSE reviewed_by END,
 reviewed_at=CASE WHEN target IN ('APPROVED','REJECTED') THEN clock_timestamp() ELSE reviewed_at END,
 processed_by=CASE WHEN target='PROCESSING' THEN a ELSE processed_by END,
 processed_at=CASE WHEN target='PROCESSING' THEN clock_timestamp() ELSE processed_at END,
 rejection_reason=CASE WHEN target='REJECTED' THEN btrim(_reason) ELSE rejection_reason END
 WHERE id=w.id RETURNING * INTO n;
 IF target='REJECTED' THEN
  INSERT INTO public.ledger_entries(store_id,withdrawal_id,kind,net_aoa,delta_available,delta_reserved,origin,event_ref,idempotency_key,created_by)
  VALUES(w.store_id,w.id,'withdrawal_release',w.amount_aoa,w.amount_aoa,-w.amount_aoa,'withdrawal_rejected','withdrawal:'||w.id,'wd_release:'||w.id,a);
 END IF;
 PERFORM public.fin_audit('withdrawal_'||_action,'withdrawal',w.id::text,to_jsonb(w)::text,to_jsonb(n)::text,'ok','withdrawal:'||w.id,
 jsonb_build_object('reason',_reason));
 RETURN jsonb_build_object('ok',true,'status',target);
END $fn$;
ALTER POLICY ledger_select_owner_admin ON public.ledger_entries USING(public.staff_can('finance.view') OR EXISTS(SELECT 1 FROM public.stores s WHERE s.id=ledger_entries.store_id AND s.owner_id=auth.uid()));
ALTER POLICY withdrawals_select_owner_admin ON public.store_withdrawals USING(public.staff_can('finance.view') OR EXISTS(SELECT 1 FROM public.stores s WHERE s.id=store_withdrawals.store_id AND s.owner_id=auth.uid()));
ALTER POLICY "own payout requests" ON public.payout_requests USING(user_id=auth.uid() OR public.staff_can('finance.view'));
ALTER POLICY fin_audit_select_admin ON public.financial_audit_log USING(
 (resource IN ('staff_members','staff_roles') AND public.staff_can('team.read')) OR
 (resource='withdrawal_limits' AND public.staff_can('limits.read')) OR
 (resource NOT IN ('staff_members','staff_roles','withdrawal_limits') AND public.staff_can('finance.view')));
ALTER POLICY invoices_admin_read ON public.invoices USING(public.staff_can('finance.view'));
ALTER POLICY invoice_items_read_via_owned_invoice ON public.invoice_items USING(EXISTS(
 SELECT 1 FROM public.invoices i WHERE i.id=invoice_items.invoice_id));

REVOKE ALL ON FUNCTION public.request_store_withdrawal(uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_store_withdrawal(uuid,numeric) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.request_payout(text,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.request_payout(text,text,jsonb) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.affiliate_withdrawable() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.affiliate_withdrawable() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.courier_withdrawable() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.courier_withdrawable() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.store_ledger_summary(uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.store_ledger_summary(uuid) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_financial_summary() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_financial_summary() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_financial_transactions(text,uuid,text,timestamptz,timestamptz,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_financial_transactions(text,uuid,text,timestamptz,timestamptz,integer) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_payout_requests() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_payout_requests() TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_platform_fiscal_documents(text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_platform_fiscal_documents(text,integer) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_register_external_invoice(uuid,text,text,timestamptz,numeric,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_register_external_invoice(uuid,text,text,timestamptz,numeric,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_settle_payout(uuid,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_settle_payout(uuid,text,text,text) TO authenticated,service_role;

REVOKE ALL ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) TO authenticated,service_role;
