-- 1. PLANOS
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  price_aoa numeric(12,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'AOA',
  period_days integer NOT NULL DEFAULT 30,
  max_lives_per_month integer,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plans_public_read" ON public.subscription_plans;
CREATE POLICY "plans_public_read" ON public.subscription_plans
  FOR SELECT USING (is_active = true);

DROP POLICY IF EXISTS "plans_admin_manage" ON public.subscription_plans;
CREATE POLICY "plans_admin_manage" ON public.subscription_plans
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS trg_subscription_plans_updated ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_updated BEFORE UPDATE ON public.subscription_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.subscription_plans (code, name, price_aoa, period_days, max_lives_per_month, features, sort_order)
VALUES
  ('basico', 'Básico', 20000, 30, 4,
    '["Perfil de parceiro verificado","Até 4 lives por mês","Chat com clientes","Faturação automática"]'::jsonb, 1),
  ('profissional', 'Profissional', 55000, 30, 20,
    '["Tudo do Básico","Até 20 lives por mês","CRM e campanhas de mensagens","Relatórios de vendas","Destaque na página inicial"]'::jsonb, 2),
  ('elite', 'Elite', 125000, 30, NULL,
    '["Tudo do Profissional","Lives ilimitadas","Prioridade máxima na pesquisa","Gestor de conta dedicado","Faturação personalizada"]'::jsonb, 3)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      price_aoa = EXCLUDED.price_aoa,
      period_days = EXCLUDED.period_days,
      max_lives_per_month = EXCLUDED.max_lives_per_month,
      features = EXCLUDED.features,
      sort_order = EXCLUDED.sort_order,
      is_active = true;

-- 2. STORE_SUBSCRIPTIONS: dados do gateway
ALTER TABLE public.store_subscriptions
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS raw_payload jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS store_subscriptions_reference_key
  ON public.store_subscriptions (reference) WHERE reference IS NOT NULL;

-- 3. FATURAS
CREATE TABLE IF NOT EXISTS public.subscription_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.store_subscriptions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  number text NOT NULL UNIQUE,
  plan_code text NOT NULL,
  plan_name text NOT NULL,
  amount_aoa numeric(12,2) NOT NULL,
  currency_code text NOT NULL DEFAULT 'AOA',
  payment_method text,
  reference text,
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end timestamptz,
  status text NOT NULL DEFAULT 'paid',
  issued_at timestamptz NOT NULL DEFAULT now(),
  customer_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.subscription_invoices TO authenticated;
GRANT ALL ON public.subscription_invoices TO service_role;

ALTER TABLE public.subscription_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_owner_read" ON public.subscription_invoices;
CREATE POLICY "invoices_owner_read" ON public.subscription_invoices
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
  );

DROP TRIGGER IF EXISTS trg_subscription_invoices_updated ON public.subscription_invoices;
CREATE TRIGGER trg_subscription_invoices_updated BEFORE UPDATE ON public.subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE SEQUENCE IF NOT EXISTS public.subscription_invoice_seq START 1;

-- 4. GERAÇÃO AUTOMÁTICA DE FATURA AO ATIVAR
CREATE OR REPLACE FUNCTION public.create_invoice_on_subscription_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store record;
  v_plan record;
  v_number text;
BEGIN
  IF NEW.status = 'active' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
    SELECT s.id, s.name, s.phone, s.owner_id, sp.nif
      INTO v_store
      FROM public.stores s
      LEFT JOIN public.store_private sp ON sp.store_id = s.id
     WHERE s.id = NEW.store_id;

    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = NEW.plan;

    v_number := 'FT-' || to_char(now(), 'YYYY') || '/' || lpad(nextval('public.subscription_invoice_seq')::text, 6, '0');

    INSERT INTO public.subscription_invoices (
      subscription_id, store_id, number, plan_code, plan_name, amount_aoa,
      payment_method, reference, period_start, period_end, status, customer_snapshot
    ) VALUES (
      NEW.id, NEW.store_id, v_number, NEW.plan,
      COALESCE(v_plan.name, initcap(replace(NEW.plan, '_', ' '))),
      NEW.price_aoa, NEW.payment_method, NEW.reference,
      COALESCE(NEW.started_at, now()),
      COALESCE(NEW.expires_at, now() + make_interval(days => COALESCE(v_plan.period_days, 30))),
      'paid',
      jsonb_build_object('store_name', v_store.name, 'phone', v_store.phone, 'nif', v_store.nif, 'owner_id', v_store.owner_id)
    );

    IF v_store.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_store.owner_id, 'subscription.active', 'Subscrição ativada',
              'O plano ' || COALESCE(v_plan.name, NEW.plan) || ' está ativo. A sua fatura ' || v_number || ' já está disponível.',
              '/lojista/subscricao', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_subscription_invoice ON public.store_subscriptions;
