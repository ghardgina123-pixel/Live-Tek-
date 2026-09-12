-- FASE F: distribuição por proximidade + atribuição segura

ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS is_available boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_lat numeric,
  ADD COLUMN IF NOT EXISTS last_lng numeric,
  ADD COLUMN IF NOT EXISTS last_location_at timestamptz;

-- Frescura máxima da localização GPS para efeitos de proximidade
CREATE OR REPLACE FUNCTION public.courier_location_max_age()
RETURNS interval LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT interval '15 minutes' $$;

CREATE OR REPLACE FUNCTION public.courier_gps_is_fresh(_lat numeric, _lng numeric, _at timestamptz)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
AS $$
  SELECT _lat IS NOT NULL AND _lng IS NOT NULL AND _at IS NOT NULL
     AND _lat BETWEEN -90 AND 90 AND _lng BETWEEN -180 AND 180
     AND _at >= now() - public.courier_location_max_age()
$$;

-- O entregador atualiza a SUA localização real (sem tocar em nada financeiro)
CREATE OR REPLACE FUNCTION public.courier_update_location(_lat numeric, _lng numeric)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_at timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _lat IS NULL OR _lng IS NULL
     OR _lat < -90 OR _lat > 90 OR _lng < -180 OR _lng > 180 THEN
    RAISE EXCEPTION 'invalid_coordinates';
  END IF;
  v_at := now();
  UPDATE public.couriers
     SET last_lat = _lat, last_lng = _lng, last_location_at = v_at
   WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'courier_not_found'; END IF;
  RETURN v_at;
END $$;

