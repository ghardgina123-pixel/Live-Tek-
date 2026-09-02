ALTER TABLE public.payouts
  ADD COLUMN IF NOT EXISTS shipping_aoa numeric(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS shipping_aoa numeric(12,2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.enforce_payment_intent_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE o record; split jsonb;
BEGIN
  SELECT id, customer_id, store_id, subtotal_aoa, shipping_aoa, total_aoa, status INTO o
    FROM public.orders WHERE id = NEW.order_id;
  IF o.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  IF auth.uid() IS NOT NULL THEN
    IF o.customer_id <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
      RAISE EXCEPTION 'not_authorized';
    END IF;
    IF o.status <> 'pending'::order_status THEN RAISE EXCEPTION 'order_not_payable'; END IF;
    NEW.status := 'pending';
  END IF;

  split := public.calc_transaction_split(o.store_id, COALESCE(o.subtotal_aoa, 0));
  NEW.amount_aoa       := ROUND(COALESCE(o.total_aoa, 0), 2);
  NEW.shipping_aoa     := ROUND(COALESCE(o.shipping_aoa, 0), 2);
  NEW.commission_pct   := (split->>'commission_pct')::numeric;
  NEW.platform_fee_aoa := (split->>'platform_fee_aoa')::numeric;
  NEW.store_amount_aoa := (split->>'net_aoa')::numeric;
  IF NEW.reference IS NULL OR length(trim(NEW.reference)) = 0 THEN
    NEW.reference := 'LM-' || upper(left(replace(o.id::text,'-',''), 8)) || '-' || to_char(now(),'YYYYMMDDHH24MISS');
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_payout_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_split jsonb;
BEGIN
  IF NEW.status = 'paid' AND (OLD.status IS DISTINCT FROM 'paid') THEN
    v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.subtotal_aoa, 0));
    INSERT INTO public.payouts (order_id, store_id, gross_brl, commission_pct, net_brl,
                                gross_aoa, platform_fee_aoa, net_aoa, shipping_aoa, release_at, status)
    VALUES (
      NEW.id, NEW.store_id,
      COALESCE(NEW.total_brl,0),
      (v_split->>'commission_pct')::numeric,
      ROUND(COALESCE(NEW.total_brl,0) * (1 - (v_split->>'commission_pct')::numeric / 100), 2),
      (v_split->>'gross_aoa')::numeric,
      (v_split->>'platform_fee_aoa')::numeric,
      (v_split->>'net_aoa')::numeric,
      ROUND(COALESCE(NEW.shipping_aoa,0), 2),
      now() + INTERVAL '10 minutes',
      'pending'
    )
    ON CONFLICT (order_id) DO NOTHING;
    IF NEW.paid_at IS NULL THEN NEW.paid_at := now(); END IF;
  END IF;
  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.release_payout_on_delivered()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_split jsonb; v_store_owner uuid;
BEGIN
  IF NEW.status = 'delivered'::order_status AND OLD.status IS DISTINCT FROM 'delivered'::order_status THEN
    v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.subtotal_aoa, 0));

    INSERT INTO public.payouts (order_id, store_id, gross_brl, commission_pct, net_brl,
                                gross_aoa, platform_fee_aoa, net_aoa, shipping_aoa, release_at, status)
    VALUES (NEW.id, NEW.store_id, COALESCE(NEW.total_brl,0), (v_split->>'commission_pct')::numeric,
            ROUND(COALESCE(NEW.total_brl,0) * (1 - (v_split->>'commission_pct')::numeric / 100), 2),
            (v_split->>'gross_aoa')::numeric, (v_split->>'platform_fee_aoa')::numeric, (v_split->>'net_aoa')::numeric,
            ROUND(COALESCE(NEW.shipping_aoa,0), 2), now(), 'released')
    ON CONFLICT (order_id) DO NOTHING;

    UPDATE public.payouts
       SET status = 'released',
           released_at = COALESCE(released_at, now()),
           commission_pct = (v_split->>'commission_pct')::numeric,
           gross_aoa = (v_split->>'gross_aoa')::numeric,
           platform_fee_aoa = (v_split->>'platform_fee_aoa')::numeric,
           net_aoa = (v_split->>'net_aoa')::numeric,
           shipping_aoa = ROUND(COALESCE(NEW.shipping_aoa,0), 2)
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
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_payment_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_split jsonb;
  v_owner uuid;
  v_store text;
  v_courier_user uuid;
