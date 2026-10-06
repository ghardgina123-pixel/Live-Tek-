-- Configurable daily withdrawal limits (per currency; extendable to countries/banks)
CREATE TABLE IF NOT EXISTS public.withdrawal_limits (
  currency text PRIMARY KEY,
  max_daily_amount numeric NOT NULL CHECK (max_daily_amount > 0),
  timezone text NOT NULL DEFAULT 'Africa/Luanda',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.withdrawal_limits TO authenticated;
GRANT ALL ON public.withdrawal_limits TO service_role;
ALTER TABLE public.withdrawal_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY withdrawal_limits_read ON public.withdrawal_limits FOR SELECT TO authenticated USING (true);
INSERT INTO public.withdrawal_limits(currency, max_daily_amount) VALUES ('AOA', 200000)
  ON CONFLICT (currency) DO UPDATE SET max_daily_amount = EXCLUDED.max_daily_amount, updated_at = now();

COMMENT ON COLUMN public.financial_settings.min_withdrawal_aoa IS 'DEPRECATED: no minimum withdrawal; replaced by withdrawal_limits.max_daily_amount';

CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max_daily_amount FROM public.withdrawal_limits WHERE currency = 'AOA'
$$;

-- Today's start in the configured timezone
CREATE OR REPLACE FUNCTION public.withdrawal_day_start(_currency text DEFAULT 'AOA') RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (date_trunc('day', now() AT TIME ZONE COALESCE((SELECT timezone FROM public.withdrawal_limits WHERE currency=_currency),'Africa/Luanda')))
         AT TIME ZONE COALESCE((SELECT timezone FROM public.withdrawal_limits WHERE currency=_currency),'Africa/Luanda')
$$;

CREATE OR REPLACE FUNCTION public.store_withdrawn_today(_store_id uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount_aoa),0) FROM public.store_withdrawals
  WHERE store_id = _store_id AND status <> 'REJECTED' AND created_at >= public.withdrawal_day_start('AOA')
$$;

CREATE OR REPLACE FUNCTION public.payout_withdrawn_today(_user_id uuid, _kind text) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(amount_aoa),0) FROM public.payout_requests
  WHERE user_id = _user_id AND kind = _kind AND status <> 'cancelled' AND created_at >= public.withdrawal_day_start('AOA')
$$;

REVOKE EXECUTE ON FUNCTION public.max_daily_withdrawal_aoa(), public.withdrawal_day_start(text),
  public.store_withdrawn_today(uuid), public.payout_withdrawn_today(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.max_daily_withdrawal_aoa(), public.withdrawal_day_start(text),
  public.store_withdrawn_today(uuid), public.payout_withdrawn_today(uuid,text) TO service_role;

-- Store summary: expose max daily + remaining today (no minimum)
CREATE OR REPLACE FUNCTION public.store_ledger_summary(_store_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_sales numeric; v_comm numeric; v_withdrawn numeric; v_max numeric; v_today numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  SELECT COALESCE(SUM(gross_aoa),0), COALESCE(SUM(commission_aoa),0) INTO v_sales, v_comm FROM public.ledger_entries WHERE store_id=_store_id AND kind='sale_credit';
  SELECT COALESCE(SUM(net_aoa),0) INTO v_withdrawn FROM public.ledger_entries WHERE store_id=_store_id AND kind='withdrawal_paid';
  v_max := public.max_daily_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
  RETURN jsonb_build_object('available_aoa', b.available, 'pending_aoa', b.pending, 'reserved_aoa', b.reserved,
    'sales_aoa', v_sales, 'commissions_aoa', v_comm, 'withdrawn_aoa', v_withdrawn,
    'max_daily_withdrawal_aoa', v_max, 'withdrawn_today_aoa', v_today,
    'remaining_today_aoa', GREATEST(v_max - v_today, 0));
END $$;

-- Store withdrawal: any positive amount, within balance and daily limit (atomic, locked)
CREATE OR REPLACE FUNCTION public.request_store_withdrawal(_store_id uuid, _amount numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_id uuid; v_amt numeric := ROUND(_amount, 2); v_max numeric; v_today numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:not_owner',NULL);
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||_store_id::text));
  IF v_amt IS NULL OR v_amt <= 0 THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:invalid_amount',NULL, jsonb_build_object('amount',v_amt));
    RETURN jsonb_build_object('ok',false,'reason','invalid_amount');
  END IF;
  v_max := public.max_daily_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
  IF v_today + v_amt > v_max THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:daily_limit',NULL,
      jsonb_build_object('amount',v_amt,'withdrawn_today',v_today,'max_daily',v_max));
    RETURN jsonb_build_object('ok',false,'reason','daily_limit','max_daily_aoa',v_max,'remaining_today_aoa',GREATEST(v_max - v_today,0));
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
END $$;

