-- =========================================================
-- FASE 4 — Identidade fiscal (plataforma, loja, cliente) + snapshots
-- =========================================================

-- 1) Identidade fiscal da plataforma (TUSSALA KAKA) — sem dados inventados
CREATE TABLE IF NOT EXISTS public.platform_fiscal_identity (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  singleton boolean NOT NULL DEFAULT true,
  legal_name text,
  trade_name text,
  nif text,
  fiscal_address text,
  province text,
  municipality text,
  country_code text NOT NULL DEFAULT 'AO',
  email text,
  phone text,
  tax_regime text,
  currency_code text NOT NULL DEFAULT 'AOA',
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_fiscal_identity_singleton_chk CHECK (singleton)
);
CREATE UNIQUE INDEX IF NOT EXISTS platform_fiscal_identity_singleton_uk
  ON public.platform_fiscal_identity (singleton);

GRANT SELECT, INSERT, UPDATE ON public.platform_fiscal_identity TO authenticated;
GRANT ALL ON public.platform_fiscal_identity TO service_role;
ALTER TABLE public.platform_fiscal_identity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pfi_admin_select" ON public.platform_fiscal_identity;
CREATE POLICY "pfi_admin_select" ON public.platform_fiscal_identity
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "pfi_admin_insert" ON public.platform_fiscal_identity;
CREATE POLICY "pfi_admin_insert" ON public.platform_fiscal_identity
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "pfi_admin_update" ON public.platform_fiscal_identity;
CREATE POLICY "pfi_admin_update" ON public.platform_fiscal_identity
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_pfi_updated_at ON public.platform_fiscal_identity;
CREATE TRIGGER trg_pfi_updated_at BEFORE UPDATE ON public.platform_fiscal_identity
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Linha única em estado "configuração pendente" (todos os campos fiscais a NULL)
INSERT INTO public.platform_fiscal_identity (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

-- 2) Dados fiscais da loja (tabela privada já existente, RLS dono/gestor)
ALTER TABLE public.store_private
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS fiscal_address text,
  ADD COLUMN IF NOT EXISTS fiscal_province text,
  ADD COLUMN IF NOT EXISTS fiscal_municipality text,
  ADD COLUMN IF NOT EXISTS fiscal_email text,
  ADD COLUMN IF NOT EXISTS fiscal_phone text,
  ADD COLUMN IF NOT EXISTS tax_regime text;

-- 3) Dados fiscais mínimos do cliente/adquirente
CREATE TABLE IF NOT EXISTS public.customer_fiscal_profiles (
  user_id uuid NOT NULL PRIMARY KEY,
  legal_name text,
  nif text,
  fiscal_address text,
  province text,
  municipality text,
  country_code text NOT NULL DEFAULT 'AO',
  email text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_fiscal_profiles TO authenticated;
GRANT ALL ON public.customer_fiscal_profiles TO service_role;
ALTER TABLE public.customer_fiscal_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cfp_own_all" ON public.customer_fiscal_profiles;
CREATE POLICY "cfp_own_all" ON public.customer_fiscal_profiles
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "cfp_admin_select" ON public.customer_fiscal_profiles;
CREATE POLICY "cfp_admin_select" ON public.customer_fiscal_profiles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP TRIGGER IF EXISTS trg_cfp_updated_at ON public.customer_fiscal_profiles;
CREATE TRIGGER trg_cfp_updated_at BEFORE UPDATE ON public.customer_fiscal_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4) Funções de snapshot fiscal (usadas no momento da emissão)
CREATE OR REPLACE FUNCTION public.fiscal_snapshot_platform()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'kind', 'platform',
    'legal_name', p.legal_name,
    'trade_name', p.trade_name,
    'nif', p.nif,
    'fiscal_address', p.fiscal_address,
    'province', p.province,
    'municipality', p.municipality,
    'country_code', p.country_code,
    'email', p.email,
    'phone', p.phone,
    'tax_regime', p.tax_regime,
    'currency_code', p.currency_code,
    'configured', p.is_active,
    'snapshot_at', to_jsonb(now())
  ))
  FROM public.platform_fiscal_identity p LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_snapshot_store(_store_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'kind', 'store',
    'store_id', s.id,
    'store_name', s.name,
    'legal_name', sp.legal_name,
    'nif', sp.nif,
    'fiscal_address', sp.fiscal_address,
    'province', sp.fiscal_province,
    'municipality', sp.fiscal_municipality,
    'email', sp.fiscal_email,
    'phone', COALESCE(sp.fiscal_phone, s.phone),
    'tax_regime', sp.tax_regime,
    'partner_type', s.partner_type,
    'owner_id', s.owner_id,
    'snapshot_at', to_jsonb(now())
  ))
  FROM public.stores s
  LEFT JOIN public.store_private sp ON sp.store_id = s.id
  WHERE s.id = _store_id;
