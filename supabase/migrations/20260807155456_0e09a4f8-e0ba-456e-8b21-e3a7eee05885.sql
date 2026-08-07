-- 1. Comissão de retalho: 10% -> 5%
CREATE OR REPLACE FUNCTION public.store_commission_pct(_store_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE WHEN s.partner_type = 'service'::partner_type THEN 0::numeric ELSE 5::numeric END
  FROM public.stores s WHERE s.id = _store_id
$$;

CREATE OR REPLACE FUNCTION public.calc_transaction_split(_store_id uuid, _amount_aoa numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_pct numeric; v_fee numeric; v_net numeric;
BEGIN
  v_pct := COALESCE(public.store_commission_pct(_store_id), 5);
  v_fee := ROUND(COALESCE(_amount_aoa,0) * v_pct / 100, 2);
  v_net := ROUND(COALESCE(_amount_aoa,0) - v_fee, 2);
  RETURN jsonb_build_object('gross_aoa', ROUND(COALESCE(_amount_aoa,0),2), 'commission_pct', v_pct, 'platform_fee_aoa', v_fee, 'net_aoa', v_net);
END; $$;

-- 2. Planos dinâmicos
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS categories text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'service';

UPDATE public.subscription_plans SET is_active = false WHERE code IN ('basico','elite');

INSERT INTO public.subscription_plans (code, name, price_aoa, currency_code, period_days, features, sort_order, is_active, description, categories, audience)
VALUES
 ('essencial','Essencial',25000,'AOA',30,
  '["Perfil de prestador verificado","Lives ilimitadas","Chat e contactos com clientes","Agenda de pedidos","Faturação automática"]'::jsonb,
  1,true,'Para profissionais individuais e pequenos estabelecimentos.',
  ARRAY['salao','barbearia','lavandaria','costureiro','outros'],'service'),
 ('profissional','Profissional',50000,'AOA',30,
  '["Tudo do Essencial","Lives ilimitadas","CRM e campanhas de mensagens","Relatórios de desempenho","Destaque na pesquisa"]'::jsonb,
  2,true,'Para empresas de serviços de média dimensão e equipas.',
  ARRAY['oficina','limpeza','eventos','ginasio','fotografo','escola','transporte','construcao','farmacia','hospital'],'service'),
 ('empresarial','Empresarial',125000,'AOA',30,
  '["Tudo do Profissional","Lives ilimitadas","Prioridade máxima na pesquisa","Gestor de conta dedicado","Faturação personalizada","Multi-utilizador"]'::jsonb,
  3,true,'Para hotéis, restaurantes, imobiliárias, turismo e grandes empresas.',
  ARRAY['hotel','hospedaria','restaurante','imobiliaria','turismo','bar','lanchonete','cozinha'],'service')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, price_aoa = EXCLUDED.price_aoa, period_days = EXCLUDED.period_days,
  features = EXCLUDED.features, sort_order = EXCLUDED.sort_order, is_active = true,
  description = EXCLUDED.description, categories = EXCLUDED.categories, audience = EXCLUDED.audience,
  updated_at = now();

-- 3. Ciclo de vida: carência e suspensão
ALTER TABLE public.store_subscriptions ADD COLUMN IF NOT EXISTS grace_until timestamptz;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS is_suspended boolean NOT NULL DEFAULT false;

-- 4. Tabelas de suporte
CREATE TABLE IF NOT EXISTS public.subscription_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.store_subscriptions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_history TO authenticated;
GRANT ALL ON public.subscription_history TO service_role;
ALTER TABLE public.subscription_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "history_owner_read" ON public.subscription_history FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = subscription_history.store_id AND s.owner_id = auth.uid())
       OR public.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.subscription_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.store_subscriptions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  amount_aoa numeric NOT NULL,
  method text,
  reference text,
  external_id text,
  status text NOT NULL DEFAULT 'paid',
  raw_payload jsonb,
  paid_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_ref_period_idx
  ON public.subscription_payments (subscription_id, reference, paid_at);
GRANT SELECT ON public.subscription_payments TO authenticated;
GRANT ALL ON public.subscription_payments TO service_role;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_payments_owner_read" ON public.subscription_payments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = subscription_payments.store_id AND s.owner_id = auth.uid())
       OR public.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.subscription_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES public.store_subscriptions(id) ON DELETE CASCADE,
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  milestone text NOT NULL,
  cycle_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscription_notifications_unique_idx
  ON public.subscription_notifications (subscription_id, milestone, cycle_expires_at);
GRANT SELECT ON public.subscription_notifications TO authenticated;
GRANT ALL ON public.subscription_notifications TO service_role;
ALTER TABLE public.subscription_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_notif_owner_read" ON public.subscription_notifications FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = subscription_notifications.store_id AND s.owner_id = auth.uid())
       OR public.has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.subscription_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES public.store_subscriptions(id) ON DELETE CASCADE,
  store_id uuid REFERENCES public.stores(id) ON DELETE CASCADE,
  actor_id uuid,
  event text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscription_logs TO authenticated;
GRANT ALL ON public.subscription_logs TO service_role;
ALTER TABLE public.subscription_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_logs_admin_read" ON public.subscription_logs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(),'admin'::app_role));

-- 5. Trigger de histórico + sincronização de suspensão
CREATE OR REPLACE FUNCTION public.track_subscription_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.subscription_history (subscription_id, store_id, from_status, to_status)
    VALUES (NEW.id, NEW.store_id, CASE WHEN TG_OP='UPDATE' THEN OLD.status END, NEW.status);
    INSERT INTO public.subscription_logs (subscription_id, store_id, actor_id, event, metadata)
    VALUES (NEW.id, NEW.store_id, auth.uid(), 'status_change',
            jsonb_build_object('from', CASE WHEN TG_OP='UPDATE' THEN OLD.status END, 'to', NEW.status, 'plan', NEW.plan));

    IF NEW.plan <> 'signup_fee' THEN
      IF NEW.status = 'suspended' THEN
        UPDATE public.stores SET is_suspended = true, updated_at = now() WHERE id = NEW.store_id;
      ELSIF NEW.status = 'active' THEN
        UPDATE public.stores SET is_suspended = false, updated_at = now() WHERE id = NEW.store_id;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_track_subscription_status ON public.store_subscriptions;
CREATE TRIGGER trg_track_subscription_status
AFTER INSERT OR UPDATE ON public.store_subscriptions
FOR EACH ROW EXECUTE FUNCTION public.track_subscription_status();

-- 6. Estado da subscrição com carência/suspensão
CREATE OR REPLACE FUNCTION public.store_subscription_status(_store_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store record; v_sub record; v_plan record; v_required boolean; v_state text;
BEGIN
  SELECT id, owner_id, partner_type, service_category INTO v_store FROM public.stores WHERE id = _store_id;
  IF v_store.id IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;
  v_required := (v_store.partner_type = 'service'::partner_type);

  SELECT * INTO v_sub FROM public.store_subscriptions ss
   WHERE ss.store_id = _store_id AND ss.plan <> 'signup_fee'
     AND ss.status IN ('active','grace','suspended')
   ORDER BY CASE ss.status WHEN 'active' THEN 1 WHEN 'grace' THEN 2 ELSE 3 END,
            ss.expires_at DESC NULLS LAST
   LIMIT 1;

  IF v_sub.id IS NOT NULL THEN
    SELECT * INTO v_plan FROM public.subscription_plans WHERE code = v_sub.plan;
  END IF;

  v_state := CASE
    WHEN v_sub.id IS NULL THEN 'inactive'
    WHEN v_sub.status = 'active' AND (v_sub.expires_at IS NULL OR v_sub.expires_at > now()) THEN 'active'
    WHEN v_sub.status = 'grace' THEN 'grace'
    WHEN v_sub.status = 'suspended' THEN 'suspended'
    ELSE 'inactive' END;

  RETURN jsonb_build_object(
    'partner_type', v_store.partner_type::text,
    'service_category', v_store.service_category,
    'subscription_required', v_required,
    'subscription_status', v_state,
    'plan_code', v_sub.plan,
    'plan_name', v_plan.name,
    'price_aoa', v_sub.price_aoa,
    'started_at', v_sub.started_at,
    'expires_at', v_sub.expires_at,
    'grace_until', v_sub.grace_until,
    'days_remaining', CASE WHEN v_sub.expires_at IS NULL THEN NULL
                           ELSE GREATEST(0, CEIL(EXTRACT(epoch FROM (v_sub.expires_at - now()))/86400))::int END,
    'max_lives_per_month', NULL,
    'can_go_live', (NOT v_required) OR v_state IN ('active','grace')
  );
END; $$;

-- 7. Expiração -> carência -> suspensão
CREATE OR REPLACE FUNCTION public.expire_due_subscriptions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row record; v_count int := 0;
BEGIN
  FOR v_row IN
    SELECT ss.id, ss.store_id, s.owner_id FROM public.store_subscriptions ss
      JOIN public.stores s ON s.id = ss.store_id
     WHERE ss.status = 'active' AND ss.plan <> 'signup_fee'
       AND ss.expires_at IS NOT NULL AND ss.expires_at <= now()
  LOOP
    UPDATE public.store_subscriptions
       SET status = 'grace', grace_until = now() + interval '7 days', updated_at = now()
     WHERE id = v_row.id;
    IF v_row.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_row.owner_id, 'subscription.grace', 'Subscrição em carência',
              'O seu plano expirou. Tem 7 dias de carência para renovar antes da suspensão.',
              '/lojista/subscricao', v_row.id);
    END IF;
    v_count := v_count + 1;
  END LOOP;

  FOR v_row IN
    SELECT ss.id, ss.store_id, s.owner_id FROM public.store_subscriptions ss
      JOIN public.stores s ON s.id = ss.store_id
     WHERE ss.status = 'grace' AND ss.grace_until IS NOT NULL AND ss.grace_until <= now()
  LOOP
    UPDATE public.store_subscriptions SET status = 'suspended', updated_at = now() WHERE id = v_row.id;
    IF v_row.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_row.owner_id, 'subscription.suspended', 'Subscrição suspensa',
              'O período de carência terminou. O seu perfil está oculto até renovar — nenhum dado foi apagado.',
              '/lojista/subscricao', v_row.id);
    END IF;
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END; $$;

