-- Live Teká — Migration B v2 — REVIEW ONLY — 2026-11-07
-- DO NOT APPLY without António Garcia's explicit authorization.
-- No old migration edits, data UPDATE/backfill, role memberships or bank secrets.
-- No evidence writer is supplied: official Banco Atlântico adapter is a separate gate.
-- Transaction controls omitted: an authorized migration tool owns the transaction.

ALTER TABLE public.store_withdrawals
 ADD COLUMN IF NOT EXISTS bank_operation_id uuid,
 ADD COLUMN IF NOT EXISTS verification_state text DEFAULT 'awaiting',
 ADD COLUMN IF NOT EXISTS verification_source text,
 ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.payout_requests
 ADD COLUMN IF NOT EXISTS bank_reference text,
 ADD COLUMN IF NOT EXISTS bank_operation_id uuid,
 ADD COLUMN IF NOT EXISTS verification_state text DEFAULT 'awaiting',
 ADD COLUMN IF NOT EXISTS verification_source text,
 ADD COLUMN IF NOT EXISTS verified_at timestamptz,
 ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE public.financial_audit_log
 ADD COLUMN IF NOT EXISTS subject_kind text,
 ADD COLUMN IF NOT EXISTS subject_id uuid,
 ADD COLUMN IF NOT EXISTS balance_before jsonb,
 ADD COLUMN IF NOT EXISTS balance_after jsonb;
COMMENT ON COLUMN public.payout_requests.rejection_reason IS
 'Nonblank reason presents raw cancelled as rejected. Preserve original status CHECK and historical rows.';
COMMENT ON COLUMN public.financial_audit_log.balance_before IS
 'Atomic prospective snapshot only; NULL for history without a contemporaneous measured balance.';
COMMENT ON COLUMN public.financial_audit_log.balance_after IS
 'Atomic prospective snapshot only; never infer old balances from current balances.';

-- Fail-closed trusted destination mapping; no writer until official integration.
CREATE TABLE public.withdrawal_bank_destinations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 resource text NOT NULL CHECK(resource IN ('store','affiliate','courier')),
 subject_id uuid NOT NULL,
 destination jsonb NOT NULL CHECK(jsonb_typeof(destination)='object' AND destination<>'{}'::jsonb),
 destination_account text NOT NULL CHECK(length(btrim(destination_account))>0),
 bank_lookup_reference text NOT NULL CHECK(length(btrim(bank_lookup_reference))>0),
 verified_at timestamptz NOT NULL,
 UNIQUE(resource,subject_id,destination)
);
GRANT SELECT ON public.withdrawal_bank_destinations TO service_role;
ALTER TABLE public.withdrawal_bank_destinations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.withdrawal_bank_destinations FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.withdrawal_bank_destinations FROM service_role;
CREATE TRIGGER bank_destinations_immutable BEFORE UPDATE OR DELETE ON public.withdrawal_bank_destinations
 FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- Nullable contemporaneous snapshots; legacy ledger rows remain untouched.
ALTER TABLE public.ledger_entries ADD COLUMN IF NOT EXISTS audit_balance_before jsonb;
ALTER TABLE public.payout_requests ADD COLUMN IF NOT EXISTS audit_balance_before jsonb;
CREATE UNIQUE INDEX ledger_withdrawal_event_v2 ON public.ledger_entries(withdrawal_id,kind)
 WHERE withdrawal_id IS NOT NULL AND kind IN ('withdrawal_reserve','withdrawal_paid','withdrawal_release');
-- Existing UNIQUE(idempotency_key) remains unchanged; no data cleanup if index fails.

-- Immutable, prior expected bank instruction; NOT proof of payment.
CREATE TABLE public.withdrawal_bank_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 resource text NOT NULL CHECK (resource IN ('store','affiliate','courier')),
 withdrawal_id uuid NOT NULL,
 subject_id uuid NOT NULL,
 reference text NOT NULL CHECK (length(btrim(reference)) > 0),
 amount numeric(14,2) NOT NULL CHECK (amount > 0),
 currency text NOT NULL CHECK (currency='AOA'),
 destination jsonb NOT NULL CHECK (jsonb_typeof(destination)='object' AND destination <> '{}'::jsonb),
 destination_account text NOT NULL CHECK (length(btrim(destination_account)) > 0),
 registered_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(resource,withdrawal_id), UNIQUE(reference)
);
GRANT SELECT ON public.withdrawal_bank_operations TO service_role;
ALTER TABLE public.withdrawal_bank_operations ENABLE ROW LEVEL SECURITY;
-- No client policy. Definer RPC below is the only expected-instruction writer.
REVOKE ALL ON public.withdrawal_bank_operations FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.withdrawal_bank_operations FROM service_role;
CREATE TRIGGER bank_operations_immutable BEFORE UPDATE OR DELETE
 ON public.withdrawal_bank_operations FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- Deliberately EMPTY: no API/role/function here can insert trusted bank evidence.