CREATE OR REPLACE FUNCTION public.courier_set_availability(_available boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _available IS NULL THEN RAISE EXCEPTION 'invalid_value'; END IF;
  UPDATE public.couriers SET is_available = _available WHERE user_id = auth.uid();
  IF NOT FOUND THEN RAISE EXCEPTION 'courier_not_found'; END IF;
  RETURN _available;
END $$;

-- Entregas abertas ordenadas por proximidade REAL da recolha
DROP FUNCTION IF EXISTS public.courier_open_deliveries();
CREATE FUNCTION public.courier_open_deliveries()
RETURNS TABLE(
  delivery_id uuid, order_id uuid, status text, shipping_aoa numeric, courier_fee_aoa numeric,
  store_name text, municipality text, pickup_address text, dropoff_address text, load_class text,
  total_weight_kg numeric, total_volume_cm3 numeric, items_count integer, logistics_incomplete boolean,
  created_at timestamptz, pickup_distance_m numeric, gps_fresh boolean
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_courier uuid; v_cap text; v_lat numeric; v_lng numeric; v_at timestamptz; v_fresh boolean;
BEGIN
  SELECT id, COALESCE(load_capacity, public.courier_capacity_for_type(courier_type)),
         last_lat, last_lng, last_location_at
    INTO v_courier, v_cap, v_lat, v_lng, v_at
    FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RETURN; END IF;
  v_fresh := public.courier_gps_is_fresh(v_lat, v_lng, v_at);

  RETURN QUERY
    SELECT d.id, o.id, d.status, o.shipping_aoa,
           COALESCE(d.courier_fee_aoa, o.shipping_aoa), s.name, m.name,
           d.pickup_address, d.dropoff_address, d.load_class,
           d.total_weight_kg, d.total_volume_cm3, d.items_count, d.logistics_incomplete,
           d.created_at,
           CASE WHEN v_fresh THEN public.geo_distance_m(v_lat, v_lng, d.pickup_lat, d.pickup_lng) END,
           v_fresh
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.addresses a ON a.id = o.address_id
      LEFT JOIN public.municipalities m ON m.id = a.municipality_id
     WHERE d.courier_id IS NULL
       AND d.status IN ('pending','packaging')
       AND public.capacity_supports_class(v_cap, d.load_class)
     ORDER BY (CASE WHEN v_fresh THEN public.geo_distance_m(v_lat, v_lng, d.pickup_lat, d.pickup_lng) END)
                ASC NULLS LAST,
              d.created_at DESC
     LIMIT 50;
END $$;

GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_update_location(numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_set_availability(boolean) TO authenticated;

-- Aceitação atómica com revalidação completa no mesmo momento
CREATE OR REPLACE FUNCTION public.courier_accept_delivery(_delivery_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_courier uuid; v_cap text; v_avail boolean; v_d record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, COALESCE(load_capacity, public.courier_capacity_for_type(courier_type)), is_available
    INTO v_courier, v_cap, v_avail
    FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RAISE EXCEPTION 'courier_not_active'; END IF;
  IF NOT v_avail THEN RAISE EXCEPTION 'courier_unavailable'; END IF;

  -- Bloqueio da linha: em concorrência apenas uma transação avança por vez
  SELECT d.id, d.status, d.courier_id, d.load_class
    INTO v_d
    FROM public.deliveries d
   WHERE d.id = _delivery_id
   FOR UPDATE;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  IF v_d.courier_id IS NOT NULL THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  IF v_d.status IN ('delivered','cancelled') THEN RAISE EXCEPTION 'delivery_closed'; END IF;
  IF v_d.status NOT IN ('pending','packaging') THEN RAISE EXCEPTION 'delivery_not_open'; END IF;
  IF NOT public.capacity_supports_class(v_cap, v_d.load_class) THEN
    RAISE EXCEPTION 'vehicle_incompatible_with_load_class';
  END IF;

  UPDATE public.deliveries
     SET courier_id = v_courier, assigned_at = now()
   WHERE id = _delivery_id
     AND courier_id IS NULL
     AND status IN ('pending','packaging');
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  RETURN _delivery_id;
END $$;

-- Elegíveis por proximidade (admin ou dono da loja da encomenda)
CREATE OR REPLACE FUNCTION public.delivery_eligible_couriers(_delivery_id uuid)
RETURNS TABLE(
  courier_id uuid, display_name text, courier_type text, capacity text,
  is_available boolean, gps_fresh boolean, last_location_at timestamptz,
  pickup_distance_m numeric, eligible boolean, reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_d record; v_owner uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT d.id, d.load_class, d.pickup_lat, d.pickup_lng, o.store_id
    INTO v_d
    FROM public.deliveries d JOIN public.orders o ON o.id = d.order_id
   WHERE d.id = _delivery_id;
  IF v_d.id IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  SELECT s.owner_id INTO v_owner FROM public.stores s WHERE s.id = v_d.store_id;
  IF NOT (public.has_role(auth.uid(), 'admin'::app_role) OR v_owner = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  RETURN QUERY
    SELECT c.id,
           COALESCE(c.company_name, c.full_name),
           c.courier_type::text,
           COALESCE(c.load_capacity, public.courier_capacity_for_type(c.courier_type)),
           c.is_available,
           public.courier_gps_is_fresh(c.last_lat, c.last_lng, c.last_location_at),
           c.last_location_at,
           CASE WHEN public.courier_gps_is_fresh(c.last_lat, c.last_lng, c.last_location_at)
                THEN public.geo_distance_m(c.last_lat, c.last_lng, v_d.pickup_lat, v_d.pickup_lng) END,
           (c.status = 'active'::courier_status
             AND c.is_available
             AND public.capacity_supports_class(COALESCE(c.load_capacity, public.courier_capacity_for_type(c.courier_type)), v_d.load_class)
             AND public.courier_gps_is_fresh(c.last_lat, c.last_lng, c.last_location_at)),
           CASE
             WHEN c.status <> 'active'::courier_status THEN 'entregador_inativo'
             WHEN NOT c.is_available THEN 'entregador_indisponivel'
             WHEN NOT public.capacity_supports_class(COALESCE(c.load_capacity, public.courier_capacity_for_type(c.courier_type)), v_d.load_class) THEN 'capacidade_incompativel'
             WHEN NOT public.courier_gps_is_fresh(c.last_lat, c.last_lng, c.last_location_at) THEN 'gps_indisponivel_ou_antigo'
             ELSE NULL
           END
      FROM public.couriers c
     ORDER BY 9 DESC, 8 ASC NULLS LAST, c.created_at ASC
     LIMIT 100;
END $$;

GRANT EXECUTE ON FUNCTION public.delivery_eligible_couriers(uuid) TO authenticated;

-- Notificar elegíveis; sem elegíveis, avisar administração e manter disponível
CREATE OR REPLACE FUNCTION public.notify_couriers_on_delivery()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_count integer := 0; r record;
BEGIN
  FOR r IN
    SELECT c.user_id,
           public.geo_distance_m(c.last_lat, c.last_lng, NEW.pickup_lat, NEW.pickup_lng) AS dist
      FROM public.couriers c
     WHERE c.status = 'active'::courier_status
       AND c.is_available
       AND public.capacity_supports_class(
             COALESCE(c.load_capacity, public.courier_capacity_for_type(c.courier_type)), NEW.load_class)
       AND public.courier_gps_is_fresh(c.last_lat, c.last_lng, c.last_location_at)
     ORDER BY 2 ASC NULLS LAST
     LIMIT 20
  LOOP
    v_count := v_count + 1;
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (r.user_id, 'delivery_available', 'Nova entrega disponível',
            CASE WHEN r.dist IS NOT NULL
                 THEN 'Recolha a ' || round(r.dist / 1000.0, 1)::text || ' km de si'
                 ELSE 'Entrega compatível disponível' END,
            '/entregador', NEW.id);
  END LOOP;

  IF v_count = 0 THEN
    INSERT INTO public.admin_notifications (kind, subject, payload)
    VALUES ('delivery_no_eligible_courier',
            'Entrega sem entregador elegível',
            jsonb_build_object('delivery_id', NEW.id, 'order_id', NEW.order_id,
                               'load_class', NEW.load_class));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_notify_couriers_on_delivery ON public.deliveries;
CREATE TRIGGER trg_notify_couriers_on_delivery
AFTER INSERT ON public.deliveries
FOR EACH ROW EXECUTE FUNCTION public.notify_couriers_on_delivery();