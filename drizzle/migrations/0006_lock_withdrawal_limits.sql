REVOKE ALL ON public.withdrawal_limits FROM anon, authenticated;
GRANT SELECT ON public.withdrawal_limits TO authenticated;