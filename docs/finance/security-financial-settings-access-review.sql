-- Review only: requires express approval before database application.
-- Scope: only financial_settings_read; preserve data, grants, financial RPCs,
-- withdrawal_limits and all other policies/findings.
-- No frontend reads this legacy table. min_withdrawal_aoa() remains a
-- SECURITY DEFINER function owned by postgres, so its existing read is preserved.
ALTER POLICY financial_settings_read
ON public.financial_settings
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::public.app_role));