-- 8. Avisos de renovação 15/7/3/1/0 dias
CREATE OR REPLACE FUNCTION public.subscription_renewal_notices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_row record; v_days int; v_milestone text; v_sent int := 0;
BEGIN
  FOR v_row IN
    SELECT ss.id, ss.store_id, ss.expires_at, ss.plan, s.owner_id
      FROM public.store_subscriptions ss JOIN public.stores s ON s.id = ss.store_id
     WHERE ss.status = 'active' AND ss.plan <> 'signup_fee'
       AND ss.expires_at IS NOT NULL
       AND ss.expires_at BETWEEN now() AND now() + interval '15 days'
  LOOP
    v_days := GREATEST(0, FLOOR(EXTRACT(epoch FROM (v_row.expires_at - now()))/86400))::int;
    v_milestone := CASE
      WHEN v_days >= 15 THEN 'd15' WHEN v_days >= 7 AND v_days < 8 THEN 'd7'
      WHEN v_days = 3 THEN 'd3' WHEN v_days = 1 THEN 'd1' WHEN v_days = 0 THEN 'd0' ELSE NULL END;
    IF v_milestone IS NULL THEN CONTINUE; END IF;

    BEGIN
      INSERT INTO public.subscription_notifications (subscription_id, store_id, milestone, cycle_expires_at)
      VALUES (v_row.id, v_row.store_id, v_milestone, v_row.expires_at);
    EXCEPTION WHEN unique_violation THEN CONTINUE;
    END;

    IF v_row.owner_id IS NOT NULL THEN
      INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
      VALUES (v_row.owner_id, 'subscription.renewal',
              CASE WHEN v_days = 0 THEN 'A sua subscrição vence hoje'
                   ELSE 'Subscrição vence em ' || v_days || ' dia(s)' END,
              'Renove o plano para manter o perfil visível e as lives ativas.',
              '/lojista/subscricao', v_row.id);
    END IF;
    v_sent := v_sent + 1;
  END LOOP;
  RETURN v_sent;
