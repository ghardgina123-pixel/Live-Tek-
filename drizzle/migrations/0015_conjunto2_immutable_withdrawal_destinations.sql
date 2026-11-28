-- Live Teká — Conjunto 2 — autorizado pelo utilizador em 24/11/2026; validado em PostgreSQL local descartável.
-- Não altera limites, fórmulas de saldo, comissões, M1/M2 ou pagamentos.
-- Pagamento permanece fechado até integração bancária autenticada oficial.
-- Não há backfill de destinos: um destino histórico nunca pode ser inventado.
ALTER TABLE public.payout_requests DROP CONSTRAINT payout_requests_status_check;
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_status_check
 CHECK (status IN ('pending','approved','processing','paid','cancelled','rejected'));

-- Validação sintática de IBAN ISO 13616 (módulo 97), não prova titularidade bancária.
CREATE OR REPLACE FUNCTION public.withdrawal_bank_identifier_valid(_identifier text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s text := upper(regexp_replace(coalesce(_identifier,''),'[[:space:]]','','g'));
 rotated text; ch text; digits text; remainder integer := 0; i integer; j integer;
BEGIN
 IF s ~ '^[0-9]{8,34}$' THEN RETURN true; END IF;
 IF s !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' THEN RETURN false; END IF;
 IF left(s,2)='AO' AND s !~ '^AO[0-9]{23}$' THEN RETURN false; END IF;
 rotated := substr(s,5)||left(s,4);
 FOR i IN 1..length(rotated) LOOP
  ch := substr(rotated,i,1);
  digits := CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch)-55)::text ELSE ch END;
  FOR j IN 1..length(digits) LOOP remainder := (remainder*10+substr(digits,j,1)::int)%97; END LOOP;
 END LOOP;
 RETURN remainder=1;
