REVOKE EXECUTE ON FUNCTION public.courier_update_location(numeric, numeric) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.courier_set_availability(boolean) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delivery_eligible_couriers(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.courier_open_deliveries() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_couriers_on_delivery() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.courier_update_location(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_set_availability(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delivery_eligible_couriers(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated;