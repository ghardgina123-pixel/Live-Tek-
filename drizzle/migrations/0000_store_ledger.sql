
CREATE TABLE public.ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  order_id uuid REFERENCES public.orders(id),
  withdrawal_id uuid,
  kind text NOT NULL CHECK (kind IN ('sale_credit','release','withdrawal_reserve','withdrawal_release','withdrawal_paid','adjustment','reversal')),
  currency text NOT NULL DEFAULT 'AOA' CHECK (currency = 'AOA'),
  gross_aoa numeric(14,2) NOT NULL DEFAULT 0,
  commission_aoa numeric(14,2) NOT NULL DEFAULT 0,
  net_aoa numeric(14,2) NOT NULL DEFAULT 0,
  delta_pending numeric(14,2) NOT NULL DEFAULT 0,
  delta_available numeric(14,2) NOT NULL DEFAULT 0,
  delta_reserved numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'posted',
  origin text NOT NULL,
  event_ref text,
  idempotency_key text NOT NULL UNIQUE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_store_idx ON public.ledger_entries(store_id, created_at DESC);

CREATE TABLE public.store_withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id),
  requested_by uuid NOT NULL,
  amount_aoa numeric(14,2) NOT NULL CHECK (amount_aoa > 0),
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','PROCESSING','PAID','REJECTED')),
  destination jsonb,
  reviewed_by uuid, reviewed_at timestamptz,
  processed_by uuid, processed_at timestamptz,
  paid_by uuid, paid_at timestamptz,
  bank_reference text,
  proof_path text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX store_withdrawals_one_open ON public.store_withdrawals(store_id) WHERE status IN ('PENDING_REVIEW','APPROVED','PROCESSING');

CREATE TABLE public.financial_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  resource text NOT NULL,
  resource_id text,
  previous_state text,
  new_state text,
  result text NOT NULL,
  operation_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ledger_entries, public.store_withdrawals, public.financial_audit_log TO authenticated;
GRANT ALL ON public.ledger_entries, public.store_withdrawals, public.financial_audit_log TO service_role;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY ledger_select_owner_admin ON public.ledger_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
CREATE POLICY withdrawals_select_owner_admin ON public.store_withdrawals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
CREATE POLICY fin_audit_select_admin ON public.financial_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- Immutability
CREATE OR REPLACE FUNCTION public.block_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'immutable_record:%', TG_TABLE_NAME; END $$;
CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER fin_audit_immutable BEFORE UPDATE OR DELETE ON public.financial_audit_log FOR EACH ROW EXECUTE FUNCTION public.block_mutation();
CREATE TRIGGER withdrawals_no_delete BEFORE DELETE ON public.store_withdrawals FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- Withdrawal transitions
CREATE OR REPLACE FUNCTION public.guard_withdrawal_transition() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.store_id <> OLD.store_id OR NEW.amount_aoa <> OLD.amount_aoa OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'withdrawal_immutable_fields';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status='PENDING_REVIEW' AND NEW.status IN ('APPROVED','REJECTED')) OR
       (OLD.status='APPROVED' AND NEW.status IN ('PROCESSING','REJECTED')) OR
       (OLD.status='PROCESSING' AND NEW.status='PAID')) THEN
    RAISE EXCEPTION 'withdrawal_transition_not_allowed:%->%', OLD.status, NEW.status;
  END IF;
  IF OLD.status IN ('PAID','REJECTED') THEN RAISE EXCEPTION 'withdrawal_final'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER withdrawals_transition BEFORE UPDATE ON public.store_withdrawals FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_transition();

-- Balance helper + non-negative guard
CREATE OR REPLACE FUNCTION public.ledger_balances(_store_id uuid)
RETURNS TABLE(pending numeric, available numeric, reserved numeric) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(delta_pending),0), COALESCE(SUM(delta_available),0), COALESCE(SUM(delta_reserved),0)
  FROM public.ledger_entries WHERE store_id = _store_id
