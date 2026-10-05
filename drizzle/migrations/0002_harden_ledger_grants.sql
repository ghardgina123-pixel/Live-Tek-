REVOKE ALL ON public.ledger_entries, public.store_withdrawals, public.financial_audit_log FROM anon, authenticated;
GRANT SELECT ON public.ledger_entries, public.store_withdrawals, public.financial_audit_log TO authenticated;
GRANT ALL ON public.ledger_entries, public.store_withdrawals, public.financial_audit_log TO service_role;
REVOKE EXECUTE ON FUNCTION public.guard_ledger_non_negative() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ledger_from_payout() FROM PUBLIC, anon, authenticated;