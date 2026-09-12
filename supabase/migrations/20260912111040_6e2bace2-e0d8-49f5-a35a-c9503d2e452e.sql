REVOKE SELECT ON public.profile_public_data FROM anon;
GRANT SELECT (id, display_name, avatar_url) ON public.profile_public_data TO anon;
GRANT SELECT ON public.profile_public_data TO authenticated;