-- Affiliate/courier: withdraw available balance capped at today's remaining limit
CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'multicaixa_express'::text, _destination jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_available numeric; v_amount numeric; v_remaining numeric; v_id uuid; v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout:'||v_uid::text||':'||_kind));
  v_state := CASE WHEN _kind = 'affiliate' THEN public.affiliate_withdrawable() ELSE public.courier_withdrawable() END;
  IF (v_state->>'has_open_request')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'open_request');
  END IF;
  v_available := COALESCE((v_state->>'available_aoa')::numeric, 0);
  IF v_available <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_balance', 'available_aoa', v_available);
  END IF;
  v_remaining := GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, _kind), 0);
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_limit', 'max_daily_aoa', public.max_daily_withdrawal_aoa());
  END IF;
  v_amount := LEAST(v_available, v_remaining);
  v_due := now() + interval '72 hours';
  INSERT INTO public.payout_requests (user_id, kind, amount_aoa, method, destination, due_at)
  VALUES (v_uid, _kind, v_amount, COALESCE(NULLIF(_method,''), 'multicaixa_express'), COALESCE(_destination, '{}'::jsonb), v_due)
  RETURNING id INTO v_id;
  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_uid, 'payout.requested', 'Pedido de levantamento registado',
          'Kz ' || to_char(v_amount, 'FM999G999G999D00') || ' — processamento até ' || to_char(v_due, 'DD/MM/YYYY HH24:MI') || '.',
          CASE WHEN _kind = 'affiliate' THEN '/afiliados' ELSE '/transportador' END, v_id);
  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES ('payout.requested', 'Novo pedido de levantamento',
          jsonb_build_object('payout_id', v_id, 'user_id', v_uid, 'kind', _kind, 'amount_aoa', v_amount, 'due_at', v_due));
  RETURN jsonb_build_object('ok', true, 'payout_id', v_id, 'amount_aoa', v_amount, 'due_at', v_due, 'status', 'pending');
END; $function$;

-- Wallet state functions: replace min with max daily info
DO $$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid, p.proname FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND p.proname IN ('affiliate_withdrawable','courier_withdrawable')
  LOOP
    d := pg_get_functiondef(r.oid);
    d := replace(d, '''min_aoa'', public.min_withdrawal_aoa()',
      '''max_daily_aoa'', public.max_daily_withdrawal_aoa(), ''remaining_today_aoa'', GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, '''
        || CASE WHEN r.proname='affiliate_withdrawable' THEN 'affiliate' ELSE 'courier' END || '''), 0)');
    IF position('min_withdrawal_aoa' in d) > 0 THEN RAISE EXCEPTION 'unexpected min rule left in %', r.proname; END IF;
    EXECUTE d;
  END LOOP;
END $$;

-- Retire the old minimum helper so nothing can use it
REVOKE EXECUTE ON FUNCTION public.min_withdrawal_aoa() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.min_withdrawal_aoa() IS 'DEPRECATED: no minimum withdrawal; use max_daily_withdrawal_aoa()';