END $$;
REVOKE ALL ON FUNCTION public.withdrawal_bank_identifier_valid(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdrawal_bank_identifier_valid(text) TO authenticated, service_role;

-- Um único guard para os dois registos existentes; destino sempre capturado no servidor.
CREATE OR REPLACE FUNCTION public.guard_withdrawal_destination()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE uid uuid := auth.uid(); owner uuid; identity public.customer_fiscal_profiles;
 bank public.store_private; account public.user_payment_accounts;
 holder text; bank_name text; identifier text; destination jsonb; source_id uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'withdrawal_delete_forbidden'; END IF;
 IF TG_OP='UPDATE' THEN
  IF NEW.destination IS DISTINCT FROM OLD.destination OR NEW.amount_aoa IS DISTINCT FROM OLD.amount_aoa
   OR NEW.id IS DISTINCT FROM OLD.id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
   RAISE EXCEPTION 'withdrawal_snapshot_immutable'; END IF;
  IF TG_TABLE_NAME='payout_requests' THEN
   IF NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.method IS DISTINCT FROM OLD.method OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    RAISE EXCEPTION 'withdrawal_snapshot_immutable'; END IF;
   IF OLD.status IN ('paid','rejected','cancelled') THEN RAISE EXCEPTION 'withdrawal_final'; END IF;
   IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status='pending' AND NEW.status IN ('approved','rejected','cancelled')) OR
    (OLD.status='approved' AND NEW.status IN ('processing','rejected','cancelled')) OR
    (OLD.status='processing' AND NEW.status='paid')) THEN
    RAISE EXCEPTION 'withdrawal_transition_not_allowed'; END IF;
  ELSE
   IF NEW.store_id IS DISTINCT FROM OLD.store_id OR NEW.requested_by IS DISTINCT FROM OLD.requested_by THEN
    RAISE EXCEPTION 'withdrawal_snapshot_immutable'; END IF;
  END IF;
  -- Nenhuma role, referência manual, payload ou configuração de sessão prova pagamento.
  IF upper(NEW.status)='PAID' THEN RAISE EXCEPTION 'bank_confirmation_required'; END IF;
  RETURN NEW;
 END IF;
 IF uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF TG_TABLE_NAME='store_withdrawals' THEN
  SELECT owner_id INTO owner FROM public.stores WHERE id=NEW.store_id FOR SHARE;
  IF owner IS DISTINCT FROM uid OR NEW.requested_by IS DISTINCT FROM uid THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NEW.status IS DISTINCT FROM 'PENDING_REVIEW' THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
 ELSE
  owner := NEW.user_id;
  IF owner IS DISTINCT FROM uid THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'invalid_initial_status'; END IF;
  IF NEW.kind='affiliate' AND NOT EXISTS (SELECT 1 FROM public.affiliate_accounts WHERE user_id=uid AND is_active) THEN
   RAISE EXCEPTION 'beneficiary_not_eligible'; END IF;
  IF NEW.kind='courier' AND NOT EXISTS (SELECT 1 FROM public.couriers WHERE user_id=uid AND status='active' AND courier_type<>'empresa') THEN
   RAISE EXCEPTION 'beneficiary_not_eligible'; END IF;
 END IF;
 SELECT * INTO identity FROM public.customer_fiscal_profiles WHERE user_id=owner FOR SHARE;
 IF identity.user_id IS NULL OR identity.identity_locked_at IS NULL OR coalesce(identity.identity_conflict,false)
  OR nullif(trim(identity.legal_name),'') IS NULL OR nullif(identity.bi_normalized,'') IS NULL THEN
  RAISE EXCEPTION 'identity_required'; END IF;
 IF TG_TABLE_NAME='store_withdrawals' THEN
  SELECT * INTO bank FROM public.store_private WHERE store_id=NEW.store_id FOR SHARE;
  holder := nullif(trim(bank.bank_holder),''); bank_name := nullif(trim(bank.bank_name),'');
  identifier := upper(regexp_replace(coalesce(bank.bank_account,''),'[[:space:]]','','g'));
  source_id := NEW.store_id;
 ELSE
  SELECT * INTO account FROM public.user_payment_accounts
   WHERE user_id=uid AND method_type='bank_transfer'
   ORDER BY is_default DESC, updated_at DESC, id LIMIT 1 FOR SHARE;
  holder := nullif(trim(account.account_holder),''); bank_name := nullif(trim(account.bank_name),'');
  -- IBAN inválido não é substituído silenciosamente por uma conta alternativa.
  identifier := upper(regexp_replace(coalesce(nullif(trim(account.iban),''),account.account_number,''),'[[:space:]]','','g'));
  source_id := account.id;
 END IF;
 IF source_id IS NULL OR holder IS NULL OR bank_name IS NULL OR identifier='' THEN RAISE EXCEPTION 'bank_account_required'; END IF;
 IF NOT public.withdrawal_bank_identifier_valid(identifier) THEN RAISE EXCEPTION 'bank_account_invalid'; END IF;
 IF lower(regexp_replace(holder,'[[:space:]]+',' ','g')) IS DISTINCT FROM lower(regexp_replace(trim(identity.legal_name),'[[:space:]]+',' ','g'))
  AND NOT (TG_TABLE_NAME='store_withdrawals' AND lower(regexp_replace(holder,'[[:space:]]+',' ','g'))=
   lower(regexp_replace(trim(coalesce(bank.legal_name,'')),'[[:space:]]+',' ','g'))) THEN
  RAISE EXCEPTION 'bank_holder_mismatch'; END IF;
 destination := jsonb_build_object('version',1,'source',CASE WHEN TG_TABLE_NAME='store_withdrawals' THEN 'store_private' ELSE 'user_payment_accounts' END,
  'source_id',source_id,'user_id',owner,'legal_name',identity.legal_name,'bi',identity.bi_normalized,
  'holder',holder,'bank',bank_name,'currency','AOA','captured_at',now(),
  'iban',CASE WHEN identifier ~ '^[A-Z]' THEN identifier ELSE NULL END,
  'account',CASE WHEN identifier ~ '^[0-9]' THEN identifier ELSE NULL END);
 NEW.destination := destination;
 IF TG_TABLE_NAME='payout_requests' THEN NEW.method := 'bank_transfer'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_withdrawal_destination() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER withdrawal_destination_guard BEFORE INSERT OR UPDATE ON public.store_withdrawals
 FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_destination();
