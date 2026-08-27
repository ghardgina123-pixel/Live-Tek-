ALTER TABLE public.agency_live_fees
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verified_source TEXT;

-- Owners may only keep the fee pending; they can never move it to paid/approved.
ALTER POLICY agency_live_fees_update_owner_pending ON public.agency_live_fees
  USING (
    status = 'pending'::agency_live_fee_status
    AND EXISTS (SELECT 1 FROM public.real_estate_agencies a WHERE a.id = agency_live_fees.agency_id AND a.owner_id = auth.uid())
  )
  WITH CHECK (
    status = 'pending'::agency_live_fee_status
    AND EXISTS (SELECT 1 FROM public.real_estate_agencies a WHERE a.id = agency_live_fees.agency_id AND a.owner_id = auth.uid())
  );

-- Force every client-side insert to land as pending, unverified.
CREATE OR REPLACE FUNCTION public.enforce_agency_fee_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    NEW.status := 'pending'::agency_live_fee_status;
    NEW.approved_at := NULL;
    NEW.verified_at := NULL;
    NEW.verified_source := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_fee_insert_pending ON public.agency_live_fees;
CREATE TRIGGER trg_agency_fee_insert_pending
BEFORE INSERT ON public.agency_live_fees
FOR EACH ROW EXECUTE FUNCTION public.enforce_agency_fee_insert();

-- Only a trusted gateway source may mark the fee as paid.
CREATE OR REPLACE FUNCTION public.enforce_agency_fee_verification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'paid'::agency_live_fee_status
     AND OLD.status IS DISTINCT FROM 'paid'::agency_live_fee_status THEN
    IF NEW.verified_source IS NULL
       OR NOT public.is_trusted_payment_source(NEW.verified_source) THEN
      RAISE EXCEPTION 'agency live fee cannot be marked paid without verified gateway confirmation';
    END IF;
    NEW.verified_at := COALESCE(NEW.verified_at, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agency_fee_verification ON public.agency_live_fees;
CREATE TRIGGER trg_agency_fee_verification
BEFORE UPDATE ON public.agency_live_fees
FOR EACH ROW EXECUTE FUNCTION public.enforce_agency_fee_verification();

REVOKE ALL ON FUNCTION public.enforce_agency_fee_insert() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_agency_fee_verification() FROM anon, authenticated;