BEGIN
  IF NEW.status <> 'paid'::order_status OR OLD.status = 'paid'::order_status THEN
    RETURN NEW;
  END IF;

  v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.subtotal_aoa, 0));
  SELECT s.owner_id, s.name INTO v_owner, v_store FROM public.stores s WHERE s.id = NEW.store_id;

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (
    NEW.customer_id, 'payment.confirmed', 'Pagamento efetuado com sucesso.',
    'Pedido ' || left(NEW.id::text, 8) || ' — total ' || to_char(NEW.total_aoa, 'FM999G999G990D00')
      || ' Kz (produtos ' || to_char(COALESCE(NEW.subtotal_aoa,0), 'FM999G999G990D00')
      || ' Kz + entrega ' || to_char(COALESCE(NEW.shipping_aoa,0), 'FM999G999G990D00')
      || ' Kz) em ' || COALESCE(v_store, 'loja') || '.',
    '/rastreio/' || NEW.id::text, NEW.id
  );

  IF v_owner IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (
      v_owner, 'payment.received', 'Pagamento recebido com sucesso.',
      'Pedido ' || left(NEW.id::text, 8) || ' — bruto (produtos) ' || to_char((v_split->>'gross_aoa')::numeric, 'FM999G999G990D00')
        || ' Kz, comissão ' || to_char((v_split->>'platform_fee_aoa')::numeric, 'FM999G999G990D00')
        || ' Kz, líquido ' || to_char((v_split->>'net_aoa')::numeric, 'FM999G999G990D00')
        || ' Kz. Entrega ' || to_char(COALESCE(NEW.shipping_aoa,0), 'FM999G999G990D00') || ' Kz (entregador).',
      '/lojista/pedidos', NEW.id
    );
  END IF;

  SELECT c.user_id INTO v_courier_user
    FROM public.deliveries d JOIN public.couriers c ON c.id = d.courier_id
   WHERE d.order_id = NEW.id;
  IF v_courier_user IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (
      v_courier_user, 'delivery.paid', 'Entrega paga pelo cliente.',
      'Pedido ' || left(NEW.id::text, 8) || ' — taxa de entrega '
        || to_char(COALESCE(NEW.shipping_aoa,0), 'FM999G999G990D00') || ' Kz.',
      '/entregador', NEW.id
    );
  END IF;

  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES (
    'payment.completed', 'Pagamento efetuado.',
    jsonb_build_object(
      'order_id', NEW.id,
      'store_id', NEW.store_id,
      'store_name', v_store,
      'customer_id', NEW.customer_id,
      'payment_method', NEW.payment_method,
      'paid_at', COALESCE(NEW.paid_at, now()),
      'subtotal_aoa', COALESCE(NEW.subtotal_aoa,0),
      'shipping_aoa', COALESCE(NEW.shipping_aoa,0),
      'total_aoa', COALESCE(NEW.total_aoa,0),
      'split', v_split
    )
  );

  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.notify_courier_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_user uuid; v_ship numeric;
BEGIN
  IF NEW.courier_id IS NULL OR NEW.courier_id IS NOT DISTINCT FROM OLD.courier_id THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO v_user FROM public.couriers WHERE id = NEW.courier_id;
  SELECT shipping_aoa INTO v_ship FROM public.orders WHERE id = NEW.order_id;
  IF v_user IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (v_user, 'delivery.assigned', 'Nova entrega atribuída.',
            'Pedido ' || left(NEW.order_id::text, 8) || ' — taxa de entrega '
              || to_char(COALESCE(v_ship,0), 'FM999G999G990D00') || ' Kz.',
            '/entregador/' || NEW.id::text, NEW.id);
  END IF;
  RETURN NEW;
END; $function$;

DROP TRIGGER IF EXISTS trg_notify_courier_assignment ON public.deliveries;
CREATE TRIGGER trg_notify_courier_assignment
AFTER UPDATE OF courier_id ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.notify_courier_on_assignment();

