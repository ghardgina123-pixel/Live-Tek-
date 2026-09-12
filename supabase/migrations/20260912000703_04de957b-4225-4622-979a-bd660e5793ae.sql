-- ============ FASE C: peso, dimensões e volume real ============

-- 1. Produtos: dados físicos (opcionais, apenas positivos)
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS weight_kg numeric(10,3),
  ADD COLUMN IF NOT EXISTS length_cm numeric(10,2),
  ADD COLUMN IF NOT EXISTS width_cm  numeric(10,2),
  ADD COLUMN IF NOT EXISTS height_cm numeric(10,2);

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_logistics_positive_chk;
ALTER TABLE public.products
  ADD CONSTRAINT products_logistics_positive_chk CHECK (
    (weight_kg IS NULL OR weight_kg > 0)
    AND (length_cm IS NULL OR length_cm > 0)
    AND (width_cm  IS NULL OR width_cm  > 0)
    AND (height_cm IS NULL OR height_cm > 0)
  );

-- 2. Snapshot por linha da encomenda
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS unit_weight_kg numeric(10,3),
  ADD COLUMN IF NOT EXISTS unit_volume_cm3 numeric(14,2);

-- 3. Snapshot agregado na encomenda
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS total_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS total_volume_cm3 numeric(16,2),
  ADD COLUMN IF NOT EXISTS items_count integer,
  ADD COLUMN IF NOT EXISTS logistics_incomplete boolean NOT NULL DEFAULT true;

-- 4. Snapshot na entrega
ALTER TABLE public.deliveries
  ADD COLUMN IF NOT EXISTS total_weight_kg numeric(12,3),
  ADD COLUMN IF NOT EXISTS total_volume_cm3 numeric(16,2),
  ADD COLUMN IF NOT EXISTS items_count integer,
  ADD COLUMN IF NOT EXISTS logistics_incomplete boolean NOT NULL DEFAULT true;

-- 5. Agregação server-side a partir do snapshot das linhas
CREATE OR REPLACE FUNCTION public.order_logistics_snapshot(_order_id uuid)
RETURNS TABLE(total_weight_kg numeric, total_volume_cm3 numeric, items_count integer, incomplete boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    ROUND(SUM(oi.unit_weight_kg * oi.quantity)::numeric, 3),
    ROUND(SUM(oi.unit_volume_cm3 * oi.quantity)::numeric, 2),
    COALESCE(SUM(oi.quantity), 0)::int,
    (COUNT(*) = 0
      OR COUNT(*) FILTER (WHERE oi.unit_weight_kg IS NULL OR oi.unit_volume_cm3 IS NULL) > 0)
  FROM public.order_items oi
  WHERE oi.order_id = _order_id;
$$;

REVOKE ALL ON FUNCTION public.order_logistics_snapshot(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.order_logistics_snapshot(uuid) TO authenticated, service_role;

-- 6. Impedir manipulação pelo cliente: valores logísticos são sempre derivados
CREATE OR REPLACE FUNCTION public.guard_order_items_logistics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_p record;
BEGIN
  SELECT p.weight_kg, p.length_cm, p.width_cm, p.height_cm
    INTO v_p FROM public.products p WHERE p.id = NEW.product_id;

  NEW.unit_weight_kg := v_p.weight_kg;
  NEW.unit_volume_cm3 := CASE
    WHEN v_p.length_cm IS NULL OR v_p.width_cm IS NULL OR v_p.height_cm IS NULL THEN NULL
    ELSE ROUND((v_p.length_cm * v_p.width_cm * v_p.height_cm)::numeric, 2)
  END;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_order_items_logistics ON public.order_items;
CREATE TRIGGER trg_order_items_logistics
  BEFORE INSERT OR UPDATE OF product_id, unit_weight_kg, unit_volume_cm3 ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_items_logistics();

-- Recalcular o agregado da encomenda sempre que as linhas mudam
CREATE OR REPLACE FUNCTION public.refresh_order_logistics()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_s record;
BEGIN
  v_id := COALESCE(NEW.order_id, OLD.order_id);
  SELECT * INTO v_s FROM public.order_logistics_snapshot(v_id);
  UPDATE public.orders o
     SET total_weight_kg = v_s.total_weight_kg,
         total_volume_cm3 = v_s.total_volume_cm3,
         items_count = v_s.items_count,
         logistics_incomplete = v_s.incomplete
   WHERE o.id = v_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_refresh_order_logistics ON public.order_items;
CREATE TRIGGER trg_refresh_order_logistics
  AFTER INSERT OR UPDATE OR DELETE ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.refresh_order_logistics();

-- Bloquear alteração directa dos agregados da encomenda por quem não é admin/serviço
CREATE OR REPLACE FUNCTION public.guard_order_logistics_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    NEW.total_weight_kg := OLD.total_weight_kg;
    NEW.total_volume_cm3 := OLD.total_volume_cm3;
    NEW.items_count := OLD.items_count;
    NEW.logistics_incomplete := OLD.logistics_incomplete;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_order_logistics ON public.orders;
CREATE TRIGGER trg_guard_order_logistics
  BEFORE UPDATE OF total_weight_kg, total_volume_cm3, items_count, logistics_incomplete ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_logistics_immutable();

-- 7. Entrega copia o snapshot da encomenda (imutável depois de criada)
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
         o.total_weight_kg,
         o.total_volume_cm3,
         o.items_count,
         o.logistics_incomplete,
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
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, courier_fee_aoa, load_class,
    total_weight_kg, total_volume_cm3, items_count, logistics_incomplete
  ) VALUES (
    _order_id, 'pending',
    COALESCE(NULLIF(TRIM(COALESCE(v_o.store_name,'') || ' — ' || COALESCE(v_o.store_street,'')), '—'), v_o.store_name),
    NULLIF(TRIM(CONCAT_WS(', ', v_o.addr_street, v_o.addr_district, v_o.municipality, v_o.province)), ''),
    v_o.store_lat, v_o.store_lng, v_o.addr_lat, v_o.addr_lng,
    COALESCE(v_o.shipping_aoa, 0),
    public.order_load_class(_order_id),
    v_o.total_weight_kg, v_o.total_volume_cm3, v_o.items_count,
    COALESCE(v_o.logistics_incomplete, true)
  )
  RETURNING id INTO v_del;

  RETURN v_del;
END $function$;

-- 8. Listagem de entregas abertas passa a expor os dados logísticos
DROP FUNCTION IF EXISTS public.courier_open_deliveries();
CREATE OR REPLACE FUNCTION public.courier_open_deliveries()
RETURNS TABLE(delivery_id uuid, order_id uuid, status text, shipping_aoa numeric, courier_fee_aoa numeric, store_name text, municipality text, pickup_address text, dropoff_address text, load_class text, total_weight_kg numeric, total_volume_cm3 numeric, items_count integer, logistics_incomplete boolean, created_at timestamp with time zone)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
           d.pickup_address, d.dropoff_address, d.load_class,
           d.total_weight_kg, d.total_volume_cm3, d.items_count, d.logistics_incomplete,
           d.created_at
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
END $function$;

REVOKE ALL ON FUNCTION public.courier_open_deliveries() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.courier_open_deliveries() TO authenticated, service_role;
