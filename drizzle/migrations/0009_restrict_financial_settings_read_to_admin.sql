ALTER POLICY financial_settings_read
ON public.financial_settings
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));