CREATE OR REPLACE FUNCTION public.courier_open_deliveries()
RETURNS TABLE (
  delivery_id uuid, order_id uuid, status text, shipping_aoa numeric,
  store_name text, municipality text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid;
BEGIN
  SELECT id INTO v_courier FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.id, o.id, d.status, o.shipping_aoa, s.name, m.name, d.created_at
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.addresses a ON a.id = o.address_id
      LEFT JOIN public.municipalities m ON m.id = a.municipality_id
     WHERE d.courier_id IS NULL
       AND d.status IN ('pending','packaging')
     ORDER BY d.created_at DESC
     LIMIT 50;
END; $function$;

CREATE OR REPLACE FUNCTION public.courier_my_deliveries()
RETURNS TABLE (
  delivery_id uuid, order_id uuid, status text, shipping_aoa numeric,
  order_status text, store_name text, municipality text, street text,
  assigned_at timestamptz, delivered_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid;
BEGIN
  SELECT id INTO v_courier FROM public.couriers WHERE user_id = auth.uid();
  IF v_courier IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.id, o.id, d.status, o.shipping_aoa, o.status::text, s.name, m.name, a.street,
           d.assigned_at, d.delivered_at
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.addresses a ON a.id = o.address_id
      LEFT JOIN public.municipalities m ON m.id = a.municipality_id
     WHERE d.courier_id = v_courier
     ORDER BY d.created_at DESC
     LIMIT 100;
END; $function$;

CREATE OR REPLACE FUNCTION public.courier_accept_delivery(_delivery_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id INTO v_courier FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RAISE EXCEPTION 'courier_not_active'; END IF;

  UPDATE public.deliveries
     SET courier_id = v_courier, assigned_at = now()
   WHERE id = _delivery_id AND courier_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  RETURN _delivery_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.assign_delivery_courier(_delivery_id uuid, _courier_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT s.owner_id INTO v_owner
    FROM public.deliveries d
    JOIN public.orders o ON o.id = d.order_id
    JOIN public.stores s ON s.id = o.store_id
   WHERE d.id = _delivery_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.couriers WHERE id = _courier_id AND status = 'active'::courier_status) THEN
    RAISE EXCEPTION 'courier_not_active';
  END IF;
  UPDATE public.deliveries SET courier_id = _courier_id, assigned_at = now() WHERE id = _delivery_id;
  RETURN _delivery_id;
END; $function$;

CREATE OR REPLACE FUNCTION public.courier_delivery_detail(_delivery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_row record;
BEGIN
  SELECT d.id AS id, d.status AS status, d.courier_id AS courier_id, o.id AS order_id, o.status::text AS order_status,
         o.subtotal_aoa AS subtotal_aoa, o.shipping_aoa AS shipping_aoa, o.total_aoa AS total_aoa, s.name AS store_name,
         a.street AS street, m.name AS municipality
    INTO v_row
    FROM public.deliveries d
    JOIN public.orders o ON o.id = d.order_id
    JOIN public.stores s ON s.id = o.store_id
    LEFT JOIN public.addresses a ON a.id = o.address_id
    LEFT JOIN public.municipalities m ON m.id = a.municipality_id
   WHERE d.id = _delivery_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  IF NOT (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (SELECT 1 FROM public.couriers c WHERE c.id = v_row.courier_id AND c.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  RETURN jsonb_build_object(
    'delivery_id', v_row.id, 'status', v_row.status, 'order_id', v_row.order_id,
    'order_status', v_row.order_status, 'shipping_aoa', v_row.shipping_aoa,
    'subtotal_aoa', v_row.subtotal_aoa, 'total_aoa', v_row.total_aoa,
    'courier_earning_aoa', v_row.shipping_aoa,
    'store_name', v_row.store_name, 'street', v_row.street, 'municipality', v_row.municipality
  );
END; $function$;

REVOKE ALL ON FUNCTION public.courier_open_deliveries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courier_my_deliveries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courier_accept_delivery(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_delivery_courier(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courier_delivery_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_my_deliveries() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_accept_delivery(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assign_delivery_courier(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_delivery_detail(uuid) TO authenticated, service_role;