CREATE TRIGGER payout_destination_guard BEFORE INSERT OR UPDATE OR DELETE ON public.payout_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_destination();

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
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN ('identity_required','bank_account_required','bank_account_invalid','bank_holder_mismatch','beneficiary_not_eligible') THEN
  PERFORM public.fin_audit('withdrawal_destination_refused','withdrawal',auth.uid()::text,NULL,NULL,SQLERRM,NULL);
  RETURN jsonb_build_object('ok',false,'reason',SQLERRM);
 END IF;
 RAISE;
END $function$
;

CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'bank_transfer'::text, _destination jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
EXCEPTION WHEN raise_exception THEN
 IF SQLERRM IN ('identity_required','bank_account_required','bank_account_invalid','bank_holder_mismatch','beneficiary_not_eligible') THEN
  PERFORM public.fin_audit('withdrawal_destination_refused','withdrawal',auth.uid()::text,NULL,NULL,SQLERRM,NULL);
  RETURN jsonb_build_object('ok',false,'reason',SQLERRM);
 END IF;
 RAISE;
END $function$
;

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
    WHERE user_id = v_uid AND kind = 'affiliate' AND status IN ('pending','approved','processing')
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
END $function$
;

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
    WHERE user_id = v_uid AND kind = 'courier' AND status IN ('pending','approved','processing')
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
END $function$
;

-- Administração: aprovação não significa pagamento; guarda estados reais e impede autoaprovação.
CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid, _status text DEFAULT 'paid', _note text DEFAULT NULL, _bank_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE w public.payout_requests;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
 SELECT * INTO w FROM public.payout_requests WHERE id=_payout_id FOR UPDATE;
 IF w.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 IF w.user_id=auth.uid() THEN RETURN jsonb_build_object('ok',false,'reason','self_approval_forbidden'); END IF;
 IF w.status IN ('paid','rejected','cancelled') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition','current_status',w.status); END IF;
 IF _status='paid' THEN RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required'); END IF;
 IF NOT ((w.status='pending' AND _status IN ('approved','rejected','cancelled')) OR
  (w.status='approved' AND _status IN ('processing','rejected','cancelled'))) THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid_transition','current_status',w.status); END IF;
 IF _status IN ('rejected','cancelled') AND nullif(trim(_note),'') IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','reason_required'); END IF;
 IF _status IN ('approved','processing') AND coalesce(w.destination->>'version','')<>'1' THEN
  RETURN jsonb_build_object('ok',false,'reason','bank_account_required'); END IF;
 UPDATE public.payout_requests SET status=_status,note=coalesce(_note,note),
  processed_at=CASE WHEN _status IN ('rejected','cancelled') THEN now() ELSE processed_at END,updated_at=now() WHERE id=w.id;
 PERFORM public.fin_audit('payout_'||_status,w.kind,w.id::text,w.status,_status,'ok',NULL,
  jsonb_build_object('user_id',w.user_id,'amount_aoa',w.amount_aoa,'account_suffix',right(coalesce(w.destination->>'iban',w.destination->>'account',''),4)));
 INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
 VALUES(w.user_id,'payout.'||_status,
  CASE _status WHEN 'approved' THEN 'Levantamento aprovado' WHEN 'processing' THEN 'Levantamento em processamento'
   WHEN 'rejected' THEN 'Levantamento rejeitado' ELSE 'Levantamento cancelado' END,
  'A aprovação não confirma uma transferência bancária.',CASE WHEN w.kind='affiliate' THEN '/afiliados' ELSE '/transportador' END,w.id);
 RETURN jsonb_build_object('ok',true,'status',_status);