-- A future independently reviewed official adapter must write this atomically only
-- after official authenticity verification AND server-side final transfer lookup.
CREATE TABLE public.withdrawal_bank_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL UNIQUE REFERENCES public.withdrawal_bank_operations(id),
 provider text NOT NULL CHECK (provider='atlantico'),
 bank_transaction_id text NOT NULL UNIQUE CHECK (length(btrim(bank_transaction_id))>0),
 resource text NOT NULL CHECK (resource IN ('store','affiliate','courier')),
 withdrawal_id uuid NOT NULL,
 reference text NOT NULL UNIQUE CHECK (length(btrim(reference))>0),
 amount numeric(14,2) NOT NULL CHECK (amount>0),
 currency text NOT NULL CHECK (currency='AOA'),
 destination_account text NOT NULL CHECK (length(btrim(destination_account))>0),
 final_success boolean NOT NULL CHECK (final_success),
 authenticity_method text NOT NULL CHECK (length(btrim(authenticity_method))>0),
 authenticity_checked_at timestamptz NOT NULL,
 final_state_checked_at timestamptz NOT NULL,
 notification_digest text NOT NULL CHECK (length(btrim(notification_digest))>0),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT SELECT ON public.withdrawal_bank_evidence TO service_role;
ALTER TABLE public.withdrawal_bank_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.withdrawal_bank_evidence FROM PUBLIC,anon,authenticated;
REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER ON public.withdrawal_bank_evidence FROM service_role;
CREATE TRIGGER bank_evidence_immutable BEFORE UPDATE OR DELETE
 ON public.withdrawal_bank_evidence FOR EACH ROW EXECUTE FUNCTION public.block_mutation();
-- No cascading FK, no raw webhook payload, no guessed signature/header/secret.

CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa()
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v numeric;
BEGIN
 SELECT min_amount INTO v FROM public.withdrawal_limits WHERE currency='AOA';
 IF v IS NULL OR v <= 0 OR v::text='NaN' THEN RAISE EXCEPTION 'withdrawal_limits_not_configured'; END IF;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa()
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v numeric;
BEGIN
 SELECT max_daily_amount INTO v FROM public.withdrawal_limits WHERE currency='AOA';
 IF v IS NULL OR v <= 0 OR v::text='NaN' OR v < public.min_withdrawal_aoa() THEN
  RAISE EXCEPTION 'withdrawal_limits_not_configured';
 END IF;
 RETURN v;
END $$;
-- Existing AOA configuration remains 10000 / 200000 / Africa/Luanda.
-- Shared per-user daily total across affiliate AND courier, preserving signature.
CREATE OR REPLACE FUNCTION public.payout_withdrawn_today(_user_id uuid,_kind text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(amount_aoa),0) FROM public.payout_requests
 WHERE user_id=_user_id AND status<>'cancelled'
 AND created_at>=public.withdrawal_day_start('AOA')
$$;

