-- Restrict invoice line items to the same principals who may read the parent invoice.
DROP POLICY IF EXISTS "invoice_items_read_via_invoice" ON public.invoice_items;
CREATE POLICY "invoice_items_read_via_owned_invoice"
ON public.invoice_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.invoices i
    WHERE i.id = invoice_items.invoice_id
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR (
          i.store_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.stores s
            WHERE s.id = i.store_id AND s.owner_id = auth.uid()
          )
        )
        OR (
          i.order_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM public.orders o
            WHERE o.id = i.order_id AND o.customer_id = auth.uid()
          )
        )
      )
  )
);

-- Materialize only non-sensitive profile fields for genuinely public lookups.
CREATE TABLE public.profile_public_data (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text,
  avatar_url text,
  is_online boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz
);
GRANT SELECT ON public.profile_public_data TO anon, authenticated;
GRANT ALL ON public.profile_public_data TO service_role;
ALTER TABLE public.profile_public_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_public_data_read"
ON public.profile_public_data
FOR SELECT
TO anon, authenticated
USING (true);

INSERT INTO public.profile_public_data (id, display_name, avatar_url, is_online, last_seen_at)
SELECT id, display_name, avatar_url, is_online, last_seen_at
FROM public.profiles
ON CONFLICT (id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  avatar_url = EXCLUDED.avatar_url,
  is_online = EXCLUDED.is_online,
  last_seen_at = EXCLUDED.last_seen_at;

CREATE OR REPLACE FUNCTION public.sync_profile_public_data()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.profile_public_data WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO public.profile_public_data (id, display_name, avatar_url, is_online, last_seen_at)
  VALUES (NEW.id, NEW.display_name, NEW.avatar_url, NEW.is_online, NEW.last_seen_at)
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    is_online = EXCLUDED.is_online,
    last_seen_at = EXCLUDED.last_seen_at;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_profile_public_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_public_data() TO service_role;

CREATE TRIGGER profiles_sync_public_data
AFTER INSERT OR UPDATE OF display_name, avatar_url, is_online, last_seen_at OR DELETE
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.sync_profile_public_data();

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true, security_invoker = true)
AS
SELECT id, display_name, avatar_url, is_online, last_seen_at
FROM public.profile_public_data;
REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
GRANT ALL ON public.public_profiles TO service_role;

-- The private profile table is no longer globally readable.
DROP POLICY IF EXISTS "profiles_select_public" ON public.profiles;
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (id, display_name, avatar_url, created_at, updated_at, country_code, is_online, last_seen_at, country_id, partner_type, language_code)
ON public.profiles TO authenticated;