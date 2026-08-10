-- ============================================================
-- Least privilege: revoke blanket grants, re-grant per policy
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
  LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ---------- anon: read-only public catalogue ----------
GRANT SELECT ON
  public.countries, public.provinces, public.municipalities, public.districts,
  public.exchange_rates, public.payment_methods, public.subscription_plans,
  public.stores, public.products, public.product_videos,
  public.properties, public.property_images,
  public.lives, public.live_products, public.global_notifications
TO anon;

-- ---------- authenticated: derived from existing RLS policies ----------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.addresses TO authenticated;
GRANT SELECT ON public.admin_notifications TO authenticated;
GRANT SELECT, INSERT ON public.affiliate_accounts TO authenticated;
GRANT SELECT ON public.affiliate_commissions TO authenticated;
GRANT SELECT ON public.affiliate_referrals TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.agency_live_fees TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.conversations TO authenticated;
GRANT SELECT ON public.countries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.couriers TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.deliveries TO authenticated;
GRANT SELECT, INSERT ON public.delivery_tracking TO authenticated;
GRANT SELECT ON public.districts TO authenticated;
GRANT SELECT ON public.exchange_rates TO authenticated;
GRANT SELECT ON public.global_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_cameras TO authenticated;
GRANT SELECT, INSERT ON public.live_events TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.live_likes TO authenticated;
GRANT SELECT, INSERT ON public.live_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.live_viewers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lives TO authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT SELECT ON public.municipalities TO authenticated;
GRANT SELECT, INSERT ON public.order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.orders TO authenticated;
GRANT SELECT, INSERT ON public.payment_intents TO authenticated;
GRANT SELECT ON public.payment_methods TO authenticated;
GRANT SELECT, UPDATE ON public.payout_requests TO authenticated;
GRANT SELECT ON public.payouts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.product_videos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_images TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.property_visit_requests TO authenticated;
GRANT SELECT ON public.provinces TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.real_estate_agencies TO authenticated;
GRANT SELECT ON public.security_audit_log TO authenticated;
GRANT SELECT ON public.security_config_snapshots TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.short_comments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.short_likes TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.store_private TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.store_subscriptions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.stores TO authenticated;
GRANT SELECT ON public.subscription_history TO authenticated;
GRANT SELECT ON public.subscription_invoices TO authenticated;
GRANT SELECT ON public.subscription_logs TO authenticated;
GRANT SELECT ON public.subscription_notifications TO authenticated;
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.user_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_payment_accounts TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;

-- email/security internals stay service_role only:
-- email_send_log, email_send_state, email_unsubscribe_tokens,
-- suppressed_emails, login_attempts, payouts writes, subscription_* writes.

-- ---------- public profile projection (no phone / country / language) ----------
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_invoker = off) AS
  SELECT id, display_name, avatar_url, is_online, last_seen_at
  FROM public.profiles;

GRANT SELECT ON public.public_profiles TO anon, authenticated;
