DROP VIEW IF EXISTS public.public_profiles;

-- Anon vê apenas as colunas públicas do perfil (nunca phone/country/idioma).
REVOKE ALL ON public.profiles FROM anon;
GRANT SELECT (id, display_name, avatar_url, is_online, last_seen_at)
  ON public.profiles TO anon;
