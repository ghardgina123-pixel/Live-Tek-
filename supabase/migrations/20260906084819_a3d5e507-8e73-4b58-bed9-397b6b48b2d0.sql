-- ============ Fase 1: modelo único de facturas ============

CREATE TABLE public.invoice_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  prefix text NOT NULL,
  issuer_kind text NOT NULL CHECK (issuer_kind IN ('platform','store')),
  doc_kind text NOT NULL CHECK (doc_kind IN ('sale','commission','subscription')),
  next_number bigint NOT NULL DEFAULT 1,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invoice_series TO authenticated;
GRANT ALL ON public.invoice_series TO service_role;
ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_series_admin_read" ON public.invoice_series
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer_kind text NOT NULL CHECK (issuer_kind IN ('platform','store')),
  doc_kind text NOT NULL CHECK (doc_kind IN ('sale','commission','subscription')),
  series text NOT NULL,
  number bigint NOT NULL,
  full_number text NOT NULL UNIQUE,
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.store_subscriptions(id) ON DELETE SET NULL,
  legacy_subscription_invoice_id uuid UNIQUE,
  issuer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  subtotal_aoa numeric NOT NULL DEFAULT 0,
  tax_aoa numeric NOT NULL DEFAULT 0,
  total_aoa numeric NOT NULL DEFAULT 0,
  currency_code text NOT NULL DEFAULT 'AOA',
  payment_method text,
  reference text,
  period_start timestamptz,
  period_end timestamptz,
  status text NOT NULL DEFAULT 'issued',
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (series, number)
);
CREATE INDEX invoices_store_idx ON public.invoices(store_id, issued_at DESC);
CREATE INDEX invoices_order_idx ON public.invoices(order_id);
CREATE INDEX invoices_subscription_idx ON public.invoices(subscription_id);

GRANT SELECT ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_store_owner_read" ON public.invoices
  FOR SELECT TO authenticated
  USING (store_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.stores s WHERE s.id = invoices.store_id AND s.owner_id = auth.uid()
  ));
CREATE POLICY "invoices_customer_read" ON public.invoices
  FOR SELECT TO authenticated
  USING (order_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = invoices.order_id AND o.customer_id = auth.uid()
  ));
CREATE POLICY "invoices_admin_read" ON public.invoices
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price_aoa numeric NOT NULL DEFAULT 0,
  total_aoa numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invoice_items_invoice_idx ON public.invoice_items(invoice_id);
GRANT SELECT ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_read_via_invoice" ON public.invoice_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_items.invoice_id));

CREATE TRIGGER invoices_set_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER invoice_items_set_updated_at BEFORE UPDATE ON public.invoice_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER invoice_series_set_updated_at BEFORE UPDATE ON public.invoice_series
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Série de subscrições (mesma numeração FT-<ano>/<n> já em uso)
INSERT INTO public.invoice_series (code, prefix, issuer_kind, doc_kind)
VALUES ('SUB', 'FT', 'platform', 'subscription');

-- Migração não destrutiva do histórico existente
INSERT INTO public.invoices (
  issuer_kind, doc_kind, series, number, full_number, store_id, subscription_id,
  legacy_subscription_invoice_id, customer_snapshot, subtotal_aoa, total_aoa,
  currency_code, payment_method, reference, period_start, period_end, status,
  issued_at, created_at, updated_at
)
SELECT
  'platform', 'subscription', 'SUB',
  COALESCE(NULLIF(regexp_replace(si.number, '^.*/', ''), '')::bigint,
           row_number() OVER (ORDER BY si.issued_at)),
  si.number, si.store_id, si.subscription_id, si.id, si.customer_snapshot,
  si.amount_aoa, si.amount_aoa, si.currency_code, si.payment_method, si.reference,
  si.period_start, si.period_end, si.status, si.issued_at, si.created_at, si.updated_at
FROM public.subscription_invoices si
ON CONFLICT DO NOTHING;

INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price_aoa, total_aoa)
SELECT i.id, 'Subscrição — Plano ' || si.plan_name, 1, si.amount_aoa, si.amount_aoa
FROM public.invoices i
JOIN public.subscription_invoices si ON si.id = i.legacy_subscription_invoice_id;

UPDATE public.invoice_series
SET next_number = GREATEST(next_number, COALESCE((SELECT MAX(number) + 1 FROM public.invoices WHERE series = 'SUB'), 1))
WHERE code = 'SUB';

-- Emissão automática passa a registar também no modelo único (registo antigo mantido)
CREATE OR REPLACE FUNCTION public.create_invoice_on_subscription_active()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      legacy_subscription_invoice_id, customer_snapshot, subtotal_aoa, total_aoa,
      payment_method, reference, period_start, period_end, status, issued_at
    ) VALUES (
      'platform', 'subscription', 'SUB', v_seq, v_number, NEW.store_id, NEW.id,
      v_legacy_id,
      jsonb_build_object('store_name', v_store.name, 'phone', v_store.phone, 'nif', v_store.nif, 'owner_id', v_store.owner_id),
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