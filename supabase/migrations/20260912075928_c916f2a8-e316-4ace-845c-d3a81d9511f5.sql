-- ============ TARIFÁRIO ============
CREATE TABLE public.delivery_tariffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  currency text NOT NULL DEFAULT 'AOA',
  base_fee_aoa numeric(12,2) NOT NULL DEFAULT 0 CHECK (base_fee_aoa >= 0),
  price_per_km_aoa numeric(12,2) NOT NULL DEFAULT 0 CHECK (price_per_km_aoa >= 0),
  min_fee_aoa numeric(12,2) NOT NULL DEFAULT 0 CHECK (min_fee_aoa >= 0),
  per_kg_fee_aoa numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_kg_fee_aoa >= 0),
  included_weight_kg numeric(10,3) NOT NULL DEFAULT 0 CHECK (included_weight_kg >= 0),
  per_m3_fee_aoa numeric(12,2) NOT NULL DEFAULT 0 CHECK (per_m3_fee_aoa >= 0),
  is_active boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid,
  activated_at timestamptz,
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX delivery_tariffs_one_active ON public.delivery_tariffs (is_active) WHERE is_active;

GRANT SELECT, INSERT, UPDATE ON public.delivery_tariffs TO authenticated;
GRANT ALL ON public.delivery_tariffs TO service_role;
ALTER TABLE public.delivery_tariffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage delivery tariffs" ON public.delivery_tariffs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_delivery_tariffs_updated_at BEFORE UPDATE ON public.delivery_tariffs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.delivery_tariff_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_id uuid NOT NULL REFERENCES public.delivery_tariffs(id) ON DELETE CASCADE,
  load_class text CHECK (load_class IN ('pequeno','medio','grande')),
  capacity text CHECK (capacity IN ('pequeno','medio','grande')),
  multiplier numeric(6,3) NOT NULL DEFAULT 1 CHECK (multiplier > 0),
  min_fee_aoa numeric(12,2) CHECK (min_fee_aoa IS NULL OR min_fee_aoa >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX delivery_tariff_rules_unique ON public.delivery_tariff_rules (tariff_id, COALESCE(load_class,''), COALESCE(capacity,''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_tariff_rules TO authenticated;
GRANT ALL ON public.delivery_tariff_rules TO service_role;
ALTER TABLE public.delivery_tariff_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage delivery tariff rules" ON public.delivery_tariff_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_delivery_tariff_rules_updated_at BEFORE UPDATE ON public.delivery_tariff_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.delivery_tariff_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tariff_id uuid REFERENCES public.delivery_tariffs(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_id uuid,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.delivery_tariff_events TO authenticated;
GRANT ALL ON public.delivery_tariff_events TO service_role;
ALTER TABLE public.delivery_tariff_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read delivery tariff events" ON public.delivery_tariff_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- ============ CONGELAMENTO NA ENCOMENDA / ENTREGA ============
ALTER TABLE public.orders
  ADD COLUMN delivery_fee_source text,
  ADD COLUMN delivery_tariff_id uuid REFERENCES public.delivery_tariffs(id),
  ADD COLUMN delivery_fee_currency text,
  ADD COLUMN delivery_distance_m numeric(12,2),
  ADD COLUMN delivery_distance_source text,
  ADD COLUMN delivery_fee_computed_at timestamptz;

ALTER TABLE public.deliveries
  ADD COLUMN delivery_fee_source text,
  ADD COLUMN delivery_tariff_id uuid REFERENCES public.delivery_tariffs(id),
  ADD COLUMN delivery_fee_currency text,
  ADD COLUMN delivery_fee_distance_m numeric(12,2),
  ADD COLUMN delivery_fee_distance_source text,
  ADD COLUMN delivery_fee_computed_at timestamptz;

-- ============ CÁLCULO SERVER-SIDE ÚNICO ============
CREATE OR REPLACE FUNCTION public.active_delivery_tariff()
RETURNS public.delivery_tariffs
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.delivery_tariffs WHERE is_active LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.active_delivery_tariff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.active_delivery_tariff() TO authenticated, service_role;

-- Única fonte de verdade do valor da entrega. Recalcula sempre a partir dos
-- dados reais em base de dados (produtos, quantidades, peso, volume, classe,
-- município e distância real da rota). Nunca aceita valores do frontend.
CREATE OR REPLACE FUNCTION public.delivery_fee_quote(
  _store_id uuid,
  _address_id uuid,
  _items jsonb,
  _route_distance_m numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_addr record;
  v_mun_fee numeric(12,2);
  v_item jsonb;
  v_p record;
  v_qty int;
  v_weight numeric := 0;
  v_volume numeric := 0;
  v_items_count int := 0;
  v_incomplete boolean := false;
  v_max_rank int := 0;
  v_undef int := 0;
  v_class text;
  v_t public.delivery_tariffs;
  v_rule public.delivery_tariff_rules;
  v_fee numeric(12,2);
  v_min numeric(12,2);
  v_km numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _items IS NULL OR jsonb_typeof(_items) <> 'array' OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'invalid_items';
  END IF;

  SELECT a.id, a.user_id, a.municipality_id INTO v_addr
    FROM public.addresses a WHERE a.id = _address_id;
  IF v_addr.id IS NULL OR v_addr.municipality_id IS NULL THEN RAISE EXCEPTION 'invalid_address'; END IF;
  IF v_addr.user_id <> v_uid AND NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT shipping_fee_aoa INTO v_mun_fee FROM public.municipalities WHERE id = v_addr.municipality_id;
  v_mun_fee := ROUND(COALESCE(v_mun_fee, 0), 2);

  FOR v_item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    v_qty := (v_item->>'quantity')::int;
    IF v_qty IS NULL OR v_qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
    SELECT p.id, p.store_id, p.status, p.weight_kg, p.length_cm, p.width_cm, p.height_cm, p.delivery_class
      INTO v_p FROM public.products p WHERE p.id = (v_item->>'product_id')::uuid;
    IF v_p.id IS NULL THEN RAISE EXCEPTION 'product_not_found:%', v_item->>'product_id'; END IF;
    IF v_p.store_id <> _store_id THEN RAISE EXCEPTION 'mixed_stores'; END IF;

    v_items_count := v_items_count + v_qty;
    IF v_p.weight_kg IS NULL OR v_p.length_cm IS NULL OR v_p.width_cm IS NULL OR v_p.height_cm IS NULL THEN
      v_incomplete := true;
    ELSE
      v_weight := v_weight + (v_p.weight_kg * v_qty);
      v_volume := v_volume + (v_p.length_cm * v_p.width_cm * v_p.height_cm * v_qty);
    END IF;
    IF v_p.delivery_class IS NULL THEN
      v_undef := v_undef + 1;
    ELSE
      v_max_rank := GREATEST(v_max_rank, public.load_class_rank(v_p.delivery_class));
    END IF;
  END LOOP;

  IF v_undef > 0 OR v_max_rank = 0 THEN
    v_class := NULL;
  ELSE
    v_class := CASE v_max_rank WHEN 1 THEN 'pequeno' WHEN 2 THEN 'medio' ELSE 'grande' END;
  END IF;

  SELECT * INTO v_t FROM public.active_delivery_tariff();

  -- Sem tarifário activo: comportamento actual (taxa por município) inalterado.
  IF v_t.id IS NULL THEN
    RETURN jsonb_build_object(
      'available', true, 'fee_aoa', v_mun_fee, 'currency', 'AOA',
      'source', 'municipality', 'tariff_id', NULL, 'tariff_name', NULL,
      'distance_m', NULL, 'distance_source', NULL,
      'total_weight_kg', CASE WHEN v_incomplete THEN NULL ELSE ROUND(v_weight,3) END,
      'total_volume_cm3', CASE WHEN v_incomplete THEN NULL ELSE ROUND(v_volume,2) END,
      'items_count', v_items_count, 'logistics_incomplete', v_incomplete,
      'load_class', v_class, 'unavailable_reason', NULL, 'computed_at', now()
    );
  END IF;

  -- Preço por km exige distância REAL de rota. Nunca usar linha recta.
  IF v_t.price_per_km_aoa > 0 AND (_route_distance_m IS NULL OR _route_distance_m <= 0) THEN
    RETURN jsonb_build_object(
      'available', false, 'fee_aoa', NULL, 'currency', v_t.currency,
      'source', 'tariff', 'tariff_id', v_t.id, 'tariff_name', v_t.name,
      'distance_m', NULL, 'distance_source', NULL,
      'total_weight_kg', CASE WHEN v_incomplete THEN NULL ELSE ROUND(v_weight,3) END,
      'total_volume_cm3', CASE WHEN v_incomplete THEN NULL ELSE ROUND(v_volume,2) END,
      'items_count', v_items_count, 'logistics_incomplete', v_incomplete,
      'load_class', v_class,
      'unavailable_reason', 'sem_distancia_de_rota_real', 'computed_at', now()
    );
  END IF;

  IF (v_t.per_kg_fee_aoa > 0 OR v_t.per_m3_fee_aoa > 0) AND v_incomplete THEN
    RETURN jsonb_build_object(
      'available', false, 'fee_aoa', NULL, 'currency', v_t.currency,
      'source', 'tariff', 'tariff_id', v_t.id, 'tariff_name', v_t.name,
      'distance_m', _route_distance_m, 'distance_source', CASE WHEN _route_distance_m IS NULL THEN NULL ELSE 'route' END,
      'total_weight_kg', NULL, 'total_volume_cm3', NULL,
      'items_count', v_items_count, 'logistics_incomplete', true,
      'load_class', v_class,
      'unavailable_reason', 'dados_logisticos_incompletos', 'computed_at', now()
    );
  END IF;

  v_km := CASE WHEN _route_distance_m IS NULL THEN 0 ELSE _route_distance_m / 1000.0 END;
  v_fee := v_t.base_fee_aoa
         + ROUND(v_t.price_per_km_aoa * v_km, 2)
         + ROUND(v_t.per_kg_fee_aoa * GREATEST(0, v_weight - v_t.included_weight_kg), 2)
         + ROUND(v_t.per_m3_fee_aoa * (v_volume / 1000000.0), 2);

  SELECT * INTO v_rule FROM public.delivery_tariff_rules r
   WHERE r.tariff_id = v_t.id AND v_class IS NOT NULL AND r.load_class = v_class
   ORDER BY r.created_at LIMIT 1;
  IF v_rule.id IS NOT NULL THEN
    v_fee := ROUND(v_fee * v_rule.multiplier, 2);
  END IF;

  v_min := COALESCE(v_rule.min_fee_aoa, v_t.min_fee_aoa);
  v_fee := ROUND(GREATEST(v_fee, COALESCE(v_min, 0)), 2);

  RETURN jsonb_build_object(
    'available', true, 'fee_aoa', v_fee, 'currency', v_t.currency,
    'source', 'tariff', 'tariff_id', v_t.id, 'tariff_name', v_t.name,
    'distance_m', _route_distance_m,
    'distance_source', CASE WHEN _route_distance_m IS NULL THEN NULL ELSE 'route' END,
    'total_weight_kg', ROUND(v_weight,3), 'total_volume_cm3', ROUND(v_volume,2),
    'items_count', v_items_count, 'logistics_incomplete', v_incomplete,
    'load_class', v_class, 'unavailable_reason', NULL, 'computed_at', now()
  );
END $$;
REVOKE ALL ON FUNCTION public.delivery_fee_quote(uuid, uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delivery_fee_quote(uuid, uuid, jsonb, numeric) TO authenticated, service_role;

-- ============ CRIAÇÃO DA ENCOMENDA USA O MESMO CÁLCULO ============
CREATE OR REPLACE FUNCTION public.create_order_with_items(p_store_id uuid, p_address_id uuid, p_items jsonb, p_payment_method text DEFAULT 'manual'::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id UUID;
  v_customer UUID := auth.uid();
  v_item JSONB;
  v_product RECORD;
  v_qty INT;
  v_subtotal NUMERIC(12,2) := 0;
  v_shipping NUMERIC(12,2) := 0;
  v_quote JSONB;
BEGIN
  IF v_customer IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::INT;
    IF v_qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;

    SELECT id, stock, price_aoa, store_id, status
      INTO v_product
      FROM products
     WHERE id = (v_item->>'product_id')::UUID
     FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'product_not_found:%', v_item->>'product_id'; END IF;
    IF v_product.status <> 'approved' THEN RAISE EXCEPTION 'product_not_available:%', v_product.id; END IF;
    IF v_product.store_id <> p_store_id THEN RAISE EXCEPTION 'mixed_stores'; END IF;
    IF v_product.stock < v_qty THEN RAISE EXCEPTION 'out_of_stock:%', v_product.id; END IF;

    v_subtotal := v_subtotal + (v_product.price_aoa * v_qty);
  END LOOP;

  -- Valor da entrega calculado exclusivamente no servidor.
  v_quote := public.delivery_fee_quote(p_store_id, p_address_id, p_items, NULL);
  IF NOT (v_quote->>'available')::boolean THEN
    RAISE EXCEPTION 'delivery_fee_unavailable:%', COALESCE(v_quote->>'unavailable_reason','desconhecido');
  END IF;
  v_shipping := ROUND((v_quote->>'fee_aoa')::numeric, 2);

  INSERT INTO orders (store_id, customer_id, total_brl, subtotal_aoa, shipping_aoa, total_aoa,
                      address_id, payment_method, status,
                      delivery_fee_source, delivery_tariff_id, delivery_fee_currency,
                      delivery_distance_m, delivery_distance_source, delivery_fee_computed_at)
  VALUES (p_store_id, v_customer, 0, v_subtotal, v_shipping, v_subtotal + v_shipping,
          p_address_id, p_payment_method, 'pending',
          v_quote->>'source', NULLIF(v_quote->>'tariff_id','')::uuid, v_quote->>'currency',
          NULLIF(v_quote->>'distance_m','')::numeric, v_quote->>'distance_source', now())
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'quantity')::INT;
    SELECT price_aoa INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID;

    INSERT INTO order_items (order_id, product_id, quantity, unit_price_brl, unit_price_aoa)
    VALUES (v_order_id, (v_item->>'product_id')::UUID, v_qty, 0, v_product.price_aoa);

    UPDATE products SET stock = stock - v_qty WHERE id = (v_item->>'product_id')::UUID;
  END LOOP;

  RETURN v_order_id;
END;
$function$;

-- ============ ENTREGA COPIA O VALOR CONGELADO ============
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
         o.delivery_fee_source,
         o.delivery_tariff_id,
         o.delivery_fee_currency,
         o.delivery_distance_m,
         o.delivery_distance_source,
         o.delivery_fee_computed_at,
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
    total_weight_kg, total_volume_cm3, items_count, logistics_incomplete,
    delivery_fee_source, delivery_tariff_id, delivery_fee_currency,
    delivery_fee_distance_m, delivery_fee_distance_source, delivery_fee_computed_at
  ) VALUES (
    _order_id, 'pending',
    COALESCE(NULLIF(TRIM(COALESCE(v_o.store_name,'') || ' — ' || COALESCE(v_o.store_street,'')), '—'), v_o.store_name),
    NULLIF(TRIM(CONCAT_WS(', ', v_o.addr_street, v_o.addr_district, v_o.municipality, v_o.province)), ''),
    v_o.store_lat, v_o.store_lng, v_o.addr_lat, v_o.addr_lng,
    COALESCE(v_o.shipping_aoa, 0),
    public.order_load_class(_order_id),
    v_o.total_weight_kg, v_o.total_volume_cm3, v_o.items_count,
    COALESCE(v_o.logistics_incomplete, true),
    v_o.delivery_fee_source, v_o.delivery_tariff_id, v_o.delivery_fee_currency,
    v_o.delivery_distance_m, v_o.delivery_distance_source, v_o.delivery_fee_computed_at
  )
  RETURNING id INTO v_del;

  RETURN v_del;
END $function$;

-- ============ IMUTABILIDADE DO VALOR CONGELADO ============
CREATE OR REPLACE FUNCTION public.guard_order_tariff_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    NEW.delivery_fee_source := OLD.delivery_fee_source;
    NEW.delivery_tariff_id := OLD.delivery_tariff_id;
    NEW.delivery_fee_currency := OLD.delivery_fee_currency;
    NEW.delivery_distance_m := OLD.delivery_distance_m;
    NEW.delivery_distance_source := OLD.delivery_distance_source;
    NEW.delivery_fee_computed_at := OLD.delivery_fee_computed_at;
    NEW.shipping_aoa := OLD.shipping_aoa;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_order_tariff_immutable BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.guard_order_tariff_immutable();

CREATE OR REPLACE FUNCTION public.guard_delivery_tariff_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    NEW.courier_fee_aoa := OLD.courier_fee_aoa;
    NEW.delivery_fee_source := OLD.delivery_fee_source;
    NEW.delivery_tariff_id := OLD.delivery_tariff_id;
    NEW.delivery_fee_currency := OLD.delivery_fee_currency;
    NEW.delivery_fee_distance_m := OLD.delivery_fee_distance_m;
    NEW.delivery_fee_distance_source := OLD.delivery_fee_distance_source;
    NEW.delivery_fee_computed_at := OLD.delivery_fee_computed_at;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_delivery_tariff_immutable BEFORE UPDATE ON public.deliveries
  FOR EACH ROW EXECUTE FUNCTION public.guard_delivery_tariff_immutable();

-- ============ GESTÃO ADMINISTRATIVA ============
CREATE OR REPLACE FUNCTION public.admin_delivery_tariffs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  RETURN jsonb_build_object(
    'tariffs', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'currency', t.currency,
        'base_fee_aoa', t.base_fee_aoa, 'price_per_km_aoa', t.price_per_km_aoa,
        'min_fee_aoa', t.min_fee_aoa, 'per_kg_fee_aoa', t.per_kg_fee_aoa,
        'included_weight_kg', t.included_weight_kg, 'per_m3_fee_aoa', t.per_m3_fee_aoa,
        'is_active', t.is_active, 'notes', t.notes,
        'activated_at', t.activated_at, 'deactivated_at', t.deactivated_at,
        'created_at', t.created_at, 'updated_at', t.updated_at,
        'rules', COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', r.id, 'load_class', r.load_class, 'capacity', r.capacity,
            'multiplier', r.multiplier, 'min_fee_aoa', r.min_fee_aoa) ORDER BY r.created_at)
          FROM public.delivery_tariff_rules r WHERE r.tariff_id = t.id), '[]'::jsonb)
      ) ORDER BY t.created_at DESC)
      FROM public.delivery_tariffs t), '[]'::jsonb),
    'events', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'tariff_id', e.tariff_id, 'action', e.action,
        'details', e.details, 'created_at', e.created_at) ORDER BY e.created_at DESC)
      FROM (SELECT * FROM public.delivery_tariff_events ORDER BY created_at DESC LIMIT 50) e), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_delivery_tariffs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delivery_tariffs() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_save_delivery_tariff(_id uuid, _payload jsonb, _rules jsonb DEFAULT '[]'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_rule jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF COALESCE(TRIM(_payload->>'name'),'') = '' THEN RAISE EXCEPTION 'invalid_name'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.delivery_tariffs (name, currency, base_fee_aoa, price_per_km_aoa, min_fee_aoa,
      per_kg_fee_aoa, included_weight_kg, per_m3_fee_aoa, notes, created_by)
    VALUES (TRIM(_payload->>'name'), COALESCE(NULLIF(_payload->>'currency',''),'AOA'),
      COALESCE((_payload->>'base_fee_aoa')::numeric,0), COALESCE((_payload->>'price_per_km_aoa')::numeric,0),
      COALESCE((_payload->>'min_fee_aoa')::numeric,0), COALESCE((_payload->>'per_kg_fee_aoa')::numeric,0),
      COALESCE((_payload->>'included_weight_kg')::numeric,0), COALESCE((_payload->>'per_m3_fee_aoa')::numeric,0),
      NULLIF(_payload->>'notes',''), auth.uid())
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.delivery_tariffs SET
      name = TRIM(_payload->>'name'),
      currency = COALESCE(NULLIF(_payload->>'currency',''),'AOA'),
      base_fee_aoa = COALESCE((_payload->>'base_fee_aoa')::numeric,0),
      price_per_km_aoa = COALESCE((_payload->>'price_per_km_aoa')::numeric,0),
      min_fee_aoa = COALESCE((_payload->>'min_fee_aoa')::numeric,0),
      per_kg_fee_aoa = COALESCE((_payload->>'per_kg_fee_aoa')::numeric,0),
      included_weight_kg = COALESCE((_payload->>'included_weight_kg')::numeric,0),
      per_m3_fee_aoa = COALESCE((_payload->>'per_m3_fee_aoa')::numeric,0),
      notes = NULLIF(_payload->>'notes','')
    WHERE id = _id
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'tariff_not_found'; END IF;
  END IF;

  IF _rules IS NOT NULL AND jsonb_typeof(_rules) = 'array' THEN
    DELETE FROM public.delivery_tariff_rules WHERE tariff_id = v_id;
    FOR v_rule IN SELECT * FROM jsonb_array_elements(_rules) LOOP
      INSERT INTO public.delivery_tariff_rules (tariff_id, load_class, capacity, multiplier, min_fee_aoa)
      VALUES (v_id, NULLIF(v_rule->>'load_class',''), NULLIF(v_rule->>'capacity',''),
              COALESCE((v_rule->>'multiplier')::numeric, 1), NULLIF(v_rule->>'min_fee_aoa','')::numeric);
    END LOOP;
  END IF;

  INSERT INTO public.delivery_tariff_events (tariff_id, action, actor_id, details)
  VALUES (v_id, CASE WHEN _id IS NULL THEN 'created' ELSE 'updated' END, auth.uid(), _payload);

  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_delivery_tariff(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_save_delivery_tariff(uuid, jsonb, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_delivery_tariff_active(_id uuid, _active boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _active THEN
    UPDATE public.delivery_tariffs SET is_active = false, deactivated_at = now() WHERE is_active AND id <> _id;
    UPDATE public.delivery_tariffs SET is_active = true, activated_at = now() WHERE id = _id;
  ELSE
    UPDATE public.delivery_tariffs SET is_active = false, deactivated_at = now() WHERE id = _id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'tariff_not_found'; END IF;
  INSERT INTO public.delivery_tariff_events (tariff_id, action, actor_id, details)
  VALUES (_id, CASE WHEN _active THEN 'activated' ELSE 'deactivated' END, auth.uid(), NULL);
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_delivery_tariff_active(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_delivery_tariff_active(uuid, boolean) TO authenticated, service_role;