CREATE TABLE public.payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('affiliate','courier')),
  amount_aoa numeric(14,2) NOT NULL CHECK (amount_aoa > 0),
  method text NOT NULL DEFAULT 'multicaixa_express',
  destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','paid','cancelled')),
  due_at timestamptz NOT NULL DEFAULT now() + interval '72 hours',
  processed_at timestamptz,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_payout_requests_user ON public.payout_requests(user_id, kind, created_at DESC);
CREATE UNIQUE INDEX uniq_payout_open ON public.payout_requests(user_id, kind) WHERE status IN ('pending','processing');

GRANT SELECT ON public.payout_requests TO authenticated;
GRANT ALL ON public.payout_requests TO service_role;

ALTER TABLE public.payout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own payout requests" ON public.payout_requests
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admin update payout requests" ON public.payout_requests
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_payout_requests_updated
  BEFORE UPDATE ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Saldo do afiliado disponível para saque
CREATE OR REPLACE FUNCTION public.affiliate_withdrawable()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_aff uuid; v_released numeric := 0; v_requested numeric := 0; v_open record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_aff FROM public.affiliate_accounts WHERE user_id = v_uid;
  IF v_aff IS NOT NULL THEN
    SELECT COALESCE(SUM(amount_aoa),0) INTO v_released
      FROM public.affiliate_commissions WHERE affiliate_id = v_aff AND status IN ('released','paid');
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'affiliate' AND status <> 'cancelled';
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'affiliate' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'available_aoa', GREATEST(ROUND(v_released - v_requested, 2), 0),
    'min_aoa', 50000,
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END; $$;

-- Saldo do entregador: taxas de entrega de encomendas entregues
CREATE OR REPLACE FUNCTION public.courier_withdrawable()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_courier uuid; v_earned numeric := 0; v_requested numeric := 0;
        v_deliveries int := 0; v_open record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_courier FROM public.couriers WHERE user_id = v_uid;
  IF v_courier IS NOT NULL THEN
    SELECT COALESCE(SUM(o.shipping_aoa),0), COUNT(*)
      INTO v_earned, v_deliveries
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
     WHERE d.courier_id = v_courier AND d.status = 'delivered';
  END IF;
  SELECT COALESCE(SUM(amount_aoa),0) INTO v_requested
    FROM public.payout_requests WHERE user_id = v_uid AND kind = 'courier' AND status <> 'cancelled';
  SELECT * INTO v_open FROM public.payout_requests
    WHERE user_id = v_uid AND kind = 'courier' AND status IN ('pending','processing')
    ORDER BY created_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'is_courier', v_courier IS NOT NULL,
    'deliveries_done', v_deliveries,
    'earned_aoa', ROUND(v_earned, 2),
    'withdrawn_aoa', ROUND(v_requested, 2),
    'available_aoa', GREATEST(ROUND(v_earned - v_requested, 2), 0),
    'min_aoa', 50000,
    'has_open_request', v_open.id IS NOT NULL,
    'open_request', CASE WHEN v_open.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_open.id, 'amount_aoa', v_open.amount_aoa, 'status', v_open.status,
      'due_at', v_open.due_at, 'created_at', v_open.created_at) END
  );
END; $$;

-- Pedido de saque autónomo
CREATE OR REPLACE FUNCTION public.request_payout(_kind text, _method text DEFAULT 'multicaixa_express', _destination jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_uid uuid := auth.uid(); v_state jsonb; v_available numeric; v_id uuid; v_due timestamptz;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _kind NOT IN ('affiliate','courier') THEN RAISE EXCEPTION 'invalid_kind'; END IF;

  v_state := CASE WHEN _kind = 'affiliate' THEN public.affiliate_withdrawable() ELSE public.courier_withdrawable() END;

  IF (v_state->>'has_open_request')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'open_request');
  END IF;

  v_available := COALESCE((v_state->>'available_aoa')::numeric, 0);
  IF v_available < 50000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'below_minimum', 'available_aoa', v_available);
  END IF;

  v_due := now() + interval '72 hours';

  INSERT INTO public.payout_requests (user_id, kind, amount_aoa, method, destination, due_at)
  VALUES (v_uid, _kind, v_available, COALESCE(NULLIF(_method,''), 'multicaixa_express'), COALESCE(_destination, '{}'::jsonb), v_due)
  RETURNING id INTO v_id;

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_uid, 'payout.requested', 'Pedido de levantamento registado',
          'Kz ' || to_char(v_available, 'FM999G999G999D00') || ' — processamento até ' || to_char(v_due, 'DD/MM/YYYY HH24:MI') || '.',
          CASE WHEN _kind = 'affiliate' THEN '/afiliados' ELSE '/transportador' END, v_id);

  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES ('payout.requested', 'Novo pedido de levantamento',
          jsonb_build_object('payout_id', v_id, 'user_id', v_uid, 'kind', _kind, 'amount_aoa', v_available, 'due_at', v_due));

  RETURN jsonb_build_object('ok', true, 'payout_id', v_id, 'amount_aoa', v_available, 'due_at', v_due, 'status', 'pending');
END; $$;

-- Administração marca como pago
CREATE OR REPLACE FUNCTION public.admin_settle_payout(_payout_id uuid, _status text DEFAULT 'paid', _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row record;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _status NOT IN ('processing','paid','cancelled') THEN RAISE EXCEPTION 'invalid_status'; END IF;
  UPDATE public.payout_requests
     SET status = _status, note = COALESCE(_note, note),
         processed_at = CASE WHEN _status IN ('paid','cancelled') THEN now() ELSE processed_at END,
         updated_at = now()
   WHERE id = _payout_id
   RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_row.user_id, 'payout.' || _status,
          CASE _status WHEN 'paid' THEN 'Levantamento pago' WHEN 'cancelled' THEN 'Levantamento cancelado' ELSE 'Levantamento em processamento' END,
          'Kz ' || to_char(v_row.amount_aoa, 'FM999G999G999D00'),
          CASE WHEN v_row.kind = 'affiliate' THEN '/afiliados' ELSE '/transportador' END, v_row.id);

  RETURN jsonb_build_object('ok', true, 'status', _status);
END; $$;

REVOKE EXECUTE ON FUNCTION public.affiliate_withdrawable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.courier_withdrawable() FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_payout(text, text, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_settle_payout(uuid, text, text) FROM anon;