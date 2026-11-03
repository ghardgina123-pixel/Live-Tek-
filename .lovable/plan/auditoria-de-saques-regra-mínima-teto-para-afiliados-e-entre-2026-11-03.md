# Auditoria de saques, regra mínima/teto para afiliados e entregadores, e verificação de pagamento real

## Estado atual verificado na base

- `withdrawal_limits` AOA: só tem `max_daily_amount = 200000`. **Não tem mínimo** — a migration anterior revertou; a role `liveteka_payout_executor` não existe nem tem membros (o bloqueio de isolamento já não se verifica).
- `request_store_withdrawal` (lojistas): valida teto diário e saldo, **sem mínimo**.
- `request_payout` (afiliados/entregadores): valida teto diário e saldo, **sem mínimo**; pede automaticamente `LEAST(disponível, restante hoje)`.
- `admin_settle_payout` (afiliados/entregadores): permite `paid → cancelled`, reconfirmações repetidas notificam outra vez, sem registo de auditoria; o botão "Rejeitar" do painel admin envia `rejected` e a função recusa (`invalid_status`).
- `payout_requests` tem política de UPDATE direta para admins (falha conhecida da revisão anterior).
- `financial_audit_log` existe (append-only, leitura só admin) mas os pedidos de afiliados/entregadores nunca gravam lá.
- Zero pedidos de saque e zero lançamentos no ledger: nada é perdido nem alterado retroativamente.

## 1) Migration A — regras (mínimo 10.000 Kz, teto diário 200.000 Kz, integridade)

Mínimo aplicado aos três tipos (lojista, afiliado, entregador); teto diário já existente mantido e rejeitados deixam de consumir limite.

```sql
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

-- (3) lojistas: recusa abaixo do mínimo (resto da função fica igual ao atual)
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

-- (4) afiliados/entregadores: mínimo + auditoria; rejeitados deixam de contar
CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text, _destination jsonb)
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

-- (8) liquidação de afiliados/entregadores: só transições válidas, exige referência para pagar,
--     confirmação repetida não volta a notificar, tudo gravado na auditoria, aceita 'rejected'
CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid, _status text, _note text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _status NOT IN ('processing','paid','cancelled','rejected') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  SELECT * INTO v_row FROM public.payout_requests WHERE id = _payout_id FOR UPDATE;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_row.status NOT IN ('pending','processing') THEN
    PERFORM public.fin_audit('payout_'||_status, v_row.kind, _payout_id::text, v_row.status, _status, 'rejected:invalid_transition', NULL, jsonb_build_object('attempted',_status));
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_transition', 'current_status', v_row.status);
  END IF;
  UPDATE public.payout_requests
     SET status = _status, note = COALESCE(_note, note),
         processed_at = CASE WHEN _status IN ('paid','cancelled','rejected') THEN now() ELSE processed_at END,
         updated_at = now()
   WHERE id = _payout_id;
  PERFORM public.fin_audit('payout_'||_status, v_row.kind, _payout_id::text, v_row.status, _status, 'ok', NULL,
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
```

## 2) Migration B — verificação de pagamento real (preparada para o Banco Atlântico)

Adiciona o estado de verificação às duas tabelas, uma RPC de verificação executável só pelo serviço, e a auto-autorização do saque quando o dinheiro chega. A rota web só fica ativa com o segredo configurado; enquanto os documentos oficiais não chegarem, devolve "não configurado".

