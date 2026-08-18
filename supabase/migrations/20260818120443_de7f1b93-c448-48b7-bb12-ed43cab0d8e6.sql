DROP POLICY IF EXISTS profiles_select_all ON public.profiles;

CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY profiles_delete_own ON public.profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true) AS
  SELECT id, display_name, avatar_url, is_online, last_seen_at
  FROM public.profiles;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon, authenticated;
GRANT ALL ON public.public_profiles TO service_role;

CREATE OR REPLACE FUNCTION public.admin_financial_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE res jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT jsonb_build_object(
    'orders_total', (SELECT count(*) FROM public.orders),
    'orders_paid', (SELECT count(*) FROM public.orders WHERE status <> 'pending' AND status <> 'cancelled'),
    'orders_pending', (SELECT count(*) FROM public.orders WHERE status = 'pending'),
    'orders_cancelled', (SELECT count(*) FROM public.orders WHERE status = 'cancelled'),
    'gross_aoa', COALESCE((SELECT sum(total_aoa) FROM public.orders WHERE paid_at IS NOT NULL), 0),
    'commission_aoa', COALESCE((SELECT sum(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100)
                                FROM public.orders o WHERE o.paid_at IS NOT NULL), 0),
    'net_sellers_aoa', COALESCE((SELECT sum(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100))
                                FROM public.orders o WHERE o.paid_at IS NOT NULL), 0),
    'signup_fees_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'paid'), 0),
    'signup_fees_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.store_signup_fees WHERE status = 'pending'), 0),
    'subscriptions_active', (SELECT count(*) FROM public.store_subscriptions WHERE status = 'active'),
    'subscriptions_paid_aoa', COALESCE((SELECT sum(price_aoa) FROM public.store_subscriptions WHERE status = 'active'), 0),
    'payouts_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status IN ('pending','processing')), 0),
    'payouts_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status = 'paid'), 0),
    'stores_total', (SELECT count(*) FROM public.stores),
    'stores_active', (SELECT count(*) FROM public.stores WHERE status = 'active')
  ) INTO res;
  RETURN res;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_financial_transactions(
  _status text DEFAULT NULL,
  _store_id uuid DEFAULT NULL,
  _method text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _limit int DEFAULT 100
)
RETURNS TABLE(
  id uuid, created_at timestamptz, paid_at timestamptz, status text,
  customer_name text, store_name text, store_id uuid,
  gross_aoa numeric, commission_aoa numeric, net_aoa numeric,
  payment_method text, reference text, items int
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT o.id, o.created_at, o.paid_at, o.status::text,
         COALESCE(p.display_name, 'Cliente'), s.name, s.id,
         o.total_aoa,
         round(o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100, 2),
         round(o.subtotal_aoa - (o.subtotal_aoa * public.store_commission_pct(o.store_id) / 100), 2),
         COALESCE(o.payment_method, '—'),
         (SELECT pi.reference FROM public.payment_intents pi WHERE pi.order_id = o.id ORDER BY pi.created_at DESC LIMIT 1),
         (SELECT count(*)::int FROM public.order_items oi WHERE oi.order_id = o.id)
  FROM public.orders o
  JOIN public.stores s ON s.id = o.store_id
  LEFT JOIN public.profiles p ON p.id = o.customer_id
  WHERE (_status IS NULL OR o.status::text = _status)
    AND (_store_id IS NULL OR o.store_id = _store_id)
    AND (_method IS NULL OR o.payment_method = _method)
    AND (_from IS NULL OR o.created_at >= _from)
    AND (_to IS NULL OR o.created_at <= _to)
  ORDER BY o.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 100), 500));
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_signup_fees()
RETURNS TABLE(
  id uuid, store_id uuid, store_name text, registration_index int,
  first_50 boolean, amount_aoa numeric, status text, method text,
  reference text, created_at timestamptz, reviewed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  WITH ranked AS (
    SELECT st.id, st.name, row_number() OVER (ORDER BY st.created_at)::int AS idx
    FROM public.stores st
  )
  SELECT f.id, f.store_id, r.name, r.idx, (r.idx <= 50),
         f.amount_aoa, f.status, f.method, f.reference, f.created_at, f.reviewed_at
  FROM public.store_signup_fees f
  JOIN ranked r ON r.id = f.store_id
  ORDER BY f.created_at DESC
  LIMIT 200;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_payout_requests()
RETURNS TABLE(
  id uuid, user_id uuid, user_name text, kind text, amount_aoa numeric,
  method text, status text, created_at timestamptz, due_at timestamptz,
  processed_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  RETURN QUERY
  SELECT pr.id, pr.user_id, COALESCE(p.display_name, 'Utilizador'), pr.kind,
         pr.amount_aoa, pr.method, pr.status, pr.created_at, pr.due_at, pr.processed_at
  FROM public.payout_requests pr
  LEFT JOIN public.profiles p ON p.id = pr.user_id
  ORDER BY pr.created_at DESC
  LIMIT 200;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_summary() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_signup_fees() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_payout_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, int) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_signup_fees() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_payout_requests() TO authenticated, service_role;