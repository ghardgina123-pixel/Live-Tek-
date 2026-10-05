REVOKE ALL ON public.financial_settings FROM anon, authenticated;
GRANT SELECT ON public.financial_settings TO authenticated;