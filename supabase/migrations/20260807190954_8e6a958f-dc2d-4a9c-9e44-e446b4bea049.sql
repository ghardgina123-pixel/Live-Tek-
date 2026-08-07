REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES ON public.profiles FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES ON public.profiles FROM authenticated;
GRANT INSERT (id, display_name, avatar_url, phone, country_id, country_code, language_code)
  ON public.profiles TO authenticated;
