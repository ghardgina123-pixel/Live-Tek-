REVOKE ALL ON FUNCTION public.auto_create_delivery_on_paid() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_couriers_new_delivery() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_order_status_transition() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auto_create_delivery_on_paid() TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_couriers_new_delivery() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_order_status_transition() TO service_role;
REVOKE ALL ON FUNCTION public.seller_create_delivery(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.courier_delivery_detail(uuid) FROM anon;
