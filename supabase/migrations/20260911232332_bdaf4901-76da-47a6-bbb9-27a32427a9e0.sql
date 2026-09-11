-- 1. Campos operacionais da entrega
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS pickup_address text,
  ADD COLUMN IF NOT EXISTS dropoff_address text,
  ADD COLUMN IF NOT EXISTS courier_fee_aoa numeric(12,2);

-- 2. Criação interna da entrega (preenche loja, endereços, coordenadas e valor)
CREATE OR REPLACE FUNCTION public.create_delivery_for_order(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_del uuid;
  v_o record;
BEGIN
  SELECT d.id INTO v_del FROM public.deliveries d WHERE d.order_id = _order_id;
  IF v_del IS NOT NULL THEN RETURN v_del; END IF;

  SELECT o.id,
         o.shipping_aoa,
         s.name AS store_name,
         s.street AS store_street,
         s.lat AS store_lat,
         s.lng AS store_lng,
         a.street AS addr_street,
         a.district AS addr_district,
         a.lat AS addr_lat,
         a.lng AS addr_lng,
         m.name AS municipality,
         p.name AS province
    INTO v_o
    FROM public.orders o
    JOIN public.stores s ON s.id = o.store_id
    LEFT JOIN public.addresses a ON a.id = o.address_id
    LEFT JOIN public.municipalities m ON m.id = a.municipality_id
    LEFT JOIN public.provinces p ON p.id = a.province_id
   WHERE o.id = _order_id;

  IF v_o.id IS NULL THEN RAISE EXCEPTION 'order_not_found'; END IF;

  INSERT INTO public.deliveries (
    order_id, status, pickup_address, dropoff_address,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, courier_fee_aoa
  ) VALUES (
    _order_id, 'pending',
    COALESCE(NULLIF(TRIM(COALESCE(v_o.store_name,'') || ' — ' || COALESCE(v_o.store_street,'')), '—'), v_o.store_name),
    NULLIF(TRIM(CONCAT_WS(', ', v_o.addr_street, v_o.addr_district, v_o.municipality, v_o.province)), ''),
    v_o.store_lat, v_o.store_lng, v_o.addr_lat, v_o.addr_lng,
    COALESCE(v_o.shipping_aoa, 0)
  )
  RETURNING id INTO v_del;

  RETURN v_del;
END $function$;

REVOKE ALL ON FUNCTION public.create_delivery_for_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_delivery_for_order(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_delivery_for_order(uuid) TO service_role;

-- 3. Criação automática assim que o pagamento é confirmado
CREATE OR REPLACE FUNCTION public.auto_create_delivery_on_paid()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'paid'::order_status AND OLD.status IS DISTINCT FROM 'paid'::order_status THEN
    PERFORM public.create_delivery_for_order(NEW.id);
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_auto_create_delivery ON public.orders;
CREATE TRIGGER trg_auto_create_delivery
AFTER UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.auto_create_delivery_on_paid();

-- 4. Notificar entregadores activos quando existir nova entrega disponível
CREATE OR REPLACE FUNCTION public.notify_couriers_new_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.courier_id IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  SELECT c.user_id, 'delivery.available', 'Nova entrega disponível.',
         'Recolha: ' || COALESCE(NEW.pickup_address, 'loja')
           || ' — entrega em ' || COALESCE(NEW.dropoff_address, 'endereço do cliente')
           || '. Valor: ' || to_char(COALESCE(NEW.courier_fee_aoa, 0), 'FM999G999G990D00') || ' Kz.',
         '/entregador', NEW.id
    FROM public.couriers c
   WHERE c.status = 'active'::courier_status AND c.user_id IS NOT NULL;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_notify_couriers_new_delivery ON public.deliveries;
CREATE TRIGGER trg_notify_couriers_new_delivery
AFTER INSERT ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.notify_couriers_new_delivery();

-- 5. Criação manual pelo lojista passa a usar a mesma função (compatibilidade)
CREATE OR REPLACE FUNCTION public.seller_create_delivery(_order_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_owner uuid; v_del uuid;
BEGIN
  SELECT s.owner_id INTO v_owner
    FROM public.orders o JOIN public.stores s ON s.id = o.store_id
    WHERE o.id = _order_id;
  IF v_owner IS NULL OR (v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  v_del := public.create_delivery_for_order(_order_id);
  UPDATE public.orders SET status = 'shipped' WHERE id = _order_id AND status IN ('paid','preparing');
  RETURN v_del;
END $function$;

-- 6. Lista de entregas abertas com dados operacionais
DROP FUNCTION IF EXISTS public.courier_open_deliveries();
CREATE FUNCTION public.courier_open_deliveries()
RETURNS TABLE(delivery_id uuid, order_id uuid, status text, shipping_aoa numeric,
              courier_fee_aoa numeric, store_name text, municipality text,
              pickup_address text, dropoff_address text, created_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid;
BEGIN
  SELECT id INTO v_courier FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.id, o.id, d.status, o.shipping_aoa,
           COALESCE(d.courier_fee_aoa, o.shipping_aoa), s.name, m.name,
           d.pickup_address, d.dropoff_address, d.created_at
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.addresses a ON a.id = o.address_id
      LEFT JOIN public.municipalities m ON m.id = a.municipality_id
     WHERE d.courier_id IS NULL
       AND d.status IN ('pending','packaging')
     ORDER BY d.created_at DESC
     LIMIT 50;
END $function$;

REVOKE ALL ON FUNCTION public.courier_open_deliveries() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courier_open_deliveries() FROM anon;
GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated, service_role;

-- 7. Detalhe completo da entrega para o entregador atribuído / admin
CREATE OR REPLACE FUNCTION public.courier_delivery_detail(_delivery_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row record;
BEGIN
  SELECT d.id AS id, d.status AS status, d.courier_id AS courier_id,
         d.pickup_address, d.dropoff_address,
         d.pickup_lat, d.pickup_lng, d.dropoff_lat, d.dropoff_lng,
         COALESCE(d.courier_fee_aoa, o.shipping_aoa) AS courier_fee_aoa,
         o.id AS order_id, o.status::text AS order_status,
         o.subtotal_aoa, o.shipping_aoa, o.total_aoa, o.payment_method,
         s.name AS store_name, s.phone AS store_phone,
         a.street AS street, a.reference AS reference,
         a.recipient_name AS recipient_name, a.phone AS recipient_phone,
         m.name AS municipality,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM public.order_items oi WHERE oi.order_id = o.id) AS items_count
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
    'payment_method', v_row.payment_method,
    'courier_earning_aoa', v_row.courier_fee_aoa,
    'store_name', v_row.store_name, 'store_phone', v_row.store_phone,
    'pickup_address', v_row.pickup_address, 'dropoff_address', v_row.dropoff_address,
    'pickup_lat', v_row.pickup_lat, 'pickup_lng', v_row.pickup_lng,
    'dropoff_lat', v_row.dropoff_lat, 'dropoff_lng', v_row.dropoff_lng,
    'street', v_row.street, 'reference', v_row.reference,
    'recipient_name', v_row.recipient_name, 'recipient_phone', v_row.recipient_phone,
    'municipality', v_row.municipality, 'items_count', v_row.items_count
  );
END $function$;

-- 8. Mudança de estado apenas por função protegida
CREATE OR REPLACE FUNCTION public.courier_update_delivery_status(_delivery_id uuid, _status text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_d record; v_is_admin boolean; v_is_courier boolean;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _status NOT IN ('packaging','in_transit','delivered') THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;
  SELECT d.id, d.status, d.courier_id, d.order_id INTO v_d
    FROM public.deliveries d WHERE d.id = _delivery_id;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;

  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  SELECT EXISTS (SELECT 1 FROM public.couriers c WHERE c.id = v_d.courier_id AND c.user_id = auth.uid())
    INTO v_is_courier;
  IF NOT (v_is_admin OR v_is_courier) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  IF v_d.status IN ('delivered','cancelled') THEN RAISE EXCEPTION 'delivery_closed'; END IF;
  IF _status = 'in_transit' AND v_d.status NOT IN ('pending','packaging') THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF _status = 'delivered' AND v_d.status <> 'in_transit' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;
  IF _status = 'packaging' AND v_d.status <> 'pending' THEN
    RAISE EXCEPTION 'invalid_transition';
  END IF;

  UPDATE public.deliveries
     SET status = _status,
         picked_up_at = CASE WHEN _status = 'in_transit' THEN now() ELSE picked_up_at END,
         delivered_at = CASE WHEN _status = 'delivered' THEN now() ELSE delivered_at END
   WHERE id = _delivery_id;

  IF _status = 'delivered' THEN
    UPDATE public.orders SET status = 'delivered'::order_status
     WHERE id = v_d.order_id AND status IN ('paid','preparing','shipped');
  END IF;

  RETURN _status;
END $function$;

REVOKE ALL ON FUNCTION public.courier_update_delivery_status(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.courier_update_delivery_status(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.courier_update_delivery_status(uuid, text) TO authenticated, service_role;

-- 9. Impedir alteração directa da tabela pelo entregador
DROP POLICY IF EXISTS deliveries_update_courier ON public.deliveries;

-- 10. Permitir ao entregador atribuído marcar o pedido como entregue (via função protegida)
CREATE OR REPLACE FUNCTION public.guard_order_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_admin boolean;
  v_is_seller boolean;
  v_is_courier boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL AND current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF v_is_admin THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = NEW.store_id AND s.owner_id = auth.uid()
  ) INTO v_is_seller;
  IF v_is_seller THEN
    IF NEW.status NOT IN ('preparing'::order_status, 'shipped'::order_status, 'cancelled'::order_status) THEN
      RAISE EXCEPTION 'order_status_not_allowed_for_seller';
    END IF;
    IF OLD.status = 'pending'::order_status AND NEW.status <> 'cancelled'::order_status THEN
      RAISE EXCEPTION 'seller_cannot_bypass_payment';
    END IF;
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.deliveries d
    JOIN public.couriers c ON c.id = d.courier_id
    WHERE d.order_id = NEW.id AND c.user_id = auth.uid()
  ) INTO v_is_courier;
  IF v_is_courier THEN
    IF NEW.status = 'delivered'::order_status
       AND OLD.status IN ('paid'::order_status, 'preparing'::order_status, 'shipped'::order_status) THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'order_status_not_allowed_for_courier';
  END IF;
  RAISE EXCEPTION 'order_status_change_not_authorized';
END $function$;

-- 11. Realtime para entregas e notificações
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.deliveries; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.user_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
