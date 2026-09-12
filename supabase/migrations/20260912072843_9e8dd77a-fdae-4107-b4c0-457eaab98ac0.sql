
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS straight_distance_m numeric,
  ADD COLUMN IF NOT EXISTS distance_unit text,
  ADD COLUMN IF NOT EXISTS distance_computed_at timestamptz,
  ADD COLUMN IF NOT EXISTS distance_origin_lat numeric,
  ADD COLUMN IF NOT EXISTS distance_origin_lng numeric,
  ADD COLUMN IF NOT EXISTS distance_destination_lat numeric,
  ADD COLUMN IF NOT EXISTS distance_destination_lng numeric,
  ADD COLUMN IF NOT EXISTS route_distance_m numeric,
  ADD COLUMN IF NOT EXISTS route_duration_s integer,
  ADD COLUMN IF NOT EXISTS route_polyline text,
  ADD COLUMN IF NOT EXISTS route_provider text,
  ADD COLUMN IF NOT EXISTS route_computed_at timestamptz;

-- Distância geodésica (linha reta) em metros. Só calcula com coordenadas válidas.
CREATE OR REPLACE FUNCTION public.geo_distance_m(
  _lat1 numeric, _lng1 numeric, _lat2 numeric, _lng2 numeric
) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  r constant double precision := 6371000;
  p1 double precision; p2 double precision; dp double precision; dl double precision; a double precision;
BEGIN
  IF _lat1 IS NULL OR _lng1 IS NULL OR _lat2 IS NULL OR _lng2 IS NULL THEN RETURN NULL; END IF;
  IF _lat1 < -90 OR _lat1 > 90 OR _lat2 < -90 OR _lat2 > 90 THEN RETURN NULL; END IF;
  IF _lng1 < -180 OR _lng1 > 180 OR _lng2 < -180 OR _lng2 > 180 THEN RETURN NULL; END IF;
  p1 := radians(_lat1::double precision); p2 := radians(_lat2::double precision);
  dp := p2 - p1; dl := radians((_lng2 - _lng1)::double precision);
  a := sin(dp/2)^2 + cos(p1)*cos(p2)*sin(dl/2)^2;
  RETURN round((2 * r * asin(least(1, sqrt(a))))::numeric, 2);
END $$;

REVOKE ALL ON FUNCTION public.geo_distance_m(numeric, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.geo_distance_m(numeric, numeric, numeric, numeric) TO authenticated, service_role;

-- Snapshot da distância no momento da criação da entrega.
CREATE OR REPLACE FUNCTION public.delivery_distance_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_d numeric;
BEGIN
  v_d := public.geo_distance_m(NEW.pickup_lat, NEW.pickup_lng, NEW.dropoff_lat, NEW.dropoff_lng);
  IF v_d IS NULL THEN
    NEW.straight_distance_m := NULL;
    NEW.distance_unit := NULL;
    NEW.distance_computed_at := NULL;
    NEW.distance_origin_lat := NULL; NEW.distance_origin_lng := NULL;
    NEW.distance_destination_lat := NULL; NEW.distance_destination_lng := NULL;
  ELSE
    NEW.straight_distance_m := v_d;
    NEW.distance_unit := 'm';
    NEW.distance_computed_at := now();
    NEW.distance_origin_lat := NEW.pickup_lat; NEW.distance_origin_lng := NEW.pickup_lng;
    NEW.distance_destination_lat := NEW.dropoff_lat; NEW.distance_destination_lng := NEW.dropoff_lng;
  END IF;
  -- rota nunca é definida pelo cliente na criação
  NEW.route_distance_m := NULL; NEW.route_duration_s := NULL;
  NEW.route_polyline := NULL; NEW.route_provider := NULL; NEW.route_computed_at := NULL;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_delivery_distance_snapshot ON public.deliveries;
CREATE TRIGGER trg_delivery_distance_snapshot
  BEFORE INSERT ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.delivery_distance_snapshot();

-- Bloqueia manipulação de distância/duração/rota/coordenadas por clientes.
CREATE OR REPLACE FUNCTION public.guard_delivery_geo_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  IF NEW.straight_distance_m IS DISTINCT FROM OLD.straight_distance_m
     OR NEW.distance_unit IS DISTINCT FROM OLD.distance_unit
     OR NEW.distance_computed_at IS DISTINCT FROM OLD.distance_computed_at
     OR NEW.distance_origin_lat IS DISTINCT FROM OLD.distance_origin_lat
     OR NEW.distance_origin_lng IS DISTINCT FROM OLD.distance_origin_lng
     OR NEW.distance_destination_lat IS DISTINCT FROM OLD.distance_destination_lat
     OR NEW.distance_destination_lng IS DISTINCT FROM OLD.distance_destination_lng
     OR NEW.route_distance_m IS DISTINCT FROM OLD.route_distance_m
     OR NEW.route_duration_s IS DISTINCT FROM OLD.route_duration_s
     OR NEW.route_polyline IS DISTINCT FROM OLD.route_polyline
     OR NEW.route_provider IS DISTINCT FROM OLD.route_provider
     OR NEW.route_computed_at IS DISTINCT FROM OLD.route_computed_at
     OR NEW.pickup_lat IS DISTINCT FROM OLD.pickup_lat
     OR NEW.pickup_lng IS DISTINCT FROM OLD.pickup_lng
     OR NEW.dropoff_lat IS DISTINCT FROM OLD.dropoff_lat
     OR NEW.dropoff_lng IS DISTINCT FROM OLD.dropoff_lng
  THEN
    RAISE EXCEPTION 'delivery_geo_immutable';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_delivery_geo_immutable ON public.deliveries;
CREATE TRIGGER trg_guard_delivery_geo_immutable
  BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_geo_immutable();

-- Gravação da rota real, apenas pelo servidor (service_role).
CREATE OR REPLACE FUNCTION public.set_delivery_route(
  _delivery_id uuid,
  _distance_m numeric,
  _duration_s integer,
  _polyline text,
  _provider text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _distance_m IS NULL OR _distance_m <= 0 OR _duration_s IS NULL OR _duration_s <= 0 THEN
    RAISE EXCEPTION 'invalid_route_payload';
  END IF;
  UPDATE public.deliveries
     SET route_distance_m = round(_distance_m, 2),
         route_duration_s = _duration_s,
         route_polyline = _polyline,
         route_provider = _provider,
         route_computed_at = now()
   WHERE id = _delivery_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.set_delivery_route(uuid, numeric, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_delivery_route(uuid, numeric, integer, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_delivery_route(uuid, numeric, integer, text, text) TO service_role;

-- Detalhe da entrega passa a devolver a geografia real.
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
