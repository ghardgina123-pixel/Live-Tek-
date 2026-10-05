CREATE TABLE IF NOT EXISTS public.financial_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  min_withdrawal_aoa numeric NOT NULL CHECK (min_withdrawal_aoa > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.financial_settings TO authenticated;
GRANT ALL ON public.financial_settings TO service_role;
ALTER TABLE public.financial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY financial_settings_read ON public.financial_settings FOR SELECT TO authenticated USING (true);
INSERT INTO public.financial_settings(id, min_withdrawal_aoa) VALUES (true, 200000)
  ON CONFLICT (id) DO UPDATE SET min_withdrawal_aoa = 200000, updated_at = now();

CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa() RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min_withdrawal_aoa FROM public.financial_settings WHERE id
$$;
REVOKE EXECUTE ON FUNCTION public.min_withdrawal_aoa() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.min_withdrawal_aoa() TO authenticated, service_role;

DO $$
DECLARE r record; d text;
BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p WHERE p.pronamespace='public'::regnamespace
    AND p.proname IN ('store_ledger_summary','request_store_withdrawal','request_payout','affiliate_withdrawable','courier_withdrawable')
  LOOP
    d := pg_get_functiondef(r.oid);
    IF d ~ '\m50000\M' THEN
      EXECUTE regexp_replace(d, '\m50000\M', 'public.min_withdrawal_aoa()', 'g');
    END IF;
  END LOOP;
END $$;