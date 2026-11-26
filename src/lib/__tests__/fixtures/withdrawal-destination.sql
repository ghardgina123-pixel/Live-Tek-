-- LOCAL ONLY: representative dependency schema; functions below are captured from the live database.
CREATE SCHEMA auth;
CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon,service_role;
CREATE TYPE public.app_role AS ENUM ('customer','seller','admin');
CREATE TYPE public.courier_status AS ENUM ('pending','active','rejected','suspended');
CREATE TYPE public.courier_type AS ENUM ('motoboy','carro','van','empresa');
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
CREATE FUNCTION public.has_role(_uid uuid,_role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role=_role) $$;
CREATE TABLE public.stores(id uuid PRIMARY KEY,owner_id uuid NOT NULL);
CREATE TABLE public.customer_fiscal_profiles(user_id uuid PRIMARY KEY,legal_name text,bi_normalized text,identity_locked_at timestamptz,identity_conflict boolean DEFAULT false);
CREATE TABLE public.store_private(store_id uuid PRIMARY KEY,nif text,bank_name text,bank_account text,bank_holder text,legal_name text);
CREATE TABLE public.user_payment_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,method_type text NOT NULL,account_holder text,account_number text,iban text,bank_name text,is_default boolean DEFAULT false,updated_at timestamptz DEFAULT now());
CREATE TABLE public.affiliate_accounts(id uuid PRIMARY KEY,user_id uuid NOT NULL,is_active boolean DEFAULT true);
CREATE TABLE public.affiliate_commissions(id uuid DEFAULT gen_random_uuid(),affiliate_id uuid,amount_aoa numeric,status text);
CREATE TABLE public.couriers(id uuid PRIMARY KEY,user_id uuid,courier_type public.courier_type DEFAULT 'motoboy',status public.courier_status DEFAULT 'active');
CREATE TABLE public.orders(id uuid PRIMARY KEY,shipping_aoa numeric);
CREATE TABLE public.deliveries(id uuid PRIMARY KEY,courier_id uuid,order_id uuid,status text);
CREATE TABLE public.withdrawal_limits(currency text PRIMARY KEY,max_daily_amount numeric,timezone text DEFAULT 'Africa/Luanda',min_amount numeric DEFAULT 10000);
CREATE TABLE public.financial_settings(min_withdrawal_aoa numeric);
INSERT INTO public.withdrawal_limits(currency,max_daily_amount,min_amount) VALUES('AOA',200000,10000);
CREATE TABLE public.payout_requests(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('affiliate','courier')),amount_aoa numeric NOT NULL CHECK(amount_aoa>0),method text NOT NULL DEFAULT 'multicaixa_express',destination jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'pending' CONSTRAINT payout_requests_status_check CHECK(status IN ('pending','processing','paid','cancelled')),due_at timestamptz NOT NULL DEFAULT now()+interval '72 hours',processed_at timestamptz,note text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.store_withdrawals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),store_id uuid NOT NULL,requested_by uuid NOT NULL,amount_aoa numeric NOT NULL CHECK(amount_aoa>0),status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(status IN ('PENDING_REVIEW','APPROVED','PROCESSING','PAID','REJECTED')),destination jsonb,reviewed_by uuid,reviewed_at timestamptz,processed_by uuid,processed_at timestamptz,paid_by uuid,paid_at timestamptz,bank_reference text,proof_path text,rejection_reason text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.ledger_entries(id uuid DEFAULT gen_random_uuid(),store_id uuid,withdrawal_id uuid,kind text,net_aoa numeric DEFAULT 0,delta_available numeric DEFAULT 0,delta_pending numeric DEFAULT 0,delta_reserved numeric DEFAULT 0,origin text,event_ref text,idempotency_key text UNIQUE,created_by uuid,created_at timestamptz DEFAULT now());
CREATE TABLE public.financial_audit_log(actor_id uuid,action text,resource text,resource_id text,previous_state text,new_state text,result text,operation_id text,metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
CREATE TABLE public.user_notifications(user_id uuid,kind text,title text,body text,url text,ref_id uuid);
CREATE TABLE public.admin_notifications(kind text,subject text,payload jsonb);
GRANT SELECT ON public.store_withdrawals,public.payout_requests TO authenticated;
ALTER TABLE public.store_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY withdrawals_select_owner_admin ON public.store_withdrawals FOR SELECT TO authenticated USING(public.has_role(auth.uid(),'admin') OR EXISTS(SELECT 1 FROM public.stores s WHERE s.id=store_withdrawals.store_id AND s.owner_id=auth.uid()));
CREATE POLICY "own payout requests" ON public.payout_requests FOR SELECT TO authenticated USING(user_id=auth.uid() OR public.has_role(auth.uid(),'admin'));
GRANT SELECT ON public.stores TO authenticated;

CREATE OR REPLACE FUNCTION public.ledger_balances(_store_id uuid)
 RETURNS TABLE(pending numeric, available numeric, reserved numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(delta_pending),0), COALESCE(SUM(delta_available),0), COALESCE(SUM(delta_reserved),0)
  FROM public.ledger_entries WHERE store_id = _store_id
$function$
;

CREATE OR REPLACE FUNCTION public.fin_audit(_action text, _resource text, _rid text, _prev text, _new text, _result text, _op text, _meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  INSERT INTO public.financial_audit_log(actor_id, action, resource, resource_id, previous_state, new_state, result, operation_id, metadata)
  VALUES (auth.uid(), _action, _resource, _rid, _prev, _new, _result, _op, COALESCE(_meta,'{}'::jsonb))
$function$
;

CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT min_amount FROM public.withdrawal_limits WHERE currency = 'AOA'),
    (SELECT min_withdrawal_aoa FROM public.financial_settings LIMIT 1),
    10000)
$function$
;

CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa()
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT max_daily_amount FROM public.withdrawal_limits WHERE currency = 'AOA'
$function$
;

CREATE OR REPLACE FUNCTION public.withdrawal_day_start(_currency text DEFAULT 'AOA'::text)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (date_trunc('day', now() AT TIME ZONE COALESCE((SELECT timezone FROM public.withdrawal_limits WHERE currency=_currency),'Africa/Luanda')))
         AT TIME ZONE COALESCE((SELECT timezone FROM public.withdrawal_limits WHERE currency=_currency),'Africa/Luanda')
$function$
;

CREATE OR REPLACE FUNCTION public.store_withdrawn_today(_store_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(amount_aoa),0) FROM public.store_withdrawals
  WHERE store_id = _store_id AND status <> 'REJECTED' AND created_at >= public.withdrawal_day_start('AOA')
$function$
;

CREATE OR REPLACE FUNCTION public.payout_withdrawn_today(_user_id uuid, _kind text)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(amount_aoa),0) FROM public.payout_requests
  WHERE user_id = _user_id AND kind = _kind AND status <> 'cancelled' AND created_at >= public.withdrawal_day_start('AOA')
$function$
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
END $function$
;

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
END $function$
;

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
END $function$
;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid, _status text DEFAULT 'paid'::text, _note text DEFAULT NULL::text, _bank_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.guard_withdrawal_transition()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
END $function$
;
CREATE TRIGGER withdrawals_transition BEFORE UPDATE ON public.store_withdrawals FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_transition();
