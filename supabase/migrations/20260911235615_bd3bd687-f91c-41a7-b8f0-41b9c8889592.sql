-- 1. Mapping helpers
CREATE OR REPLACE FUNCTION public.courier_capacity_for_type(_ct courier_type)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _ct
    WHEN 'motoboy'::courier_type THEN 'pequena'
    WHEN 'carro'::courier_type THEN 'media'
    ELSE 'grande'
  END
$$;

CREATE OR REPLACE FUNCTION public.load_capacity_rank(_cap text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _cap WHEN 'pequena' THEN 1 WHEN 'media' THEN 2 WHEN 'grande' THEN 3 ELSE NULL END
$$;

-- 2. Column
ALTER TABLE public.couriers
  ADD COLUMN IF NOT EXISTS load_capacity text;

UPDATE public.couriers
   SET load_capacity = public.courier_capacity_for_type(courier_type)
 WHERE load_capacity IS DISTINCT FROM public.courier_capacity_for_type(courier_type);

ALTER TABLE public.couriers
  ADD CONSTRAINT couriers_load_capacity_check
  CHECK (load_capacity IS NULL OR load_capacity IN ('pequena','media','grande'));

-- 3. Always server-derived from courier_type
CREATE OR REPLACE FUNCTION public.set_courier_load_capacity()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.load_capacity := public.courier_capacity_for_type(NEW.courier_type);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_courier_load_capacity ON public.couriers;
CREATE TRIGGER trg_courier_load_capacity
BEFORE INSERT OR UPDATE OF courier_type, load_capacity ON public.couriers
FOR EACH ROW EXECUTE FUNCTION public.set_courier_load_capacity();

-- 4. Capacity vs load class compatibility
CREATE OR REPLACE FUNCTION public.capacity_supports_class(_cap text, _class text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _class IS NULL THEN true
    WHEN _cap IS NULL THEN false
    WHEN public.load_class_rank(_class) IS NULL THEN true
    ELSE public.load_capacity_rank(_cap) >= public.load_class_rank(_class)
  END
$$;

CREATE OR REPLACE FUNCTION public.courier_type_supports_class(_ct courier_type, _class text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.capacity_supports_class(public.courier_capacity_for_type(_ct), _class)
$$;

-- 5. Open deliveries filtered by capacity
CREATE OR REPLACE FUNCTION public.courier_open_deliveries()
RETURNS TABLE(delivery_id uuid, order_id uuid, status text, shipping_aoa numeric, courier_fee_aoa numeric, store_name text, municipality text, pickup_address text, dropoff_address text, load_class text, created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_courier uuid; v_cap text;
BEGIN
  SELECT id, COALESCE(load_capacity, public.courier_capacity_for_type(courier_type))
    INTO v_courier, v_cap
    FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT d.id, o.id, d.status, o.shipping_aoa,
           COALESCE(d.courier_fee_aoa, o.shipping_aoa), s.name, m.name,
           d.pickup_address, d.dropoff_address, d.load_class, d.created_at
      FROM public.deliveries d
      JOIN public.orders o ON o.id = d.order_id
      JOIN public.stores s ON s.id = o.store_id
      LEFT JOIN public.addresses a ON a.id = o.address_id
      LEFT JOIN public.municipalities m ON m.id = a.municipality_id
     WHERE d.courier_id IS NULL
       AND d.status IN ('pending','packaging')
       AND public.capacity_supports_class(v_cap, d.load_class)
     ORDER BY d.created_at DESC
     LIMIT 50;
END $$;

-- 6. Accept with full server-side revalidation
CREATE OR REPLACE FUNCTION public.courier_accept_delivery(_delivery_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_courier uuid; v_cap text; v_class text; v_status text; v_assigned uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, COALESCE(load_capacity, public.courier_capacity_for_type(courier_type))
    INTO v_courier, v_cap
    FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RAISE EXCEPTION 'courier_not_active'; END IF;

  SELECT d.load_class, d.status, d.courier_id
    INTO v_class, v_status, v_assigned
    FROM public.deliveries d WHERE d.id = _delivery_id;
  IF v_status IS NULL THEN RAISE EXCEPTION 'delivery_not_found'; END IF;
  IF v_assigned IS NOT NULL THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  IF v_status NOT IN ('pending','packaging') THEN RAISE EXCEPTION 'delivery_not_open'; END IF;
  IF NOT public.capacity_supports_class(v_cap, v_class) THEN
    RAISE EXCEPTION 'vehicle_incompatible_with_load_class';
  END IF;

  UPDATE public.deliveries
     SET courier_id = v_courier, assigned_at = now()
   WHERE id = _delivery_id AND courier_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  RETURN _delivery_id;
END $$;

REVOKE ALL ON FUNCTION public.courier_open_deliveries() FROM anon;
REVOKE ALL ON FUNCTION public.courier_accept_delivery(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated;
GRANT EXECUTE ON FUNCTION public.courier_accept_delivery(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.capacity_supports_class(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_capacity_for_type(courier_type) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.load_capacity_rank(text) TO authenticated, service_role;