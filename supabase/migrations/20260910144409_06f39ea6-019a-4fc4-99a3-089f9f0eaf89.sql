
-- 1) Estado fiscal e campos do documento emitido manualmente no Portal da AGT
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS fiscal_state text NOT NULL DEFAULT 'pending_issue',
  ADD COLUMN IF NOT EXISTS agt_number text,
  ADD COLUMN IF NOT EXISTS agt_series text,
  ADD COLUMN IF NOT EXISTS agt_issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS agt_total_aoa numeric,
  ADD COLUMN IF NOT EXISTS agt_pdf_path text,
  ADD COLUMN IF NOT EXISTS agt_registered_by uuid,
  ADD COLUMN IF NOT EXISTS agt_registered_at timestamptz;

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_fiscal_state_chk;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_fiscal_state_chk
  CHECK (fiscal_state IN ('pending_issue', 'externally_issued'));

COMMENT ON COLUMN public.invoices.fiscal_state IS
  'pending_issue = documento interno, ainda não emitido fiscalmente; externally_issued = factura real emitida fora (Portal da AGT pelo emissor) e aqui apenas registada.';
COMMENT ON COLUMN public.invoices.agt_pdf_path IS 'Caminho no bucket privado fiscal-documents. Nunca URL assinada.';

-- Documentos de venda do lojista: são sempre externos (o lojista emite, nós registamos)
UPDATE public.invoices SET fiscal_state = 'externally_issued'
 WHERE doc_kind = 'sale' AND fiscal_state <> 'externally_issued';

CREATE INDEX IF NOT EXISTS invoices_fiscal_state_idx ON public.invoices (issuer_kind, fiscal_state);

-- 2) Nenhuma factura da plataforma pode nascer marcada como emitida
CREATE OR REPLACE FUNCTION public.enforce_invoice_fiscal_state_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.issuer_kind = 'platform' THEN
    NEW.fiscal_state := 'pending_issue';
    NEW.agt_number := NULL; NEW.agt_series := NULL; NEW.agt_issued_at := NULL;
    NEW.agt_total_aoa := NULL; NEW.agt_pdf_path := NULL;
    NEW.agt_registered_by := NULL; NEW.agt_registered_at := NULL;
  ELSE
    NEW.fiscal_state := 'externally_issued';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoices_fiscal_state_insert ON public.invoices;
CREATE TRIGGER trg_invoices_fiscal_state_insert
BEFORE INSERT ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_fiscal_state_insert();

-- 3) Imutabilidade: o registo externo só acontece uma vez e nunca é revertido
CREATE OR REPLACE FUNCTION public.guard_invoice_fiscal_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.issuer_kind IS DISTINCT FROM OLD.issuer_kind
     OR NEW.doc_kind IS DISTINCT FROM OLD.doc_kind
     OR NEW.series IS DISTINCT FROM OLD.series
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.full_number IS DISTINCT FROM OLD.full_number
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.subtotal_aoa IS DISTINCT FROM OLD.subtotal_aoa
     OR NEW.tax_aoa IS DISTINCT FROM OLD.tax_aoa
     OR NEW.total_aoa IS DISTINCT FROM OLD.total_aoa
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot
     OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
  THEN
    RAISE EXCEPTION 'invoice_fiscal_data_immutable';
  END IF;

  IF OLD.pdf_path IS NOT NULL AND NEW.pdf_path IS DISTINCT FROM OLD.pdf_path THEN
    RAISE EXCEPTION 'invoice_pdf_immutable';
  END IF;
  IF OLD.pdf_generated_at IS NOT NULL AND NEW.pdf_generated_at IS DISTINCT FROM OLD.pdf_generated_at THEN
    RAISE EXCEPTION 'invoice_pdf_immutable';
  END IF;

  -- Estado fiscal só avança de pendente para emitido externamente
  IF OLD.fiscal_state = 'externally_issued' AND NEW.fiscal_state IS DISTINCT FROM OLD.fiscal_state THEN
    RAISE EXCEPTION 'invoice_fiscal_state_immutable';
  END IF;

  -- Dados da factura externa não podem ser substituídos nem apagados
  IF (OLD.agt_number IS NOT NULL AND NEW.agt_number IS DISTINCT FROM OLD.agt_number)
     OR (OLD.agt_series IS NOT NULL AND NEW.agt_series IS DISTINCT FROM OLD.agt_series)
     OR (OLD.agt_issued_at IS NOT NULL AND NEW.agt_issued_at IS DISTINCT FROM OLD.agt_issued_at)
     OR (OLD.agt_total_aoa IS NOT NULL AND NEW.agt_total_aoa IS DISTINCT FROM OLD.agt_total_aoa)
     OR (OLD.agt_pdf_path IS NOT NULL AND NEW.agt_pdf_path IS DISTINCT FROM OLD.agt_pdf_path)
     OR (OLD.agt_registered_at IS NOT NULL AND NEW.agt_registered_at IS DISTINCT FROM OLD.agt_registered_at)
  THEN
    RAISE EXCEPTION 'invoice_external_registration_immutable';
  END IF;

  RETURN NEW;