CREATE TRIGGER trg_subscription_invoice AFTER INSERT OR UPDATE ON public.store_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.create_invoice_on_subscription_active();

-- 5. ESTADO DA SUBSCRIÇÃO
CREATE OR REPLACE FUNCTION public.store_subscription_status(_store_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_store record;
  v_sub record;
  v_plan record;
  v_required boolean;
  v_active boolean;
BEGIN
  SELECT id, owner_id, partner_type INTO v_store FROM public.stores WHERE id = _store_id;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;

  v_required := (v_store.partner_type = 'service'::partner_type);

  SELECT * INTO v_sub
    FROM public.store_subscriptions ss
   WHERE ss.store_id = _store_id
     AND ss.plan <> 'signup_fee'
     AND ss.status = 'active'
     AND (ss.expires_at IS NULL OR ss.expires_at > now())
   ORDER BY ss.expires_at DESC NULLS LAST
   LIMIT 1;

  IF v_sub.id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = v_sub.plan;
  END IF;

  v_active := v_sub.id IS NOT NULL;

  RETURN jsonb_build_object(
    'partner_type', v_store.partner_type::text,
    'subscription_required', v_required,
    'subscription_status', CASE WHEN v_active THEN 'active' ELSE 'inactive' END,
    'plan_code', v_sub.plan,
    'plan_name', v_plan.name,
    'price_aoa', v_sub.price_aoa,
    'expires_at', v_sub.expires_at,
    'max_lives_per_month', v_plan.max_lives_per_month,
    'can_go_live', (NOT v_required) OR v_active
  );
END; $$;

CREATE OR REPLACE FUNCTION public.can_store_go_live(_store_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((public.store_subscription_status(_store_id) ->> 'can_go_live')::boolean, false)
$$;

-- 6. BLOQUEIO REAL DE LIVES SEM SUBSCRIÇÃO
CREATE OR REPLACE FUNCTION public.enforce_live_subscription()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status <> 'live'::live_status THEN
    RETURN NEW;
  END IF;
  IF NOT public.can_store_go_live(NEW.store_id) THEN
    RAISE EXCEPTION 'subscription_inactive'
      USING HINT = 'Ative um plano de subscrição para transmitir em direto.';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_lives_enforce_subscription ON public.lives;
CREATE TRIGGER trg_lives_enforce_subscription BEFORE INSERT OR UPDATE ON public.lives
  FOR EACH ROW EXECUTE FUNCTION public.enforce_live_subscription();

-- 7. PEDIDO DE UPGRADE (cria subscrição pendente + referência)
CREATE OR REPLACE FUNCTION public.create_subscription_intent(_store_id uuid, _plan_code text, _payment_method text DEFAULT 'multicaixa_express')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_owner uuid;
  v_plan record;
  v_ref text;
  v_id uuid;
BEGIN
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  IF v_owner <> auth.uid() AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT * INTO v_plan FROM public.subscription_plans WHERE code = _plan_code AND is_active = true;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'plan_not_found'; END IF;

  v_ref := 'SUB-' || upper(left(_plan_code, 3)) || '-' || upper(left(replace(_store_id::text, '-', ''), 6)) || '-' || to_char(now(), 'YYYYMMDDHH24MISS');

  INSERT INTO public.store_subscriptions (store_id, plan, status, price_aoa, payment_method, provider, reference)
  VALUES (_store_id, _plan_code, 'pending', v_plan.price_aoa, _payment_method, _payment_method, v_ref)
  RETURNING id INTO v_id;

  INSERT INTO public.admin_notifications (kind, subject, payload)
  VALUES ('subscription.requested', 'Novo pedido de subscrição',
          jsonb_build_object('store_id', _store_id, 'plan', _plan_code, 'reference', v_ref, 'amount_aoa', v_plan.price_aoa));

  RETURN jsonb_build_object(
    'subscription_id', v_id,
    'reference', v_ref,
    'plan_code', _plan_code,
    'plan_name', v_plan.name,
    'amount_aoa', v_plan.price_aoa,
    'status', 'pending',
    'payment_method', _payment_method
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.create_subscription_intent(uuid, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_store_go_live(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_subscription_intent(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_store_go_live(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_subscription_status(uuid) TO authenticated;