-- 1. public_profiles: security invoker + column-scoped access on profiles
REVOKE ALL ON public.public_profiles FROM anon, authenticated;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
ALTER VIEW public.public_profiles SET (security_invoker = true);

REVOKE SELECT ON public.profiles FROM authenticated;
GRANT SELECT (id, display_name, avatar_url, is_online, last_seen_at, country_code, country_id, language_code, partner_type, created_at, updated_at) ON public.profiles TO authenticated;

DROP POLICY IF EXISTS profiles_select_public ON public.profiles;
CREATE POLICY profiles_select_public ON public.profiles
  FOR SELECT TO anon, authenticated
  USING (true);

-- 2. payment_intents: customer cannot choose status / verification fields
DROP POLICY IF EXISTS "customer creates intent" ON public.payment_intents;
CREATE POLICY "customer creates intent" ON public.payment_intents
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND verified_at IS NULL
    AND verified_source IS NULL
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = payment_intents.order_id AND o.customer_id = auth.uid()
    )
  );

-- 3. store_signup_fees: owner cannot self-approve on insert
DROP POLICY IF EXISTS ssf_owner_insert ON public.store_signup_fees;
CREATE POLICY ssf_owner_insert ON public.store_signup_fees
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.stores s
      WHERE s.id = store_signup_fees.store_id AND s.owner_id = auth.uid()
    )
  );