END; $$;

-- 9. Ativação regista pagamento e reativa automaticamente
CREATE OR REPLACE FUNCTION public.activate_subscription_by_reference(_reference text, _external_id text DEFAULT NULL::text, _payload jsonb DEFAULT NULL::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sub record; v_days int; v_now timestamptz := now();
BEGIN
  SELECT * INTO v_sub FROM public.store_subscriptions WHERE reference = _reference;
  IF v_sub.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;

  IF v_sub.status = 'active' AND (v_sub.expires_at IS NULL OR v_sub.expires_at > v_now) THEN
    RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', true);
  END IF;

  SELECT COALESCE(period_days, 30) INTO v_days FROM public.subscription_plans WHERE code = v_sub.plan;

  UPDATE public.store_subscriptions
     SET status = 'active',
         started_at = COALESCE(started_at, v_now),
         expires_at = GREATEST(COALESCE(expires_at, v_now), v_now) + make_interval(days => COALESCE(v_days, 30)),
         grace_until = NULL,
         external_id = COALESCE(_external_id, external_id),
         raw_payload = COALESCE(_payload, raw_payload),
         rejection_reason = NULL, cancelled_at = NULL, cancel_reason = NULL, updated_at = v_now
   WHERE id = v_sub.id;

  INSERT INTO public.subscription_payments (subscription_id, store_id, amount_aoa, method, reference, external_id, status, raw_payload, paid_at)
  VALUES (v_sub.id, v_sub.store_id, v_sub.price_aoa, v_sub.payment_method, v_sub.reference, _external_id, 'paid', _payload, v_now)
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'subscription_id', v_sub.id, 'status', 'active', 'idempotent', false);
END; $$;

-- 10. Bloqueio de lives/atividade durante suspensão já coberto por can_store_go_live
REVOKE EXECUTE ON FUNCTION public.subscription_renewal_notices() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_due_subscriptions() FROM anon;