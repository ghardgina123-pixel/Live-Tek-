REVOKE ALL ON FUNCTION public.store_follower_count(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.store_follower_count(uuid) TO service_role;