$$;
REVOKE EXECUTE ON FUNCTION public.ledger_balances(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_ledger_non_negative() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||NEW.store_id::text));
  SELECT * INTO b FROM public.ledger_balances(NEW.store_id);
  IF b.pending + NEW.delta_pending < 0 OR b.available + NEW.delta_available < 0 OR b.reserved + NEW.delta_reserved < 0 THEN
    RAISE EXCEPTION 'ledger_negative_balance';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ledger_non_negative BEFORE INSERT ON public.ledger_entries FOR EACH ROW EXECUTE FUNCTION public.guard_ledger_non_negative();

CREATE OR REPLACE FUNCTION public.fin_audit(_action text, _resource text, _rid text, _prev text, _new text, _result text, _op text, _meta jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.financial_audit_log(actor_id, action, resource, resource_id, previous_state, new_state, result, operation_id, metadata)
  VALUES (auth.uid(), _action, _resource, _rid, _prev, _new, _result, _op, COALESCE(_meta,'{}'::jsonb))
$$;
REVOKE EXECUTE ON FUNCTION public.fin_audit(text,text,text,text,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- Feed ledger from payouts (real flows)
CREATE OR REPLACE FUNCTION public.ledger_from_payout() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NOT EXISTS (SELECT 1 FROM public.ledger_entries WHERE idempotency_key = 'sale:'||NEW.order_id) THEN
    INSERT INTO public.ledger_entries(store_id, order_id, kind, gross_aoa, commission_aoa, net_aoa, delta_pending, origin, event_ref, idempotency_key)
    VALUES (NEW.store_id, NEW.order_id, 'sale_credit', COALESCE(NEW.gross_aoa,0), COALESCE(NEW.platform_fee_aoa,0), COALESCE(NEW.net_aoa,0),
            COALESCE(NEW.net_aoa,0), 'payment_confirmed', 'payout:'||NEW.id, 'sale:'||NEW.order_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    PERFORM public.fin_audit('ledger_credit','order',NEW.order_id::text,NULL,'pending','ok','sale:'||NEW.order_id);
  END IF;
  IF NEW.status = 'released' THEN
    INSERT INTO public.ledger_entries(store_id, order_id, kind, gross_aoa, commission_aoa, net_aoa, delta_pending, delta_available, origin, event_ref, idempotency_key)
    VALUES (NEW.store_id, NEW.order_id, 'release', COALESCE(NEW.gross_aoa,0), COALESCE(NEW.platform_fee_aoa,0), COALESCE(NEW.net_aoa,0),
            -COALESCE(NEW.net_aoa,0), COALESCE(NEW.net_aoa,0), 'order_delivered', 'payout:'||NEW.id, 'release:'||NEW.order_id)
    ON CONFLICT (idempotency_key) DO NOTHING;
    PERFORM public.fin_audit('ledger_release','order',NEW.order_id::text,'pending','available','ok','release:'||NEW.order_id);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payouts_to_ledger AFTER INSERT OR UPDATE OF status ON public.payouts FOR EACH ROW EXECUTE FUNCTION public.ledger_from_payout();

-- Backfill from real existing payouts
INSERT INTO public.ledger_entries(store_id, order_id, kind, gross_aoa, commission_aoa, net_aoa, delta_pending, origin, event_ref, idempotency_key, created_at)
SELECT store_id, order_id, 'sale_credit', COALESCE(gross_aoa,0), COALESCE(platform_fee_aoa,0), COALESCE(net_aoa,0), COALESCE(net_aoa,0), 'migration', 'payout:'||id, 'sale:'||order_id, created_at
FROM public.payouts WHERE store_id IS NOT NULL AND order_id IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO public.ledger_entries(store_id, order_id, kind, gross_aoa, commission_aoa, net_aoa, delta_pending, delta_available, origin, event_ref, idempotency_key, created_at)
SELECT store_id, order_id, 'release', COALESCE(gross_aoa,0), COALESCE(platform_fee_aoa,0), COALESCE(net_aoa,0), -COALESCE(net_aoa,0), COALESCE(net_aoa,0), 'migration', 'payout:'||id, 'release:'||order_id, COALESCE(released_at, created_at)
FROM public.payouts WHERE status='released' AND store_id IS NOT NULL AND order_id IS NOT NULL ON CONFLICT DO NOTHING;

-- Summary RPC
CREATE OR REPLACE FUNCTION public.store_ledger_summary(_store_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_sales numeric; v_comm numeric; v_withdrawn numeric;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'not_authorized'; END IF;
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  SELECT COALESCE(SUM(gross_aoa),0), COALESCE(SUM(commission_aoa),0) INTO v_sales, v_comm FROM public.ledger_entries WHERE store_id=_store_id AND kind='sale_credit';
  SELECT COALESCE(SUM(net_aoa),0) INTO v_withdrawn FROM public.ledger_entries WHERE store_id=_store_id AND kind='withdrawal_paid';
  RETURN jsonb_build_object('available_aoa', b.available, 'pending_aoa', b.pending, 'reserved_aoa', b.reserved,
    'sales_aoa', v_sales, 'commissions_aoa', v_comm, 'withdrawn_aoa', v_withdrawn, 'min_withdrawal_aoa', 50000);
END $$;
REVOKE EXECUTE ON FUNCTION public.store_ledger_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_ledger_summary(uuid) TO authenticated;

-- Request withdrawal (atomic, locked)
CREATE OR REPLACE FUNCTION public.request_store_withdrawal(_store_id uuid, _amount numeric) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; b record; v_id uuid; v_amt numeric := ROUND(_amount, 2);
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:not_owner',NULL);
    RAISE EXCEPTION 'not_authorized';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('ledger:'||_store_id::text));
  SELECT * INTO b FROM public.ledger_balances(_store_id);
  IF v_amt IS NULL OR v_amt < 50000 THEN
    PERFORM public.fin_audit('withdrawal_request','store',_store_id::text,NULL,NULL,'rejected:below_minimum',NULL, jsonb_build_object('amount',v_amt));
    RETURN jsonb_build_object('ok',false,'reason','below_minimum');
  END IF;
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
REVOKE EXECUTE ON FUNCTION public.request_store_withdrawal(uuid,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_store_withdrawal(uuid,numeric) TO authenticated;

-- Admin action (segregated: admin cannot act on own store)
CREATE OR REPLACE FUNCTION public.admin_withdrawal_action(_id uuid, _action text, _bank_reference text DEFAULT NULL, _proof_path text DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF v_new='PAID' AND coalesce(trim(_bank_reference),'') = '' THEN RAISE EXCEPTION 'bank_reference_required'; END IF;
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

  IF v_new='PAID' THEN
    INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_reserved, origin, event_ref, idempotency_key, created_by)
    VALUES (w.store_id, w.id, 'withdrawal_paid', w.amount_aoa, -w.amount_aoa, 'bank_transfer', _bank_reference, 'wd_paid:'||w.id, auth.uid());
  ELSIF v_new='REJECTED' THEN
    INSERT INTO public.ledger_entries(store_id, withdrawal_id, kind, net_aoa, delta_available, delta_reserved, origin, event_ref, idempotency_key, created_by)
    VALUES (w.store_id, w.id, 'withdrawal_release', w.amount_aoa, w.amount_aoa, -w.amount_aoa, 'withdrawal_rejected', 'withdrawal:'||w.id, 'wd_release:'||w.id, auth.uid());
  END IF;
  PERFORM public.fin_audit('withdrawal_'||_action,'withdrawal',_id::text,w.status,v_new,'ok','withdrawal:'||w.id,
    jsonb_build_object('bank_reference',_bank_reference,'proof',_proof_path,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'status',v_new);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_action(uuid,text,text,text,text) TO authenticated;
