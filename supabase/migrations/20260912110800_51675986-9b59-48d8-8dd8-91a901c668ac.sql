CREATE TABLE public.real_estate_agency_private (
  agency_id uuid PRIMARY KEY REFERENCES public.real_estate_agencies(id) ON DELETE CASCADE,
  nif text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.real_estate_agency_private TO authenticated;
GRANT ALL ON public.real_estate_agency_private TO service_role;

ALTER TABLE public.real_estate_agency_private ENABLE ROW LEVEL SECURITY;

CREATE POLICY agency_private_select_owner_admin ON public.real_estate_agency_private
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.real_estate_agencies a WHERE a.id = agency_id AND a.owner_id = auth.uid())
  );

CREATE POLICY agency_private_insert_owner ON public.real_estate_agency_private
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.real_estate_agencies a WHERE a.id = agency_id AND a.owner_id = auth.uid())
  );

CREATE POLICY agency_private_update_owner_admin ON public.real_estate_agency_private
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.real_estate_agencies a WHERE a.id = agency_id AND a.owner_id = auth.uid())
  );

CREATE TRIGGER trg_agency_private_updated_at
  BEFORE UPDATE ON public.real_estate_agency_private
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.real_estate_agency_private (agency_id, nif)
SELECT id, nif FROM public.real_estate_agencies WHERE nif IS NOT NULL
ON CONFLICT (agency_id) DO NOTHING;

ALTER TABLE public.real_estate_agencies DROP COLUMN nif;