$$;

CREATE OR REPLACE FUNCTION public.fiscal_snapshot_customer(_user_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'kind', 'customer',
    'user_id', _user_id,
    'name', COALESCE(c.legal_name, pr.display_name),
    'nif', c.nif,
    'fiscal_address', c.fiscal_address,
    'province', c.province,
    'municipality', c.municipality,
    'country_code', COALESCE(c.country_code, pr.country_code),
    'email', c.email,
    'phone', COALESCE(c.phone, pr.phone),
    'snapshot_at', to_jsonb(now())
  ))
  FROM (SELECT 1) x
  LEFT JOIN public.profiles pr ON pr.id = _user_id
  LEFT JOIN public.customer_fiscal_profiles c ON c.user_id = _user_id;
$$;

REVOKE ALL ON FUNCTION public.fiscal_snapshot_platform() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fiscal_snapshot_store(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fiscal_snapshot_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_platform() TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_store(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_customer(uuid) TO service_role;

-- 5) Separação absoluta de emissores (aplica-se a documentos novos)
ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_issuer_doc_kind_chk;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_issuer_doc_kind_chk CHECK (
  (doc_kind = 'sale' AND issuer_kind = 'store')
  OR (doc_kind IN ('commission', 'subscription') AND issuer_kind = 'platform')
);

-- 6) Imutabilidade dos snapshots fiscais e da identificação do documento
CREATE OR REPLACE FUNCTION public.guard_invoice_fiscal_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.issuer_kind IS DISTINCT FROM OLD.issuer_kind
     OR NEW.doc_kind IS DISTINCT FROM OLD.doc_kind
     OR NEW.series IS DISTINCT FROM OLD.series
     OR NEW.number IS DISTINCT FROM OLD.number
     OR NEW.full_number IS DISTINCT FROM OLD.full_number
     OR NEW.issued_at IS DISTINCT FROM OLD.issued_at
     OR NEW.store_id IS DISTINCT FROM OLD.store_id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
     OR NEW.subtotal_aoa IS DISTINCT FROM OLD.subtotal_aoa
     OR NEW.tax_aoa IS DISTINCT FROM OLD.tax_aoa
     OR NEW.total_aoa IS DISTINCT FROM OLD.total_aoa
     OR NEW.currency_code IS DISTINCT FROM OLD.currency_code
     OR NEW.issuer_snapshot IS DISTINCT FROM OLD.issuer_snapshot
     OR NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot
  THEN
    RAISE EXCEPTION 'invoice_fiscal_data_immutable';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_invoices_fiscal_immutable ON public.invoices;
CREATE TRIGGER trg_invoices_fiscal_immutable BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_invoice_fiscal_immutable();

-- 7) Emissão passa a usar os snapshots fiscais (sem alterar valores nem comissões)
CREATE OR REPLACE FUNCTION public.create_commission_invoice_on_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_split jsonb; v_store record; v_seq bigint; v_id uuid; v_fee numeric; v_pct numeric;
BEGIN
  IF NEW.status <> 'paid'::order_status OR OLD.status = 'paid'::order_status THEN
    RETURN NEW;
  END IF;

  v_split := public.calc_transaction_split(NEW.store_id, COALESCE(NEW.subtotal_aoa, 0));
  v_pct := (v_split->>'commission_pct')::numeric;
  v_fee := (v_split->>'platform_fee_aoa')::numeric;

  IF COALESCE(v_pct, 0) <= 0 OR COALESCE(v_fee, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.invoices
              WHERE order_id = NEW.id AND issuer_kind = 'platform' AND doc_kind = 'commission') THEN
    RETURN NEW;
  END IF;

  SELECT s.id, s.name, s.phone, s.owner_id, sp.nif INTO v_store
    FROM public.stores s LEFT JOIN public.store_private sp ON sp.store_id = s.id
   WHERE s.id = NEW.store_id;

  v_seq := public.next_invoice_number('COM');
  INSERT INTO public.invoices (
    issuer_kind, doc_kind, series, number, full_number, store_id, order_id,
    issuer_snapshot, customer_snapshot, subtotal_aoa, total_aoa,
    payment_method, reference, status, issued_at
  ) VALUES (
    'platform', 'commission', 'COM', v_seq,
    'COM-' || to_char(now(), 'YYYY') || '/' || lpad(v_seq::text, 6, '0'),
    NEW.store_id, NEW.id,
    public.fiscal_snapshot_platform(),
    public.fiscal_snapshot_store(NEW.store_id),
    v_fee, v_fee, NEW.payment_method, left(NEW.id::text, 8), 'issued', now()
  ) RETURNING id INTO v_id;

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_aoa, total_aoa)
  VALUES (v_id,
          'Comissão de intermediação ' || v_pct::text || '% sobre produtos (pedido '
            || left(NEW.id::text, 8) || ', subtotal ' || to_char(COALESCE(NEW.subtotal_aoa,0), 'FM999G999G990D00') || ' Kz)',
          1, v_fee, v_fee);

  IF v_store.owner_id IS NOT NULL THEN
    INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
    VALUES (v_store.owner_id, 'invoice.commission', 'Factura de comissão emitida',
            'Comissão de ' || to_char(v_fee, 'FM999G999G990D00') || ' Kz sobre o pedido '
              || left(NEW.id::text, 8) || '.',
            '/lojista/pedidos', NEW.id);
  END IF;

  RETURN NEW;
