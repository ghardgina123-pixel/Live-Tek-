REVOKE EXECUTE ON FUNCTION public.courier_open_deliveries() FROM anon;
REVOKE EXECUTE ON FUNCTION public.courier_my_deliveries() FROM anon;
REVOKE EXECUTE ON FUNCTION public.courier_accept_delivery(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.courier_delivery_detail(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.assign_delivery_courier(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_courier_on_assignment() FROM anon, PUBLIC;