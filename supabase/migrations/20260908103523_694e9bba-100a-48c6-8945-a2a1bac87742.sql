ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_path text,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

COMMENT ON COLUMN public.invoices.pdf_path IS 'Caminho do objecto no bucket privado fiscal-documents. Nunca guardar URLs assinadas.';

CREATE OR REPLACE FUNCTION public.guard_invoice_fiscal_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  -- PDF só pode ser definido uma vez: nunca substituído nem removido
  IF OLD.pdf_path IS NOT NULL AND NEW.pdf_path IS DISTINCT FROM OLD.pdf_path THEN
    RAISE EXCEPTION 'invoice_pdf_immutable';
  END IF;
  IF OLD.pdf_generated_at IS NOT NULL AND NEW.pdf_generated_at IS DISTINCT FROM OLD.pdf_generated_at THEN
    RAISE EXCEPTION 'invoice_pdf_immutable';
  END IF;

  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.guard_invoice_fiscal_immutable() FROM PUBLIC, anon, authenticated;

-- Nenhuma política de storage é criada para o bucket privado 'fiscal-documents':
-- sem políticas, anon e authenticated não têm qualquer acesso directo aos objectos.
-- O acesso é feito exclusivamente por URLs assinadas emitidas pelo servidor
-- depois de validar as permissões do utilizador sobre a factura.
