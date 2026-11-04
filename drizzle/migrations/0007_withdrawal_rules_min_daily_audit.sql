-- Migration A: mínimo de 10.000 Kz por saque (lojista, afiliado, entregador), teto diário 200.000 Kz mantido,
-- liquidação de afiliados/entregadores com transições válidas + auditoria, admins sem UPDATE direta em payout_requests.

-- (1) mínimo configurável por moeda
ALTER TABLE public.withdrawal_limits ADD COLUMN IF NOT EXISTS min_amount numeric;
UPDATE public.withdrawal_limits SET min_amount = 10000
  WHERE currency = 'AOA' AND (min_amount IS NULL OR min_amount <> 10000);
ALTER TABLE public.withdrawal_limits ALTER COLUMN min_amount SET DEFAULT 10000;
COMMENT ON COLUMN public.withdrawal_limits.min_amount IS 'Valor mínimo por saque; aplicado nas RPCs de levantamento';

-- (2) helper do mínimo (substitui a versão legada da migration 0000; mesma assinatura)
CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa()
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT min_amount FROM public.withdrawal_limits WHERE currency = 'AOA'),
    (SELECT min_withdrawal_aoa FROM public.financial_settings LIMIT 1),
    10000)
$$;

-- (3) lojistas: recusa abaixo do mínimo
CREATE OR REPLACE FUNCTION public.request_store_withdrawal(_store_id uuid, _amount numeric)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_id uuid; v_amt numeric := ROUND(_amount, 2);
        v_max numeric; v_min numeric; v_today numeric;
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
  v_min := public.min_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
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
END $$;

-- (4) afiliados/entregadores: mínimo + auditoria em todas as recusas
DROP FUNCTION IF EXISTS public.request_payout(text, text, jsonb);
CREATE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'multicaixa_express', _destination jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_available numeric; v_amount numeric;
        v_min numeric; v_remaining numeric; v_id uuid; v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
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
  v_remaining := GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, _kind), 0);
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
END $$;

-- (5) afiliados: expõe mínimo; 'rejected' deixa de contar como pedido
CREATE OR REPLACE FUNCTION public.affiliate_withdrawable()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, 'affiliate'), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END $$;

-- (6) entregadores: igual ao (5)
CREATE OR REPLACE FUNCTION public.courier_withdrawable()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'remaining_today_aoa', GREATEST(public.max_daily_withdrawal_aoa() - public.payout_withdrawn_today(v_uid, 'courier'), 0),
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END $$;

-- (7) resumo da carteira do lojista: expõe o mínimo
CREATE OR REPLACE FUNCTION public.store_ledger_summary(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_sales numeric; v_comm numeric; v_withdrawn numeric;
        v_max numeric; v_min numeric; v_today numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  SELECT COALESCE(SUM(gross_aoa),0), COALESCE(SUM(commission_aoa),0) INTO v_sales, v_comm
    FROM public.ledger_entries WHERE store_id=_store_id AND kind='sale_credit';
  SELECT COALESCE(SUM(net_aoa),0) INTO v_withdrawn
    FROM public.ledger_entries WHERE store_id=_store_id AND kind='withdrawal_paid';
  v_max := public.max_daily_withdrawal_aoa();
  v_min := public.min_withdrawal_aoa();
  v_today := public.store_withdrawn_today(_store_id);
  RETURN jsonb_build_object('available_aoa', b.available, 'pending_aoa', b.pending, 'reserved_aoa', b.reserved,
    'sales_aoa', v_sales, 'commissions_aoa', v_comm, 'withdrawn_aoa', v_withdrawn,
    'min_amount_aoa', v_min, 'below_minimum', b.available < v_min,
    'max_daily_withdrawal_aoa', v_max, 'withdrawn_today_aoa', v_today,
    'remaining_today_aoa', GREATEST(v_max - v_today, 0));
END $$;

-- (8) liquidação de afiliados/entregadores: só transições válidas, exige referência bancária para pagar,
--     confirmação repetida não volta a notificar, tudo gravado na auditoria, aceita 'rejected'
DROP FUNCTION IF EXISTS public.admin_settle_payout(uuid, text, text);
CREATE FUNCTION public.admin_settle_payout(_payout_id uuid, _status text DEFAULT 'paid', _note text DEFAULT NULL, _bank_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _status NOT IN ('processing','paid','cancelled','rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF _status = 'paid' AND COALESCE(TRIM(_bank_reference),'') = '' THEN RAISE EXCEPTION 'bank_reference_required'; END IF;
  SELECT * INTO v_row FROM public.payout_requests WHERE id = _payout_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_row.status NOT IN ('pending','processing') THEN
    PERFORM public.fin_audit('payout_'||_status, v_row.kind, _payout_id::text, v_row.status, _status, 'rejected:invalid_transition', NULL, jsonb_build_object('attempted',_status));
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'current_status', v_row.status);
  END IF;
  UPDATE public.payout_requests
     SET status = _status, note = COALESCE(_note, note),
         bank_reference = COALESCE(NULLIF(TRIM(_bank_reference),''), bank_reference),
         verification_state = CASE WHEN _status = 'paid' THEN 'verified' ELSE verification_state END,
         verification_source = CASE WHEN _status = 'paid' THEN 'manual' ELSE verification_source END,
         verified_at = CASE WHEN _status = 'paid' THEN now() ELSE verified_at END,
         processed_at = CASE WHEN _status IN ('paid','cancelled','rejected') THEN now() ELSE processed_at END,
         updated_at = now()
   WHERE id = _payout_id;
  PERFORM public.fin_audit('payout_'||_status, v_row.kind, _payout_id::text, v_row.status, _status, 'ok', _bank_reference,
    jsonb_build_object('payout_id',_payout_id,'user_id',v_row.user_id,'amount_aoa',v_row.amount_aoa,'note',_note));
  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_row.user_id, 'payout.' || _status,
          CASE _status WHEN 'paid' THEN 'Levantamento pago' WHEN 'cancelled' THEN 'Levantamento cancelado'
                       WHEN 'rejected' THEN 'Levantamento recusado' ELSE 'Levantamento em processamento' END,
          'Kz ' || to_char(v_row.amount_aoa, 'FM999G999G999D00'),
          CASE WHEN v_row.kind = 'affiliate' THEN '/afiliados' ELSE '/transportador' END, v_row.id);
  RETURN jsonb_build_object('ok', true, 'status', _status);
END $$;

-- (9) admins deixam de poder alterar pedidos diretamente; só pelas RPCs
DROP POLICY IF EXISTS "admin update payout requests" ON public.payout_requests;
GRANT ALL ON public.payout_requests TO service_role;

-- Execução pelas RPCs (mantém o acesso atual via Data API)
GRANT EXECUTE ON FUNCTION public.min_withdrawal_aoa() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_store_withdrawal(uuid,numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_payout(text,text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.affiliate_withdrawable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_withdrawable() TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_ledger_summary(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_settle_payout(uuid,text,text,text) TO authenticated;
