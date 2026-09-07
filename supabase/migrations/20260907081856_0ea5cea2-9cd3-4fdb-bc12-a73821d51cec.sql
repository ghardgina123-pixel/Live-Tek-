-- ============ Fase 2: separação venda do lojista vs documentos TUSSALA KAKA ============

-- 1) Séries adicionais
INSERT INTO public.invoice_series (code, prefix, issuer_kind, doc_kind, next_number)
VALUES ('VD', 'VD', 'store', 'sale', 1),
       ('COM', 'COM', 'platform', 'commission', 1)
ON CONFLICT (code) DO NOTHING;

-- 2) Helper: próximo número da série (atómico)
CREATE OR REPLACE FUNCTION public.next_invoice_number(_code text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_n bigint;
BEGIN
  UPDATE public.invoice_series
     SET next_number = next_number + 1, updated_at = now()
   WHERE code = _code AND is_active
  RETURNING next_number - 1 INTO v_n;
  IF v_n IS NULL THEN RAISE EXCEPTION 'invoice_series_not_found:%', _code; END IF;
  RETURN v_n;
END; $$;
REVOKE ALL ON FUNCTION public.next_invoice_number(text) FROM PUBLIC, anon;

-- 3) Documento de venda do lojista associado ao pedido (Live Teká não é emissor)
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS sale_document_number text,
  ADD COLUMN IF NOT EXISTS sale_document_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS sale_document_url text;

CREATE OR REPLACE FUNCTION public.store_register_sale_document(
  _order_id uuid, _number text, _issued_at timestamptz DEFAULT now(), _url text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order record; v_store record; v_owner uuid; v_seq bigint; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _number IS NULL OR btrim(_number) = '' THEN RAISE EXCEPTION 'invalid_document_number'; END IF;

  SELECT o.* INTO v_order FROM public.orders o WHERE o.id = _order_id;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  SELECT s.id, s.name, s.phone, s.owner_id, sp.nif INTO v_store
    FROM public.stores s LEFT JOIN public.store_private sp ON sp.store_id = s.id
   WHERE s.id = v_order.store_id;
  v_owner := v_store.owner_id;

  IF v_owner IS DISTINCT FROM auth.uid() AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  UPDATE public.orders
     SET sale_document_number = btrim(_number),
         sale_document_issued_at = COALESCE(_issued_at, now()),
         sale_document_url = _url
   WHERE id = _order_id;

  SELECT id INTO v_id FROM public.invoices
   WHERE order_id = _order_id AND issuer_kind = 'store' AND doc_kind = 'sale';

  IF v_id IS NOT NULL THEN
    UPDATE public.invoices
       SET reference = btrim(_number),
           issued_at = COALESCE(_issued_at, now()),
           subtotal_aoa = COALESCE(v_order.subtotal_aoa, 0),
           total_aoa = COALESCE(v_order.total_aoa, 0),
           updated_at = now()
     WHERE id = v_id;
    RETURN v_id;
  END IF;

  v_seq := public.next_invoice_number('VD');
  INSERT INTO public.invoices (
    issuer_kind, doc_kind, series, number, full_number, store_id, order_id,
    issuer_snapshot, customer_snapshot, subtotal_aoa, total_aoa,
    payment_method, reference, status, issued_at
  ) VALUES (
    'store', 'sale', 'VD', v_seq, 'VD-' || to_char(now(), 'YYYY') || '/' || lpad(v_seq::text, 6, '0'),
    v_order.store_id, _order_id,
    jsonb_build_object('kind', 'store', 'store_id', v_store.id, 'store_name', v_store.name,
                       'nif', v_store.nif, 'phone', v_store.phone),
    jsonb_build_object('customer_id', v_order.customer_id),
    COALESCE(v_order.subtotal_aoa, 0), COALESCE(v_order.total_aoa, 0),
    v_order.payment_method, btrim(_number), 'issued', COALESCE(_issued_at, now())
  ) RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_aoa, total_aoa)
  VALUES (v_id, 'Venda — pedido ' || left(_order_id::text, 8), 1,
          COALESCE(v_order.total_aoa, 0), COALESCE(v_order.total_aoa, 0));

  RETURN v_id;
END; $$;
REVOKE ALL ON FUNCTION public.store_register_sale_document(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_register_sale_document(uuid, text, timestamptz, text) TO authenticated;

-- 4) Factura de comissão TUSSALA KAKA → lojista (apenas retalho, 5% sobre subtotal)
CREATE OR REPLACE FUNCTION public.create_commission_invoice_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_split jsonb; v_store record; v_seq bigint; v_id uuid; v_fee numeric; v_pct numeric;
BEGIN
  IF NEW.status <> 'paid'::order_status OR OLD.status = 'paid'::order_status THEN
    RETURN NEW;
  END IF;

  v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.subtotal_aoa, 0));
  v_pct := (v_split->>'commission_pct')::numeric;
  v_fee := (v_split->>'platform_fee_aoa')::numeric;

  -- 0% (prestadores de serviços) => sem factura de comissão (a subscrição mantém-se)
  IF COALESCE(v_pct, 0) <= 0 OR COALESCE(v_fee, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoices
              WHERE order_id = NEW.id AND issuer_kind = 'platform' AND doc_kind = 'commission') THEN
    RETURN NEW;
  END IF;

  SELECT s.id, s.name, s.phone, s.owner_id, sp.nif INTO v_store
    FROM public.stores s LEFT JOIN public.store_private sp ON sp.store_id = s.id
   WHERE s.id = NEW.store_id;

  v_seq := public.next_invoice_number('COM');
  INSERT INTO public.invoices (
    issuer_kind, doc_kind, series, number, full_number, store_id, order_id,
    issuer_snapshot, customer_snapshot, subtotal_aoa, total_aoa,
    payment_method, reference, status, issued_at
  ) VALUES (
    'platform', 'commission', 'COM', v_seq,
    'COM-' || to_char(now(), 'YYYY') || '/' || lpad(v_seq::text, 6, '0'),
    NEW.store_id, NEW.id,
    jsonb_build_object('kind', 'platform', 'name', 'TUSSALA KAKA'),
    jsonb_build_object('store_id', v_store.id, 'store_name', v_store.name,
                       'nif', v_store.nif, 'phone', v_store.phone, 'owner_id', v_store.owner_id),
    v_fee, v_fee, NEW.payment_method, left(NEW.id::text, 8), 'issued', now()
  ) RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_aoa, total_aoa)
  VALUES (v_id,
          'Comissão de intermediação ' || v_pct::text || '% sobre produtos (pedido '
            || left(NEW.id::text, 8) || ', subtotal ' || to_char(COALESCE(NEW.subtotal_aoa,0), 'FM999G999G990D00') || ' Kz)',
          1, v_fee, v_fee);

  IF v_store.owner_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (v_store.owner_id, 'invoice.commission', 'Factura de comissão emitida',
            'Comissão de ' || to_char(v_fee, 'FM999G999G990D00') || ' Kz sobre o pedido '
              || left(NEW.id::text, 8) || '.',
            '/lojista/pedidos', NEW.id);
  END IF;

  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_commission_invoice_on_paid ON public.orders;
CREATE TRIGGER trg_commission_invoice_on_paid
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.create_commission_invoice_on_paid();