-- Internal balance helper: preserves the existing earned-amount sources.
CREATE FUNCTION public.withdrawal_subject_balance(_kind text,_subject uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE e numeric:=0; spent numeric:=0; r numeric:=0; b record;
BEGIN
 IF _kind='store' THEN
  SELECT * INTO b FROM public.ledger_balances(_subject);
  RETURN jsonb_build_object('pending_aoa',b.pending,'available_aoa',b.available,'reserved_aoa',b.reserved);
 ELSIF _kind='affiliate' THEN
  SELECT coalesce(sum(c.amount_aoa),0) INTO e FROM public.affiliate_commissions c
   JOIN public.affiliate_accounts a ON a.id=c.affiliate_id
   WHERE a.user_id=_subject AND c.status IN ('released','paid');
 ELSIF _kind='courier' THEN
  SELECT coalesce(sum(o.shipping_aoa),0) INTO e FROM public.deliveries d
   JOIN public.orders o ON o.id=d.order_id JOIN public.couriers c ON c.id=d.courier_id
   WHERE c.user_id=_subject AND d.status='delivered';
 ELSE RAISE EXCEPTION 'invalid_kind'; END IF;
 SELECT coalesce(sum(amount_aoa) FILTER(WHERE status='paid'),0),
        coalesce(sum(amount_aoa) FILTER(WHERE status IN ('pending','processing')),0)
 INTO spent,r FROM public.payout_requests WHERE user_id=_subject AND kind=_kind;
 RETURN jsonb_build_object('available_aoa',e-spent-r,'reserved_aoa',r,'paid_aoa',spent);
END $$;
REVOKE ALL ON FUNCTION public.withdrawal_subject_balance(text,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'multicaixa_express', _destination jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog,public AS $$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_available numeric; v_amount numeric;
        v_min numeric; v_remaining numeric; v_id uuid; v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind IS NULL OR _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout_user:'||v_uid::text));
  LOCK TABLE public.affiliate_commissions,public.deliveries,public.orders IN SHARE MODE;
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

-- Trigger backstop for min, shared daily cap, balance and unchanged identity.
-- RPCs acquire scope before row locks. Direct UPDATE grants are removed below.
CREATE FUNCTION public.guard_payout_financial_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('payout_user:'||NEW.user_id::text));
 -- Freeze existing earnings sources through both measurements, including external writers.
 -- Coarse SHARE locks are a documented throughput/deadlock risk, not a hidden guarantee.
 LOCK TABLE public.affiliate_commissions,public.deliveries,public.orders IN SHARE MODE;
 NEW.audit_balance_before:=public.withdrawal_subject_balance(NEW.kind,NEW.user_id);
 IF TG_OP='INSERT' THEN
  IF NEW.status IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'initial_status_not_allowed'; END IF;
  IF NEW.amount_aoa IS NULL OR NEW.amount_aoa::text='NaN' OR NEW.amount_aoa<public.min_withdrawal_aoa() THEN
   RAISE EXCEPTION 'withdrawal_below_minimum_10k'; END IF;
  IF public.payout_withdrawn_today(NEW.user_id,NEW.kind)+NEW.amount_aoa>public.max_daily_withdrawal_aoa()
   THEN RAISE EXCEPTION 'daily_limit'; END IF;
  b:=public.withdrawal_subject_balance(NEW.kind,NEW.user_id);
  IF NEW.amount_aoa>(b->>'available_aoa')::numeric THEN RAISE EXCEPTION 'insufficient_balance'; END IF;
 ELSE
  IF OLD.status IN ('paid','cancelled') THEN RAISE EXCEPTION 'payout_final'; END IF;
  IF ROW(NEW.user_id,NEW.kind,NEW.amount_aoa,NEW.method,NEW.destination,NEW.created_at,NEW.id)
   IS DISTINCT FROM ROW(OLD.user_id,OLD.kind,OLD.amount_aoa,OLD.method,OLD.destination,OLD.created_at,OLD.id)
   THEN RAISE EXCEPTION 'payout_immutable_fields'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT
   ((OLD.status='pending' AND NEW.status IN ('processing','cancelled')) OR
    (OLD.status='processing' AND NEW.status='paid')) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
  IF NEW.status='paid' AND NOT EXISTS (
   SELECT 1 FROM public.withdrawal_bank_operations o JOIN public.withdrawal_bank_evidence e ON e.operation_id=o.id
   WHERE o.id=NEW.bank_operation_id AND o.resource=NEW.kind AND o.withdrawal_id=NEW.id
    AND o.subject_id=NEW.user_id AND o.amount=NEW.amount_aoa AND o.currency='AOA'
    AND o.reference=NEW.bank_reference AND o.destination=NEW.destination
    AND e.resource=o.resource AND e.withdrawal_id=o.withdrawal_id AND e.reference=o.reference
    AND e.amount=o.amount AND e.currency=o.currency AND e.destination_account=o.destination_account
    AND e.final_success AND NEW.verification_state='verified' AND NEW.verification_source='atlantico'
    AND NEW.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'bank_confirmation_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payout_financial_v2 BEFORE INSERT OR UPDATE ON public.payout_requests
 FOR EACH ROW EXECUTE FUNCTION public.guard_payout_financial_v2();
CREATE TRIGGER payout_no_delete_v2 BEFORE DELETE ON public.payout_requests
 FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- Extra store guard supplements (does not remove) original transition guard.
CREATE FUNCTION public.guard_store_financial_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ledger:'||NEW.store_id::text));
 IF TG_OP='INSERT' THEN
  IF NEW.status IS DISTINCT FROM 'PENDING_REVIEW' THEN RAISE EXCEPTION 'initial_status_not_allowed'; END IF;
  IF NEW.amount_aoa IS NULL OR NEW.amount_aoa::text='NaN' OR NEW.amount_aoa<public.min_withdrawal_aoa() THEN
   RAISE EXCEPTION 'withdrawal_below_minimum_10k'; END IF;
  IF public.store_withdrawn_today(NEW.store_id)+NEW.amount_aoa>public.max_daily_withdrawal_aoa()
   THEN RAISE EXCEPTION 'daily_limit'; END IF;
 ELSE
  IF OLD.status IN ('PAID','REJECTED') THEN RAISE EXCEPTION 'withdrawal_final'; END IF;
  IF ROW(NEW.id,NEW.created_at,NEW.destination) IS DISTINCT FROM ROW(OLD.id,OLD.created_at,OLD.destination)
   THEN RAISE EXCEPTION 'withdrawal_immutable_fields'; END IF;
  IF NEW.status='PAID' AND NOT EXISTS (
   SELECT 1 FROM public.withdrawal_bank_operations o JOIN public.withdrawal_bank_evidence e ON e.operation_id=o.id
   WHERE o.id=NEW.bank_operation_id AND o.resource='store' AND o.withdrawal_id=NEW.id
    AND o.subject_id=NEW.store_id AND o.amount=NEW.amount_aoa AND o.currency='AOA'
    AND o.reference=NEW.bank_reference AND o.destination=NEW.destination
    AND e.resource=o.resource AND e.withdrawal_id=o.withdrawal_id AND e.reference=o.reference
    AND e.amount=o.amount AND e.currency=o.currency AND e.destination_account=o.destination_account
    AND e.final_success AND NEW.verification_state='verified' AND NEW.verification_source='atlantico'
    AND NEW.verified_at IS NOT NULL) THEN RAISE EXCEPTION 'bank_confirmation_required'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER store_financial_v2 BEFORE INSERT OR UPDATE ON public.store_withdrawals
 FOR EACH ROW EXECUTE FUNCTION public.guard_store_financial_v2();

-- Register expectation without changing the original destination or request row.
-- _account must be an officially mapped account from that EXACT saved destination.
-- No bank-format mapping is invented here; missing destination/mapping blocks processing.
CREATE FUNCTION public.register_withdrawal_bank_operation(
 _resource text,_id uuid,_reference text,_destination jsonb,_account text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s uuid; u uuid; a numeric; d jsonb; st text; op public.withdrawal_bank_operations;
BEGIN
 IF auth.uid() IS NULL OR public.has_role(auth.uid(),'admin') IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
 IF _resource IS NULL OR _resource NOT IN ('store','affiliate','courier') OR _id IS NULL
  OR _reference IS NULL OR btrim(_reference)='' OR _account IS NULL OR btrim(_account)=''
  OR _destination IS NULL OR jsonb_typeof(_destination)<>'object' OR _destination='{}'::jsonb
  THEN RETURN jsonb_build_object('ok',false,'reason','missing_bank_mapping'); END IF;
 IF _resource='store' THEN
  SELECT store_id INTO s FROM public.store_withdrawals WHERE id=_id;
  IF s IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||s::text));
  SELECT w.amount_aoa,w.destination,w.status,t.owner_id INTO a,d,st,u
   FROM public.store_withdrawals w JOIN public.stores t ON t.id=w.store_id WHERE w.id=_id FOR UPDATE OF w;
  IF u=auth.uid() OR EXISTS(SELECT 1 FROM public.store_withdrawals WHERE id=_id AND requested_by=auth.uid())
   THEN RETURN jsonb_build_object('ok',false,'reason','self_approval_forbidden'); END IF;
  IF st<>'APPROVED' THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition'); END IF;
 ELSE
  SELECT user_id INTO s FROM public.payout_requests WHERE id=_id AND kind=_resource;
  IF s IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payout_user:'||s::text));
  SELECT amount_aoa,destination,status,user_id INTO a,d,st,u FROM public.payout_requests WHERE id=_id FOR UPDATE;
  IF u=auth.uid() THEN RETURN jsonb_build_object('ok',false,'reason','self_approval_forbidden'); END IF;
  IF st<>'pending' THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition'); END IF;
 END IF;
 IF d IS DISTINCT FROM _destination THEN RETURN jsonb_build_object('ok',false,'reason','destination_mismatch'); END IF;
 IF NOT EXISTS(SELECT 1 FROM public.withdrawal_bank_destinations m WHERE m.resource=_resource
  AND m.subject_id=s AND m.destination=d AND m.destination_account=_account) THEN
  RETURN jsonb_build_object('ok',false,'reason','official_destination_mapping_required'); END IF;
 SELECT * INTO op FROM public.withdrawal_bank_operations WHERE resource=_resource AND withdrawal_id=_id;
 IF FOUND THEN
  IF ROW(op.reference,op.amount,op.currency,op.destination,op.destination_account,op.subject_id)
   IS DISTINCT FROM ROW(_reference,a,'AOA'::text,d,_account,s) THEN
   RETURN jsonb_build_object('ok',false,'reason','operation_mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'operation_id',op.id,'already_registered',true);
 END IF;
 INSERT INTO public.withdrawal_bank_operations(resource,withdrawal_id,subject_id,reference,amount,currency,destination,destination_account,registered_by)
 VALUES(_resource,_id,s,_reference,a,'AOA',d,_account,auth.uid()) RETURNING * INTO op;
 PERFORM public.fin_audit('bank_operation_registered',_resource,_id::text,st,st,'ok',op.id::text);
 RETURN jsonb_build_object('ok',true,'operation_id',op.id);
END $$;
REVOKE ALL ON FUNCTION public.register_withdrawal_bank_operation(text,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.register_withdrawal_bank_operation(text,uuid,text,jsonb,text) TO authenticated;

-- Preserve every existing RPC argument and default; manual pay now fails closed.
CREATE OR REPLACE FUNCTION public.admin_withdrawal_action(
 _id uuid,_action text,_bank_reference text DEFAULT NULL,_proof_path text DEFAULT NULL,_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.store_withdrawals; s uuid; u uuid; ns text; op public.withdrawal_bank_operations;
BEGIN
 IF auth.uid() IS NULL OR public.has_role(auth.uid(),'admin') IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
 SELECT store_id INTO s FROM public.store_withdrawals WHERE id=_id;
 IF s IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('ledger:'||s::text));
 SELECT * INTO w FROM public.store_withdrawals WHERE id=_id FOR UPDATE;
 SELECT owner_id INTO u FROM public.stores WHERE id=s;
 IF u=auth.uid() OR w.requested_by=auth.uid() THEN
  PERFORM public.fin_audit('withdrawal_action','store',_id::text,w.status,w.status,'rejected:self_approval',NULL);
  RETURN jsonb_build_object('ok',false,'reason','self_approval_forbidden'); END IF;
 IF _action='pay' THEN RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required'); END IF;
 ns:=CASE _action WHEN 'approve' THEN 'APPROVED' WHEN 'process' THEN 'PROCESSING' WHEN 'reject' THEN 'REJECTED' END;
 IF ns IS NULL OR NOT ((w.status='PENDING_REVIEW' AND ns IN ('APPROVED','REJECTED')) OR
  (w.status='APPROVED' AND ns IN ('PROCESSING','REJECTED'))) THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid_transition'); END IF;
 IF ns='REJECTED' AND coalesce(btrim(_reason),'')='' THEN RETURN jsonb_build_object('ok',false,'reason','reason_required'); END IF;
 IF ns='PROCESSING' THEN
  SELECT * INTO op FROM public.withdrawal_bank_operations WHERE resource='store' AND withdrawal_id=_id;
  IF NOT FOUND OR (_bank_reference IS NOT NULL AND _bank_reference IS DISTINCT FROM op.reference)
   THEN RETURN jsonb_build_object('ok',false,'reason','bank_operation_required'); END IF;
 END IF;
 UPDATE public.store_withdrawals SET status=ns,
  reviewed_by=CASE WHEN ns IN ('APPROVED','REJECTED') THEN auth.uid() ELSE reviewed_by END,
  reviewed_at=CASE WHEN ns IN ('APPROVED','REJECTED') THEN clock_timestamp() ELSE reviewed_at END,
  processed_by=CASE WHEN ns='PROCESSING' THEN auth.uid() ELSE processed_by END,
  processed_at=CASE WHEN ns='PROCESSING' THEN clock_timestamp() ELSE processed_at END,
  bank_operation_id=CASE WHEN ns='PROCESSING' THEN op.id ELSE bank_operation_id END,
  bank_reference=CASE WHEN ns='PROCESSING' THEN op.reference ELSE bank_reference END,
  proof_path=coalesce(_proof_path,proof_path),rejection_reason=CASE WHEN ns='REJECTED' THEN _reason ELSE rejection_reason END
 WHERE id=_id;
 IF ns='REJECTED' THEN
  INSERT INTO public.ledger_entries(store_id,withdrawal_id,kind,net_aoa,delta_available,delta_reserved,origin,event_ref,idempotency_key,created_by)
  VALUES(s,_id,'withdrawal_release',w.amount_aoa,w.amount_aoa,-w.amount_aoa,'withdrawal_rejected','withdrawal:'||_id,'wd_release:'||_id,auth.uid());
 END IF;
 PERFORM public.fin_audit('withdrawal_'||_action,'store',_id::text,w.status,ns,'ok','withdrawal:'||_id);
 RETURN jsonb_build_object('ok',true,'status',ns);
END $$;
CREATE OR REPLACE FUNCTION public.admin_settle_payout(
 _payout_id uuid,_status text DEFAULT 'paid',_note text DEFAULT NULL,_bank_reference text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w public.payout_requests; u uuid; ns text; op public.withdrawal_bank_operations;
BEGIN
 IF auth.uid() IS NULL OR public.has_role(auth.uid(),'admin') IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
 SELECT user_id INTO u FROM public.payout_requests WHERE id=_payout_id;
 IF u IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
 PERFORM pg_advisory_xact_lock(hashtext('payout_user:'||u::text));
 SELECT * INTO w FROM public.payout_requests WHERE id=_payout_id FOR UPDATE;
 IF u=auth.uid() THEN
  PERFORM public.fin_audit('payout_action',w.kind,w.id::text,w.status,w.status,'rejected:self_approval',NULL);
  RETURN jsonb_build_object('ok',false,'reason','self_approval_forbidden'); END IF;
 IF _status='paid' THEN RETURN jsonb_build_object('ok',false,'reason','bank_confirmation_required'); END IF;
 ns:=CASE WHEN _status='rejected' THEN 'cancelled' ELSE _status END;
 IF ns IS NULL OR ns NOT IN ('processing','cancelled') OR w.status<>'pending' THEN
  RETURN jsonb_build_object('ok',false,'reason','invalid_transition'); END IF;
 IF _status='rejected' AND coalesce(btrim(_note),'')='' THEN RETURN jsonb_build_object('ok',false,'reason','reason_required'); END IF;
 IF ns='processing' THEN
  SELECT * INTO op FROM public.withdrawal_bank_operations WHERE resource=w.kind AND withdrawal_id=w.id;
  IF NOT FOUND OR (_bank_reference IS NOT NULL AND _bank_reference IS DISTINCT FROM op.reference)
   THEN RETURN jsonb_build_object('ok',false,'reason','bank_operation_required'); END IF;
 END IF;
 UPDATE public.payout_requests SET status=ns,note=coalesce(_note,note),
  rejection_reason=CASE WHEN _status='rejected' THEN _note ELSE rejection_reason END,
  bank_operation_id=CASE WHEN ns='processing' THEN op.id ELSE bank_operation_id END,
  bank_reference=CASE WHEN ns='processing' THEN op.reference ELSE bank_reference END,
  processed_at=CASE WHEN ns='cancelled' THEN clock_timestamp() ELSE processed_at END WHERE id=w.id;
 INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
 VALUES(u,'payout.'||_status,CASE WHEN _status='rejected' THEN 'Levantamento recusado'
  WHEN ns='cancelled' THEN 'Levantamento cancelado' ELSE 'Levantamento em processamento' END,
  'Kz '||w.amount_aoa,CASE WHEN w.kind='affiliate' THEN '/afiliados' ELSE '/transportador' END,w.id);
 RETURN jsonb_build_object('ok',true,'status',ns,'display_status',_status);
END $$;

-- Service-only consumer. No payload flag or current_user-in-definer authentication.
-- Trusted persisted evidence is REQUIRED even for an already-paid retry.
CREATE FUNCTION public.verify_withdrawal_payment(
 _id uuid,_resource text,_reference text,_amount numeric,_currency text,_destination_account text,_evidence_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE op public.withdrawal_bank_operations; ev public.withdrawal_bank_evidence;
 s uuid; st text; a numeric; d jsonb; linked uuid; saved_ref text; vs text; source text; vt timestamptz;
BEGIN
 IF _id IS NULL OR _resource IS NULL OR _resource NOT IN ('store','affiliate','courier')
  OR _reference IS NULL OR btrim(_reference)='' OR _amount IS NULL OR _amount::text='NaN'
  OR _amount<=0 OR _amount<>round(_amount,2) OR _currency IS DISTINCT FROM 'AOA'
  OR _destination_account IS NULL OR btrim(_destination_account)='' OR _evidence_id IS NULL
 THEN RETURN jsonb_build_object('ok',false,'reason','invalid_bank_tuple'); END IF;
 SELECT * INTO op FROM public.withdrawal_bank_operations WHERE resource=_resource AND withdrawal_id=_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','bank_operation_required'); END IF;
 SELECT * INTO ev FROM public.withdrawal_bank_evidence WHERE id=_evidence_id;
 IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','official_bank_evidence_required'); END IF;
 IF ROW(op.resource,op.withdrawal_id,op.reference,op.amount,op.currency,op.destination_account)
  IS DISTINCT FROM ROW(_resource,_id,_reference,_amount,_currency,_destination_account)
  OR ROW(ev.operation_id,ev.resource,ev.withdrawal_id,ev.reference,ev.amount,ev.currency,ev.destination_account)
  IS DISTINCT FROM ROW(op.id,_resource,_id,_reference,_amount,_currency,_destination_account)
  OR NOT ev.final_success THEN RETURN jsonb_build_object('ok',false,'reason','bank_tuple_mismatch'); END IF;
 s:=op.subject_id;
 PERFORM pg_advisory_xact_lock(hashtext(CASE WHEN _resource='store' THEN 'ledger:' ELSE 'payout_user:' END||s::text));
 IF _resource='store' THEN
  SELECT status,amount_aoa,destination,bank_operation_id,bank_reference,verification_state,verification_source,verified_at INTO st,a,d,linked,saved_ref,vs,source,vt
   FROM public.store_withdrawals WHERE id=_id AND store_id=s FOR UPDATE;
 ELSE
  SELECT status,amount_aoa,destination,bank_operation_id,bank_reference,verification_state,verification_source,verified_at INTO st,a,d,linked,saved_ref,vs,source,vt
   FROM public.payout_requests WHERE id=_id AND kind=_resource AND user_id=s FOR UPDATE;
 END IF;
 IF st IS NULL OR a IS DISTINCT FROM _amount OR d IS DISTINCT FROM op.destination OR linked IS DISTINCT FROM op.id OR saved_ref IS DISTINCT FROM _reference
  THEN RETURN jsonb_build_object('ok',false,'reason','request_tuple_mismatch'); END IF;
 IF st IN ('PAID','paid') THEN
  IF vs IS DISTINCT FROM 'verified' OR source IS DISTINCT FROM 'atlantico' OR vt IS NULL THEN
   RETURN jsonb_build_object('ok',false,'reason','persisted_verification_mismatch'); END IF;
  IF _resource='store' AND NOT EXISTS(SELECT 1 FROM public.ledger_entries l WHERE l.withdrawal_id=_id
   AND l.store_id=s AND l.kind='withdrawal_paid' AND l.idempotency_key='wd_paid:'||_id
   AND l.net_aoa=a AND l.delta_reserved=-a AND l.event_ref=_reference) THEN
   RETURN jsonb_build_object('ok',false,'reason','paid_ledger_mismatch'); END IF;
  RETURN jsonb_build_object('ok',true,'already_verified',true,'id',_id,'status',st);
 END IF;
 IF st NOT IN ('PROCESSING','processing') THEN RETURN jsonb_build_object('ok',false,'reason','invalid_transition'); END IF;
 IF _resource='store' THEN
  UPDATE public.store_withdrawals SET status='PAID',verification_state='verified',verification_source='atlantico',
   verified_at=clock_timestamp(),paid_at=clock_timestamp(),paid_by=NULL WHERE id=_id;
  INSERT INTO public.ledger_entries(store_id,withdrawal_id,kind,net_aoa,delta_reserved,origin,event_ref,idempotency_key)
  VALUES(s,_id,'withdrawal_paid',a,-a,'bank_transfer',_reference,'wd_paid:'||_id);
 ELSE
  UPDATE public.payout_requests SET status='paid',verification_state='verified',verification_source='atlantico',
   verified_at=clock_timestamp(),processed_at=clock_timestamp() WHERE id=_id;
  INSERT INTO public.user_notifications(user_id,kind,title,body,url,ref_id)
  VALUES(s,'payout.paid','Levantamento pago','Kz '||a,
   CASE WHEN _resource='affiliate' THEN '/afiliados' ELSE '/transportador' END,_id);
 END IF;
 PERFORM public.fin_audit('bank_payment_verified',_resource,_id::text,st,
  CASE WHEN _resource='store' THEN 'PAID' ELSE 'paid' END,'ok',ev.bank_transaction_id,
  jsonb_build_object('evidence_id',ev.id,'operation_id',op.id,'amount_aoa',a));
 RETURN jsonb_build_object('ok',true,'id',_id,'already_verified',false);
END $$;
REVOKE ALL ON FUNCTION public.verify_withdrawal_payment(uuid,text,text,numeric,text,text,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.verify_withdrawal_payment(uuid,text,text,numeric,text,text,uuid) TO service_role;

-- BEFORE measures the balance; AFTER measures again and checks the signed delta.
-- Multirow statements whose per-row snapshots cannot be established abort, never invent values.
CREATE FUNCTION public.capture_ledger_before_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ledger:'||NEW.store_id::text));
 NEW.audit_balance_before:=public.withdrawal_subject_balance('store',NEW.store_id);
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_capture_before_v2 BEFORE INSERT ON public.ledger_entries
 FOR EACH ROW EXECUTE FUNCTION public.capture_ledger_before_v2();
-- Prospective real signed ledger snapshots; never edit previous audit rows.
CREATE FUNCTION public.audit_ledger_balance_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE b record;
BEGIN
 SELECT * INTO b FROM public.ledger_balances(NEW.store_id);
 IF NEW.audit_balance_before IS NULL OR
  b.pending IS DISTINCT FROM (NEW.audit_balance_before->>'pending_aoa')::numeric+NEW.delta_pending OR
  b.available IS DISTINCT FROM (NEW.audit_balance_before->>'available_aoa')::numeric+NEW.delta_available OR
  b.reserved IS DISTINCT FROM (NEW.audit_balance_before->>'reserved_aoa')::numeric+NEW.delta_reserved THEN
  RAISE EXCEPTION 'audit_snapshot_not_serialized'; END IF;
 INSERT INTO public.financial_audit_log(actor_id,action,resource,resource_id,result,operation_id,
  subject_kind,subject_id,balance_before,balance_after,metadata,created_at)
 VALUES(auth.uid(),NEW.kind,'store',coalesce(NEW.withdrawal_id,NEW.order_id)::text,'ok',NEW.idempotency_key,
  'store',NEW.store_id,
  NEW.audit_balance_before,
  jsonb_build_object('pending_aoa',b.pending,'available_aoa',b.available,'reserved_aoa',b.reserved),
  jsonb_build_object('ledger_entry_id',NEW.id),clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_balance_audit_v2 AFTER INSERT ON public.ledger_entries
 FOR EACH ROW EXECUTE FUNCTION public.audit_ledger_balance_v2();

CREATE FUNCTION public.audit_payout_balance_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE after_b jsonb; before_b jsonb; old_r numeric:=0; old_p numeric:=0; new_r numeric:=0; new_p numeric:=0; prev text;
BEGIN
 IF TG_OP='UPDATE' THEN
  prev:=OLD.status;
  old_r:=CASE WHEN OLD.status IN ('pending','processing') THEN OLD.amount_aoa ELSE 0 END;
  old_p:=CASE WHEN OLD.status='paid' THEN OLD.amount_aoa ELSE 0 END;
 END IF;
 new_r:=CASE WHEN NEW.status IN ('pending','processing') THEN NEW.amount_aoa ELSE 0 END;
 new_p:=CASE WHEN NEW.status='paid' THEN NEW.amount_aoa ELSE 0 END;
 after_b:=public.withdrawal_subject_balance(NEW.kind,NEW.user_id);
 IF (after_b->>'available_aoa')::numeric<0 THEN RAISE EXCEPTION 'negative_payout_balance'; END IF;
 IF NEW.audit_balance_before IS DISTINCT FROM jsonb_build_object('available_aoa',(after_b->>'available_aoa')::numeric+new_r+new_p-old_r-old_p,
  'reserved_aoa',(after_b->>'reserved_aoa')::numeric-new_r+old_r,
  'paid_aoa',(after_b->>'paid_aoa')::numeric-new_p+old_p) THEN
  RAISE EXCEPTION 'audit_snapshot_not_serialized'; END IF;
 before_b:=NEW.audit_balance_before;
 INSERT INTO public.financial_audit_log(actor_id,action,resource,resource_id,previous_state,new_state,result,
  operation_id,subject_kind,subject_id,balance_before,balance_after,metadata,created_at)
 VALUES(auth.uid(),'payout_state',NEW.kind,NEW.id::text,prev,NEW.status,'ok',NEW.id::text||':'||NEW.status,
  NEW.kind,NEW.user_id,before_b,after_b,jsonb_build_object('amount_aoa',NEW.amount_aoa),clock_timestamp());
 RETURN NEW;
END $$;
CREATE TRIGGER payout_balance_audit_v2 AFTER INSERT OR UPDATE ON public.payout_requests
 FOR EACH ROW EXECUTE FUNCTION public.audit_payout_balance_v2();

-- Authenticated own history, or admin global history; no arbitrary subject selector.
CREATE FUNCTION public.withdrawal_audit_overview(_scope text DEFAULT 'own',_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE out_json jsonb;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
 IF _scope IS NULL OR _scope NOT IN ('own','admin') OR _limit IS NULL OR _limit<1 OR _limit>500
  THEN RAISE EXCEPTION 'invalid_audit_query'; END IF;
 IF _scope='admin' AND public.has_role(auth.uid(),'admin') IS NOT TRUE THEN RAISE EXCEPTION 'not_authorized'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.created_at,q.id),'[]'::jsonb) INTO out_json FROM (
  SELECT a.id,a.action,a.resource,a.resource_id,a.previous_state,a.new_state,a.result,a.operation_id,
   a.subject_kind,a.subject_id,a.balance_before,a.balance_after,a.created_at,
   (a.balance_before IS NOT NULL AND a.balance_after IS NOT NULL) AS has_measured_balances
  FROM public.financial_audit_log a WHERE _scope='admin' OR
   (a.subject_kind IN ('affiliate','courier') AND a.subject_id=auth.uid()) OR
   (a.subject_kind='store' AND EXISTS(SELECT 1 FROM public.stores s WHERE s.id=a.subject_id AND s.owner_id=auth.uid())) OR
   (a.resource IN ('store','withdrawal') AND EXISTS(SELECT 1 FROM public.store_withdrawals w
    JOIN public.stores s ON s.id=w.store_id WHERE w.id::text=a.resource_id AND s.owner_id=auth.uid())) OR
   (a.resource IN ('affiliate','courier') AND EXISTS(SELECT 1 FROM public.payout_requests p
    WHERE p.id::text=a.resource_id AND p.user_id=auth.uid()))
  ORDER BY a.created_at DESC,a.id DESC LIMIT _limit
 ) q;
 RETURN out_json;
END $$;
REVOKE ALL ON FUNCTION public.withdrawal_audit_overview(text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.withdrawal_audit_overview(text,integer) TO authenticated;

-- Preserve RLS SELECT policies. No membership manipulation; no executor role.
-- Direct DML is not an alternative path for client/admin/service financial state.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.ledger_entries,public.store_withdrawals,
 public.payout_requests,public.financial_audit_log FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ledger_entries,public.store_withdrawals,public.payout_requests,public.financial_audit_log TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.request_payout(text,text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_payout(text,text,jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_settle_payout(uuid,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_settle_payout(uuid,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.min_withdrawal_aoa(),public.max_daily_withdrawal_aoa() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.min_withdrawal_aoa(),public.max_daily_withdrawal_aoa() TO authenticated;
REVOKE ALL ON FUNCTION public.guard_payout_financial_v2(),public.guard_store_financial_v2(),
 public.audit_ledger_balance_v2(),public.audit_payout_balance_v2(),public.capture_ledger_before_v2() FROM PUBLIC,anon,authenticated,service_role;
-- No obsolete schema is retired by this proposal: no DEPRECATED comments needed.
-- Original status, amounts, destinations, ledger history and migrations remain.

-- The live baseline has ONLY the four-argument settlement RPC (catalog read).
-- Fail closed for any overlooked legacy overload without dropping its definition.
DO $$
BEGIN
 IF to_regprocedure('public.admin_settle_payout(uuid,text,text)') IS NOT NULL THEN
  EXECUTE 'REVOKE ALL ON FUNCTION public.admin_settle_payout(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role';
 END IF;
END $$;
