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
         d.straight_distance_m, d.distance_unit, d.distance_computed_at,
         d.route_distance_m, d.route_duration_s, d.route_polyline,
         d.route_provider, d.route_computed_at,
         d.total_weight_kg, d.total_volume_cm3, d.logistics_incomplete, d.load_class,
         COALESCE(d.courier_fee_aoa, o.shipping_aoa) AS courier_fee_aoa,
         o.id AS order_id, o.status::text AS order_status,
         o.subtotal_aoa, o.shipping_aoa, o.total_aoa,
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
    'courier_earning_aoa', v_row.courier_fee_aoa,
    'store_name', v_row.store_name, 'store_phone', v_row.store_phone,
    'pickup_address', v_row.pickup_address, 'dropoff_address', v_row.dropoff_address,
    'pickup_lat', v_row.pickup_lat, 'pickup_lng', v_row.pickup_lng,
    'dropoff_lat', v_row.dropoff_lat, 'dropoff_lng', v_row.dropoff_lng,
    'straight_distance_m', v_row.straight_distance_m,
    'distance_unit', v_row.distance_unit,
    'distance_computed_at', v_row.distance_computed_at,
    'route_distance_m', v_row.route_distance_m,
    'route_duration_s', v_row.route_duration_s,
    'route_polyline', v_row.route_polyline,
    'route_provider', v_row.route_provider,
    'route_computed_at', v_row.route_computed_at,
    'total_weight_kg', v_row.total_weight_kg,
    'total_volume_cm3', v_row.total_volume_cm3,
    'logistics_incomplete', v_row.logistics_incomplete,
    'load_class', v_row.load_class,
    'street', v_row.street, 'reference', v_row.reference,
    'recipient_name', v_row.recipient_name, 'recipient_phone', v_row.recipient_phone,
    'municipality', v_row.municipality, 'items_count', v_row.items_count
  );
END $function$;

REVOKE ALL ON FUNCTION public.courier_delivery_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_delivery_detail(uuid) TO authenticated, service_role;