CREATE OR REPLACE FUNCTION public.admin_financial_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
    -- Receita de subscrições = apenas pagamentos efectivamente confirmados,
    -- nunca o preço de uma subscrição só por estar marcada como activa.
    'subscriptions_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.subscription_payments WHERE status = 'paid' AND paid_at IS NOT NULL), 0),
    'payouts_pending_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status IN ('pending','processing')), 0),
    'payouts_paid_aoa', COALESCE((SELECT sum(amount_aoa) FROM public.payout_requests WHERE status = 'paid'), 0),
    'stores_total', (SELECT count(*) FROM public.stores),
    'stores_active', (SELECT count(*) FROM public.stores WHERE status = 'active')
  ) INTO res;
  RETURN res;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_financial_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_summary() TO authenticated;