REVOKE ALL ON FUNCTION public.fiscal_snapshot_platform() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_snapshot_store(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscal_snapshot_customer(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_invoice_fiscal_immutable() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_platform() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_store(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_customer(uuid) TO service_role;