```sql
-- (1) estado de verificação
ALTER TABLE public.store_withdrawals
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'awaiting',
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS verification_payload jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS store_withdrawals_bank_reference_uidx
  ON public.store_withdrawals (bank_reference)
  WHERE bank_reference IS NOT NULL AND bank_reference <> '';

ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'awaiting',
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS verification_payload jsonb,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS payout_requests_bank_reference_uidx
  ON public.payout_requests (bank_reference)
  WHERE bank_reference IS NOT NULL AND bank_reference <> '';

-- (2) verificação: chamada só pelo serviço autenticado do webhook
CREATE OR REPLACE FUNCTION public.verify_withdrawal_payment(
  _resource text, _reference text, _amount numeric, _currency text, _payload jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row record; v_amt numeric := ROUND(_amount, 2); v_kind text; v_subject uuid;
BEGIN
  IF current_user NOT IN ('service_role','postgres') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _resource NOT IN ('store','affiliate','courier') THEN RAISE EXCEPTION 'invalid_resource'; END IF;
  IF COALESCE(TRIM(_reference),'') = '' THEN RAISE EXCEPTION 'reference_required'; END IF;
  IF _currency IS DISTINCT FROM 'AOA' THEN
    PERFORM public.fin_audit('payment_verify',_resource,_reference,NULL,NULL,'rejected:currency_unsupported',NULL,
      jsonb_build_object('currency',_currency,'amount',v_amt,'reference',_reference));
    RETURN jsonb_build_object('ok', false, 'reason', 'currency_unsupported', 'currency', _currency);
  END IF;
  IF v_amt IS NULL OR v_amt <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _resource = 'store' THEN
    SELECT * INTO v_row FROM public.store_withdrawals
      WHERE bank_reference = _reference OR (COALESCE(_payload->>'withdrawal_id','') <> '' AND id::text = _payload->>'withdrawal_id')
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    v_kind := 'withdrawal'; v_subject := v_row.store_id;
  ELSE
    SELECT * INTO v_row FROM public.payout_requests
      WHERE bank_reference = _reference OR (COALESCE(_payload->>'payout_id','') <> '' AND id::text = _payload->>'payout_id')
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
    v_kind := 'payout'; v_subject := v_row.user_id;
  END IF;
  IF v_row.id IS NULL THEN
    PERFORM public.fin_audit('payment_verify',_resource,_reference,NULL,NULL,'rejected:not_found',NULL,
      jsonb_build_object('amount',v_amt,'currency',_currency));
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- idempotente: já verificado/pago com a mesma referência
  IF v_row.verification_state = 'verified' THEN
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'already_verified', true);
  END IF;

  IF v_row.amount_aoa <> v_amt THEN
    UPDATE public.store_withdrawals SET verification_state='failed', verification_payload=_payload, verified_at=now()
      WHERE id = v_row.id AND _resource = 'store';
    UPDATE public.payout_requests SET verification_state='failed', verification_payload=_payload, verified_at=now()
      WHERE id = v_row.id AND _resource <> 'store';
    PERFORM public.fin_audit('payment_verify',_resource,v_row.id::text,'awaiting','failed','rejected:amount_mismatch',NULL,
      jsonb_build_object('expected',v_row.amount_aoa,'received',v_amt,'reference',_reference,'payload',_payload));
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_mismatch', 'expected_aoa', v_row.amount_aoa, 'received', v_amt);
  END IF;

  UPDATE public.store_withdrawals SET verification_state='verified', verification_source='atlantico_webhook',
      verification_payload=_payload, verified_at=now()
    WHERE id = v_row.id AND _resource = 'store';
  UPDATE public.payout_requests SET verification_state='verified', verification_source='atlantico_webhook',
      verification_payload=_payload, verified_at=now()
    WHERE id = v_row.id AND _resource <> 'store';
  PERFORM public.fin_audit('payment_verified',_resource,v_row.id::text,'awaiting','verified','ok',_reference,
    jsonb_build_object('amount',v_amt,'reference',_reference,'payload',_payload));

  -- autoriza o saque quando o dinheiro chega
  IF v_row.status IN ('PENDING_REVIEW','APPROVED','PROCESSING') AND _resource = 'store' THEN
    UPDATE public.store_withdrawals SET status='PAID', paid_by=NULL, paid_at=now() WHERE id=v_row.id;
    IF NOT EXISTS (SELECT 1 FROM public.ledger_entries WHERE idempotency_key = 'wd_paid:'||v_row.id) THEN
      INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_reserved, origin, event_ref, idempotency_key)
      VALUES (v_row.store_id, v_row.id, 'withdrawal_paid', v_row.amount_aoa, -v_row.amount_aoa, 'bank_transfer', _reference, 'wd_paid:'||v_row.id);
    END IF;
    PERFORM public.fin_audit('withdrawal_paid_by_verification','withdrawal',v_row.id::text,v_row.status,'PAID','ok',_reference,
      jsonb_build_object('amount',v_row.amount_aoa));
  ELSIF v_row.status IN ('pending','processing') AND _resource <> 'store' THEN
    UPDATE public.payout_requests SET status='paid', processed_at=now(), updated_at=now() WHERE id=v_row.id;
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (v_row.user_id, 'payout.paid', 'Levantamento pago',
      'Kz ' || to_char(v_row.amount_aoa, 'FM999G999G999D00'),
      CASE WHEN v_row.kind='affiliate' THEN '/afiliados' ELSE '/transportador' END, v_row.id);
    PERFORM public.fin_audit('payout_paid_by_verification',v_row.kind,v_row.id::text,v_row.status,'paid','ok',_reference,
      jsonb_build_object('amount',v_row.amount_aoa));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', CASE WHEN _resource='store' THEN 'PAID' ELSE 'paid' END);
END $$;
REVOKE EXECUTE ON FUNCTION public.verify_withdrawal_payment(text,text,numeric,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_withdrawal_payment(text,text,numeric,text,jsonb) TO service_role;
```

