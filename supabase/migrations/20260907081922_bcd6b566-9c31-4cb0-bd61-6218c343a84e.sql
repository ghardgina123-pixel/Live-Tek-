REVOKE ALL ON FUNCTION public.create_commission_invoice_on_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.next_invoice_number(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_commission_invoice_on_paid() TO service_role;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(text) TO service_role;