END; $$;

-- 4) Registo do documento realmente emitido no Portal da AGT (apenas gestor)
CREATE OR REPLACE FUNCTION public.admin_register_external_invoice(
  _invoice_id uuid,
  _number text,
  _series text,
  _issued_at timestamptz,
  _total_aoa numeric,
  _pdf_path text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_inv record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF _number IS NULL OR btrim(_number) = '' THEN RAISE EXCEPTION 'invalid_document_number'; END IF;
  IF _series IS NULL OR btrim(_series) = '' THEN RAISE EXCEPTION 'invalid_document_series'; END IF;
  IF _issued_at IS NULL THEN RAISE EXCEPTION 'invalid_issue_date'; END IF;
  IF _total_aoa IS NULL OR _total_aoa < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  SELECT * INTO v_inv FROM public.invoices WHERE id = _invoice_id;
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

  RETURN _invoice_id;
END; $$;

REVOKE ALL ON FUNCTION public.admin_register_external_invoice(uuid, text, text, timestamptz, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_register_external_invoice(uuid, text, text, timestamptz, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_invoice_fiscal_state_insert() FROM PUBLIC, anon, authenticated;

-- 5) Listagem para o gestor: documentos da plataforma por estado fiscal
CREATE OR REPLACE FUNCTION public.admin_platform_fiscal_documents(_state text DEFAULT NULL, _limit int DEFAULT 100)
RETURNS TABLE (
  id uuid, doc_kind text, full_number text, series text, number bigint,
  store_id uuid, store_name text, order_id uuid, subscription_id uuid,
  total_aoa numeric, currency_code text, issued_at timestamptz,
  fiscal_state text, agt_number text, agt_series text, agt_issued_at timestamptz,
  agt_total_aoa numeric, agt_pdf_path text, agt_registered_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT i.id, i.doc_kind, i.full_number, i.series, i.number,
         i.store_id, s.name, i.order_id, i.subscription_id,
         i.total_aoa, i.currency_code, i.issued_at,
         i.fiscal_state, i.agt_number, i.agt_series, i.agt_issued_at,
         i.agt_total_aoa, i.agt_pdf_path, i.agt_registered_at
    FROM public.invoices i
    LEFT JOIN public.stores s ON s.id = i.store_id
   WHERE public.has_role(auth.uid(), 'admin')
     AND i.issuer_kind = 'platform'
     AND (_state IS NULL OR i.fiscal_state = _state)
   ORDER BY i.issued_at DESC
   LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
$$;

REVOKE ALL ON FUNCTION public.admin_platform_fiscal_documents(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_platform_fiscal_documents(text, int) TO authenticated, service_role;