`admin_withdrawal_action` (pago manual): passa a gravar `verification_state='verified'`, `verification_source='manual'` quando marca PAID — restante lógica igual à atual.

## 3) Ecrãs

- Novo componente `WithdrawalAudit` (lista unificada de saques):
  - cada linha: tipo (loja/afiliado/entregador), quem, valor, estado, **pedido (data e hora)**, **confirmação (data e hora)**, **saldo antes → depois**, referência bancária, selo de verificação (verificado pelo banco / manual / pendente) e a cronologia (pedido, aprovação, pagamento/rejeição) com hora.
  - dados por nova RPC `withdrawal_audit_overview(_scope, _limit)` (nova função SECURITY DEFINER: admin vê tudo; `own` devolve apenas o que é da própria conta).
- Admin (`/admin/financeiro`): nova secção "Auditoria de saques" com a visão completa; os saques de afiliados/entregadores exigem referência bancária para "Marcar pago"; selo de verificação nos cartões.
- Lojista (carteira): os levantamentos passam a mostrar a mesma cronologia com saldo antes/depois e a mensagem do mínimo.
- Afiliado e entregador (carteira PayoutWallet): histórico com cronologia e saldo antes/depois; botão mostra "valor mínimo 10.000 Kz" quando o saldo ou o restante de hoje está abaixo do mínimo.
- Mensagens no cliente para `below_minimum_limit` com o valor mínimo devolvido pelo servidor.

## 4) Verificação bancária — o que fica pronto e o que fica MANUAL ACTION REQUIRED

- Rota pública autenticada por assinatura `POST /api/public/atlantico/webhook` (HMAC-SHA256 sobre o corpo, comparação em tempo constante, validação Zod; chama a RPC via cliente de serviço). Sem segredo configurado, responde 503 "verificação não configurada".
- MANUAL ACTION REQUIRED (não invento nada): documentação oficial do Banco Atlântico (formato do payload, nome do cabeçalho de assinatura, URL de registo do webhook) + segredo oficial para configurar. A pesquisa pública não encontrou API/documentação de developers do banco; até os documentos chegarem, a autorização manual com referência bancária e comprovativo continua a ser a única via, e o saque fica com selo "manual".
- Testes do circuito de verificação com chamadas reais: só quando o webhook do banco estiver registado.

## 6) Auditoria final (no fim de tudo)

- Correr o security scan completo do projeto e verificar as policies/GRANTs criadas ou alteradas por estas migrations.
- Confirmar que o ledger continua append-only, que nenhuma tabela financeira ficou com escrita direta, e reportar as novas notas de auditoria junto com o resumo PASS/FAIL/MANUAL ACTION REQUIRED.

## 5) Verificações após aplicação

- `withdrawal_limits` AOA: min 10000, max 200000; `min_withdrawal_aoa()` devolve 10000.
- Políticas: admins sem UPDATE direta em `payout_requests`; RPCs exigem admin.
- Playwright na pré-visualização: mensagens de mínimo nos três ecrãs (com contas reais, sem criar saldos); auditoria admin lista vazia mas funcional.
- Testes de recusa reais (abaixo do mínimo, acima do teto, duplicação, concorrência) continuam a exigir saldo/transações reais ou o ambiente de teste isolado — segue no roadmap, não declarados como aprovados.

## Preservações

- Nada é apagado nem retro-alterado; migrations 0005/0006 intocadas; saldos fictícios só no ambiente de teste isolado (tarefa separada do roadmap).
- Ledger append-only, RLS, RPCs e auditoria mantidos; limites ficam configuráveis por moeda/mercado.
