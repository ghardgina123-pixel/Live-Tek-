ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS delivery_class text;
ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_delivery_class_check;
ALTER TABLE public.products
  ADD CONSTRAINT products_delivery_class_check
  CHECK (delivery_class IS NULL OR delivery_class IN ('pequeno','medio','grande'));

ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS load_class text;
ALTER TABLE public.deliveries
  DROP CONSTRAINT IF EXISTS deliveries_load_class_check;
ALTER TABLE public.deliveries
  ADD CONSTRAINT deliveries_load_class_check
  CHECK (load_class IS NULL OR load_class IN ('pequeno','medio','grande'));

CREATE OR REPLACE FUNCTION public.load_class_rank(_class text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _class WHEN 'pequeno' THEN 1 WHEN 'medio' THEN 2 WHEN 'grande' THEN 3 ELSE NULL END
$$;

-- Classe final da encomenda: a mais exigente dos itens.
-- Se algum produto não tiver classificação, devolve NULL ("não definida").
CREATE OR REPLACE FUNCTION public.order_load_class(_order_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_max int; v_undef int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE p.delivery_class IS NULL),
         MAX(public.load_class_rank(p.delivery_class))
    INTO v_undef, v_max
    FROM public.order_items oi
    JOIN public.products p ON p.id = oi.product_id
   WHERE oi.order_id = _order_id;

  IF v_undef IS NULL OR v_undef > 0 OR v_max IS NULL THEN RETURN NULL; END IF;
  RETURN CASE v_max WHEN 1 THEN 'pequeno' WHEN 2 THEN 'medio' ELSE 'grande' END;
END $$;

-- Compatibilidade veículo/carga. Motoboy não transporta carga grande.
-- Classe não definida => sem regra automática (permitido).
CREATE OR REPLACE FUNCTION public.courier_type_supports_class(_ct courier_type, _class text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _class IS NULL THEN true
    WHEN _class = 'grande' THEN _ct <> 'motoboy'::courier_type
    ELSE true
  END
$$;

REVOKE ALL ON FUNCTION public.order_load_class(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.order_load_class(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.load_class_rank(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.courier_type_supports_class(courier_type, text) TO authenticated, service_role;

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
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, courier_fee_aoa, load_class
  ) VALUES (
    _order_id, 'pending',
    COALESCE(NULLIF(TRIM(COALESCE(v_o.store_name,'') || ' — ' || COALESCE(v_o.store_street,'')), '—'), v_o.store_name),
    NULLIF(TRIM(CONCAT_WS(', ', v_o.addr_street, v_o.addr_district, v_o.municipality, v_o.province)), ''),
    v_o.store_lat, v_o.store_lng, v_o.addr_lat, v_o.addr_lng,
    COALESCE(v_o.shipping_aoa, 0),
    public.order_load_class(_order_id)
  )
  RETURNING id INTO v_del;

  RETURN v_del;
END $function$;

DROP FUNCTION IF EXISTS public.courier_open_deliveries();
CREATE OR REPLACE FUNCTION public.courier_open_deliveries()
 RETURNS TABLE(delivery_id uuid, order_id uuid, status text, shipping_aoa numeric, courier_fee_aoa numeric, store_name text, municipality text, pickup_address text, dropoff_address text, load_class text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid; v_type courier_type;
BEGIN
  SELECT id, courier_type INTO v_courier, v_type FROM public.couriers
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
       AND public.courier_type_supports_class(v_type, d.load_class)
     ORDER BY d.created_at DESC
     LIMIT 50;
END $function$;

GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated;

CREATE OR REPLACE FUNCTION public.courier_accept_delivery(_delivery_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_courier uuid; v_type courier_type; v_class text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT id, courier_type INTO v_courier, v_type FROM public.couriers
   WHERE user_id = auth.uid() AND status = 'active'::courier_status;
  IF v_courier IS NULL THEN RAISE EXCEPTION 'courier_not_active'; END IF;

  SELECT d.load_class INTO v_class FROM public.deliveries d WHERE d.id = _delivery_id;
  IF NOT public.courier_type_supports_class(v_type, v_class) THEN
    RAISE EXCEPTION 'vehicle_incompatible_with_load_class';
  END IF;

  UPDATE public.deliveries
     SET courier_id = v_courier, assigned_at = now()
   WHERE id = _delivery_id AND courier_id IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'delivery_already_assigned'; END IF;
  RETURN _delivery_id;
END; $function$;