END $$;

CREATE OR REPLACE FUNCTION public.admin_withdrawal_action(_id uuid, _action text, _bank_reference text DEFAULT NULL::text, _proof_path text DEFAULT NULL::text, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE w public.store_withdrawals; v_owner uuid; v_new text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN
    PERFORM public.fin_audit('withdrawal_'||coalesce(_action,'?'),'withdrawal',_id::text,NULL,NULL,'rejected:not_admin',NULL);
    RAISE EXCEPTION 'not_authorized';
  END IF;
  SELECT * INTO w FROM public.store_withdrawals WHERE id=_id FOR UPDATE;
  IF w.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = w.store_id;
  IF v_owner = auth.uid() OR w.requested_by = auth.uid() THEN
    PERFORM public.fin_audit('withdrawal_'||_action,'withdrawal',_id::text,w.status,NULL,'rejected:self_approval',NULL);
    RAISE EXCEPTION 'self_approval_forbidden';
  END IF;
  v_new := CASE _action WHEN 'approve' THEN 'APPROVED' WHEN 'process' THEN 'PROCESSING' WHEN 'pay' THEN 'PAID' WHEN 'reject' THEN 'REJECTED' END;
  IF v_new IS NULL THEN RAISE EXCEPTION 'invalid_action'; END IF;
  IF v_new='PAID' THEN RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required'); END IF;
  IF v_new IN ('APPROVED','PROCESSING') AND coalesce(w.destination->>'version','')<>'1' THEN RETURN jsonb_build_object('ok',false,'reason','bank_account_required'); END IF;
  IF v_new='REJECTED' AND coalesce(trim(_reason),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.store_withdrawals SET status=v_new,
    reviewed_by = CASE WHEN v_new IN ('APPROVED','REJECTED') THEN auth.uid() ELSE reviewed_by END,
    reviewed_at = CASE WHEN v_new IN ('APPROVED','REJECTED') THEN now() ELSE reviewed_at END,
    processed_by = CASE WHEN v_new='PROCESSING' THEN auth.uid() ELSE processed_by END,
    processed_at = CASE WHEN v_new='PROCESSING' THEN now() ELSE processed_at END,
    paid_by = CASE WHEN v_new='PAID' THEN auth.uid() ELSE paid_by END,
    paid_at = CASE WHEN v_new='PAID' THEN now() ELSE paid_at END,
    bank_reference = COALESCE(_bank_reference, bank_reference),
    proof_path = COALESCE(_proof_path, proof_path),
    rejection_reason = COALESCE(_reason, rejection_reason)
  WHERE id=_id;

  IF v_new='REJECTED' THEN
    INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_available, delta_reserved, origin, event_ref, idempotency_key, created_by)
    VALUES (w.store_id, w.id, 'withdrawal_release', w.amount_aoa, w.amount_aoa, -w.amount_aoa, 'withdrawal_rejected', 'withdrawal:'||w.id, 'wd_release:'||w.id, auth.uid());
  END IF;
  PERFORM public.fin_audit('withdrawal_'||_action,'withdrawal',_id::text,w.status,v_new,'ok','withdrawal:'||w.id,
    jsonb_build_object('account_suffix',right(coalesce(w.destination->>'iban',w.destination->>'account',''),4)));
  RETURN jsonb_build_object('ok',true,'status',v_new);
END $function$
;

-- Os SELECT existentes continuam reservados aos titulares/admins; não alargar RLS.
-- Novos pedidos exigem destinos; pedidos históricos não são reconstruídos a partir de contas atuais.
COMMENT ON COLUMN public.store_withdrawals.destination IS 'Immutable server-captured bank beneficiary at request time; no payment evidence';
COMMENT ON COLUMN public.payout_requests.destination IS 'Immutable server-captured bank beneficiary at request time; no payment evidence';