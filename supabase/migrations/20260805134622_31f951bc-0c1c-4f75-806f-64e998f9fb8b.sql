REVOKE EXECUTE ON FUNCTION public.store_subscription_status(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.store_subscription_status(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.can_store_go_live(uuid) FROM public;
REVOKE EXECUTE ON FUNCTION public.create_subscription_intent(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.store_subscription_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_store_go_live(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_subscription_intent(uuid, text, text) TO authenticated, service_role;