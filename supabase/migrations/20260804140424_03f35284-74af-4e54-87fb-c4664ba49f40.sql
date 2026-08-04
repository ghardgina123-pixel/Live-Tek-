-- 1) Partner identity
DO $$ BEGIN
  CREATE TYPE public.partner_type AS ENUM ('retail','service');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS partner_type public.partner_type NOT NULL DEFAULT 'retail';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS partner_type public.partner_type;

-- 2) AOA money columns on payouts (keep legacy BRL columns intact)
ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS gross_aoa numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS platform_fee_aoa numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_aoa numeric(12,2) NOT NULL DEFAULT 0;

-- 3) Commission by partner type
CREATE OR REPLACE FUNCTION public.store_commission_pct(_store_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE WHEN s.partner_type = 'service'::partner_type THEN 0::numeric ELSE 10::numeric END
  FROM public.stores s WHERE s.id = _store_id
$$;

-- 4) Real transaction split calculation
CREATE OR REPLACE FUNCTION public.calc_transaction_split(_store_id uuid, _amount_aoa numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_pct numeric; v_fee numeric; v_net numeric;
BEGIN
  v_pct := COALESCE(public.store_commission_pct(_store_id), 10);
  v_fee := ROUND(COALESCE(_amount_aoa,0) * v_pct / 100, 2);
  v_net := ROUND(COALESCE(_amount_aoa,0) - v_fee, 2);
  RETURN jsonb_build_object('gross_aoa', ROUND(COALESCE(_amount_aoa,0),2), 'commission_pct', v_pct, 'platform_fee_aoa', v_fee, 'net_aoa', v_net);
END; $$;

-- 5) Payout creation on payment (pending clearance)
CREATE OR REPLACE FUNCTION public.create_payout_on_paid()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_split jsonb;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.total_aoa, 0));
    INSERT INTO public.payouts (order_id, store_id, gross_brl, commission_pct, net_brl,
                                gross_aoa, platform_fee_aoa, net_aoa, release_at, status)
    VALUES (
      NEW.id, NEW.store_id,
      COALESCE(NEW.total_brl,0),
      (v_split->>'commission_pct')::numeric,
      ROUND(COALESCE(NEW.total_brl,0) * (1 - (v_split->>'commission_pct')::numeric / 100), 2),
      (v_split->>'gross_aoa')::numeric,
      (v_split->>'platform_fee_aoa')::numeric,
      (v_split->>'net_aoa')::numeric,
      now() + INTERVAL '10 minutes',
      'pending'
    )
    ON CONFLICT (order_id) DO NOTHING;
    IF NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  END IF;
  RETURN NEW;
END; $$;

-- 6) Auto split payment on delivery (retail flow: pending_clearance -> delivered -> auto_split_payment)
CREATE OR REPLACE FUNCTION public.release_payout_on_delivered()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_split jsonb; v_store_owner uuid;
BEGIN
  IF NEW.status = 'delivered'::order_status AND OLD.status IS DISTINCT FROM 'delivered'::order_status THEN
    v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.total_aoa, 0));

    INSERT INTO public.payouts (order_id, store_id, gross_brl, commission_pct, net_brl,
                                gross_aoa, platform_fee_aoa, net_aoa, release_at, status)
    VALUES (NEW.id, NEW.store_id, COALESCE(NEW.total_brl,0), (v_split->>'commission_pct')::numeric,
            ROUND(COALESCE(NEW.total_brl,0) * (1 - (v_split->>'commission_pct')::numeric / 100), 2),
            (v_split->>'gross_aoa')::numeric, (v_split->>'platform_fee_aoa')::numeric, (v_split->>'net_aoa')::numeric,
            now(), 'released')
    ON CONFLICT (order_id) DO NOTHING;

    UPDATE public.payouts
       SET status = 'released',
           released_at = COALESCE(released_at, now()),
           commission_pct = (v_split->>'commission_pct')::numeric,
           gross_aoa = (v_split->>'gross_aoa')::numeric,
           platform_fee_aoa = (v_split->>'platform_fee_aoa')::numeric,
           net_aoa = (v_split->>'net_aoa')::numeric
     WHERE order_id = NEW.id AND status <> 'released';

    SELECT owner_id INTO v_store_owner FROM public.stores WHERE id = NEW.store_id;
    IF v_store_owner IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_store_owner, 'payout.released', 'Pagamento libertado',
              'Kz ' || to_char((v_split->>'net_aoa')::numeric, 'FM999G999G999D00') || ' disponível para o pedido #' || left(NEW.id::text, 8),
              '/lojista/pedidos', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_release_payout_on_delivered ON public.orders;
CREATE TRIGGER trg_release_payout_on_delivered
AFTER UPDATE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.release_payout_on_delivered();

-- 7) Real store balance
CREATE OR REPLACE FUNCTION public.store_balance(_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner uuid; v_pending numeric; v_available numeric; v_fees numeric; v_pct numeric; v_ptype text;
BEGIN
  SELECT owner_id, partner_type::text INTO v_owner, v_ptype FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT COALESCE(SUM(net_aoa) FILTER (WHERE status = 'pending'), 0),
         COALESCE(SUM(net_aoa) FILTER (WHERE status = 'released'), 0),
         COALESCE(SUM(platform_fee_aoa), 0)
    INTO v_pending, v_available, v_fees
  FROM public.payouts WHERE store_id = _store_id;

  v_pct := COALESCE(public.store_commission_pct(_store_id), 10);

  RETURN jsonb_build_object(
    'partner_type', v_ptype,
    'commission_pct', v_pct,
    'pending_clearance_aoa', v_pending,
    'available_aoa', v_available,
    'platform_fees_aoa', v_fees
  );
END; $$;

-- 8) Seller sets its own partner type
CREATE OR REPLACE FUNCTION public.set_store_partner_type(_store_id uuid, _type public.partner_type)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  UPDATE public.stores SET partner_type = _type, updated_at = now() WHERE id = _store_id;
  UPDATE public.profiles SET partner_type = _type WHERE id = v_owner;
END; $$;

-- 9) Grants
REVOKE ALL ON FUNCTION public.store_commission_pct(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calc_transaction_split(uuid, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.store_balance(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_store_partner_type(uuid, public.partner_type) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.store_commission_pct(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.calc_transaction_split(uuid, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.store_balance(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_store_partner_type(uuid, public.partner_type) TO authenticated, service_role;