END; $function$;

CREATE OR REPLACE FUNCTION public.create_invoice_on_subscription_active()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
DECLARE
  v_store record;
  v_plan record;
  v_number text;
  v_seq bigint;
  v_start timestamptz;
  v_end timestamptz;
  v_invoice_id uuid;
  v_legacy_id uuid;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT s.id, s.name, s.phone, s.owner_id, sp.nif
      INTO v_store
      FROM public.stores s
      LEFT JOIN public.store_private sp ON sp.store_id = s.id
     WHERE s.id = NEW.store_id;

    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = NEW.plan;
    v_start := COALESCE(NEW.started_at, now());
    v_end := COALESCE(NEW.expires_at, now() + make_interval(days => COALESCE(v_plan.period_days, 30)));

    IF EXISTS (SELECT 1 FROM public.subscription_invoices
                WHERE subscription_id = NEW.id AND period_start = v_start) THEN
      RETURN NEW;
    END IF;

    v_seq := nextval('public.subscription_invoice_seq');
    v_number := 'FT-' || to_char(now(), 'YYYY') || '/' || lpad(v_seq::text, 6, '0');

    INSERT INTO public.subscription_invoices (
      subscription_id, store_id, number, plan_code, plan_name, amount_aoa,
      payment_method, reference, period_start, period_end, status, customer_snapshot
    ) VALUES (
      NEW.id, NEW.store_id, v_number, NEW.plan,
      COALESCE(v_plan.name, initcap(replace(NEW.plan, '_', ' '))),
      NEW.price_aoa, NEW.payment_method, NEW.reference,
      v_start, v_end, 'paid',
      jsonb_build_object('store_name', v_store.name, 'phone', v_store.phone, 'nif', v_store.nif, 'owner_id', v_store.owner_id)
    )
    ON CONFLICT (subscription_id, period_start) DO NOTHING
    RETURNING id INTO v_legacy_id;

    INSERT INTO public.invoices (
      issuer_kind, doc_kind, series, number, full_number, store_id, subscription_id,
      legacy_subscription_invoice_id, issuer_snapshot, customer_snapshot, subtotal_aoa, total_aoa,
      payment_method, reference, period_start, period_end, status, issued_at
    ) VALUES (
      'platform', 'subscription', 'SUB', v_seq, v_number, NEW.store_id, NEW.id,
      v_legacy_id,
      public.fiscal_snapshot_platform(),
      public.fiscal_snapshot_store(NEW.store_id),
      NEW.price_aoa, NEW.price_aoa, NEW.payment_method, NEW.reference,
      v_start, v_end, 'paid', now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_invoice_id;

    IF v_invoice_id IS NOT NULL THEN
      INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_aoa, total_aoa)
      VALUES (v_invoice_id,
              'Subscrição — Plano ' || COALESCE(v_plan.name, NEW.plan),
              1, NEW.price_aoa, NEW.price_aoa);
    END IF;

    UPDATE public.invoice_series SET next_number = GREATEST(next_number, v_seq + 1) WHERE code = 'SUB';

    IF v_store.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_store.owner_id, 'subscription.active', 'Subscrição ativada',
              'O plano ' || COALESCE(v_plan.name, NEW.plan) || ' está ativo. A sua fatura ' || v_number || ' já está disponível.',
              '/lojista/subscricao', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END; $function$;
