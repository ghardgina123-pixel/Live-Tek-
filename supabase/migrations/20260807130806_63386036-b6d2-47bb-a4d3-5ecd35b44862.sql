-- ============ AFFILIATE PROGRAM ============
CREATE TYPE public.affiliate_commission_status AS ENUM ('pending','released','paid','cancelled');
CREATE TYPE public.affiliate_referral_kind AS ENUM ('user','store');

CREATE TABLE public.affiliate_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.affiliate_accounts TO authenticated;
GRANT ALL ON public.affiliate_accounts TO service_role;
ALTER TABLE public.affiliate_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_accounts_select_own" ON public.affiliate_accounts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "affiliate_accounts_insert_own" ON public.affiliate_accounts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_affiliate_accounts_updated BEFORE UPDATE ON public.affiliate_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.affiliate_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliate_accounts(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  kind public.affiliate_referral_kind NOT NULL DEFAULT 'user',
  store_id uuid REFERENCES public.stores(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_referrals TO authenticated;
GRANT ALL ON public.affiliate_referrals TO service_role;
ALTER TABLE public.affiliate_referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_referrals_select_own" ON public.affiliate_referrals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR referred_user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.affiliate_accounts a WHERE a.id = affiliate_id AND a.user_id = auth.uid())
  );
CREATE TRIGGER trg_affiliate_referrals_updated BEFORE UPDATE ON public.affiliate_referrals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX idx_affiliate_referrals_affiliate ON public.affiliate_referrals(affiliate_id);

CREATE TABLE public.affiliate_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_id uuid NOT NULL REFERENCES public.affiliate_accounts(id) ON DELETE CASCADE,
  referral_id uuid REFERENCES public.affiliate_referrals(id) ON DELETE SET NULL,
  source text NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  subscription_id uuid REFERENCES public.store_subscriptions(id) ON DELETE SET NULL,
  base_aoa numeric(12,2) NOT NULL DEFAULT 0,
  rate_pct numeric(5,2) NOT NULL DEFAULT 0,
  amount_aoa numeric(12,2) NOT NULL DEFAULT 0,
  status public.affiliate_commission_status NOT NULL DEFAULT 'pending',
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.affiliate_commissions TO authenticated;
GRANT ALL ON public.affiliate_commissions TO service_role;
ALTER TABLE public.affiliate_commissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "affiliate_commissions_select_own" ON public.affiliate_commissions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin')
    OR EXISTS (SELECT 1 FROM public.affiliate_accounts a WHERE a.id = affiliate_id AND a.user_id = auth.uid())
  );
CREATE TRIGGER trg_affiliate_commissions_updated BEFORE UPDATE ON public.affiliate_commissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE UNIQUE INDEX uq_affiliate_commission_order ON public.affiliate_commissions(order_id, source) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX uq_affiliate_commission_sub ON public.affiliate_commissions(subscription_id, source) WHERE subscription_id IS NOT NULL;
CREATE UNIQUE INDEX uq_affiliate_commission_signup ON public.affiliate_commissions(referral_id) WHERE source = 'signup';

-- ---------- Código / link do afiliado ----------
CREATE OR REPLACE FUNCTION public.affiliate_get_or_create_code()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row record; v_code text; v_try int := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_row FROM public.affiliate_accounts WHERE user_id = v_uid;
  IF v_row.id IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'is_active', v_row.is_active);
  END IF;
  LOOP
    v_try := v_try + 1;
    v_code := upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.affiliate_accounts WHERE code = v_code) OR v_try > 12;
  END LOOP;
  INSERT INTO public.affiliate_accounts (user_id, code) VALUES (v_uid, v_code)
  ON CONFLICT (user_id) DO UPDATE SET updated_at = now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('id', v_row.id, 'code', v_row.code, 'is_active', v_row.is_active);
END; $$;

-- ---------- Registo da indicação ----------
CREATE OR REPLACE FUNCTION public.affiliate_register_referral(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_aff record; v_ref record; v_bonus numeric := 500;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  IF _code IS NULL OR length(trim(_code)) = 0 THEN RETURN jsonb_build_object('ok', false, 'reason','invalid_code'); END IF;

  SELECT * INTO v_aff FROM public.affiliate_accounts WHERE code = upper(trim(_code)) AND is_active;
  IF v_aff.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason','affiliate_not_found'); END IF;
  IF v_aff.user_id = v_uid THEN RETURN jsonb_build_object('ok', false, 'reason','self_referral'); END IF;

  SELECT * INTO v_ref FROM public.affiliate_referrals WHERE referred_user_id = v_uid;
  IF v_ref.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', v_ref.affiliate_id = v_aff.id, 'reason','already_referred');
  END IF;

  INSERT INTO public.affiliate_referrals (affiliate_id, referred_user_id, kind)
  VALUES (v_aff.id, v_uid, 'user')
  RETURNING * INTO v_ref;

  INSERT INTO public.affiliate_commissions (affiliate_id, referral_id, source, base_aoa, rate_pct, amount_aoa, status, note)
  VALUES (v_aff.id, v_ref.id, 'signup', 0, 0, v_bonus, 'pending', 'Bónus por novo utilizador indicado');

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_aff.user_id, 'affiliate.referral', 'Nova indicação registada',
          'Alguém criou conta com o seu link. Bónus de ' || v_bonus::text || ' Kz adicionado.',
          '/afiliados', v_ref.id);

  RETURN jsonb_build_object('ok', true, 'referral_id', v_ref.id);
END; $$;

-- Ao aprovar uma loja, marcar a indicação como "store" se o dono foi indicado
CREATE OR REPLACE FUNCTION public.affiliate_mark_store_referral()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'active'::store_status AND (TG_OP='INSERT' OR OLD.status IS DISTINCT FROM 'active'::store_status) THEN
    UPDATE public.affiliate_referrals
       SET kind = 'store', store_id = NEW.id, updated_at = now()
     WHERE referred_user_id = NEW.owner_id;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_affiliate_store_referral AFTER INSERT OR UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_mark_store_referral();

-- Comissão sobre pedidos entregues
CREATE OR REPLACE FUNCTION public.affiliate_commission_on_delivered()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref record; v_store_owner uuid; v_rate numeric; v_amount numeric;
BEGIN
  IF NEW.status <> 'delivered'::order_status OR OLD.status IS NOT DISTINCT FROM 'delivered'::order_status THEN
    RETURN NEW;
  END IF;

  -- 1) comprador indicado -> 1% do total
  SELECT * INTO v_ref FROM public.affiliate_referrals WHERE referred_user_id = NEW.customer_id;
  IF v_ref.id IS NOT NULL THEN
    v_rate := 1;
    v_amount := ROUND(COALESCE(NEW.total_aoa,0) * v_rate / 100, 2);
    IF v_amount > 0 THEN
      INSERT INTO public.affiliate_commissions (affiliate_id, referral_id, source, order_id, base_aoa, rate_pct, amount_aoa, status, note)
      VALUES (v_ref.affiliate_id, v_ref.id, 'order_buyer', NEW.id, COALESCE(NEW.total_aoa,0), v_rate, v_amount, 'released', 'Compra de utilizador indicado')
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- 2) loja indicada -> 5% do total do pedido
  SELECT owner_id INTO v_store_owner FROM public.stores WHERE id = NEW.store_id;
  IF v_store_owner IS NOT NULL THEN
    SELECT * INTO v_ref FROM public.affiliate_referrals WHERE referred_user_id = v_store_owner;
    IF v_ref.id IS NOT NULL THEN
      v_rate := 5;
      v_amount := ROUND(COALESCE(NEW.total_aoa,0) * v_rate / 100, 2);
      IF v_amount > 0 THEN
        INSERT INTO public.affiliate_commissions (affiliate_id, referral_id, source, order_id, base_aoa, rate_pct, amount_aoa, status, note)
        VALUES (v_ref.affiliate_id, v_ref.id, 'order_store', NEW.id, COALESCE(NEW.total_aoa,0), v_rate, v_amount, 'released', 'Venda de loja indicada')
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END; $$;
CREATE TRIGGER trg_affiliate_commission_delivered AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_commission_on_delivered();

-- Comissão sobre subscrições ativas de lojas indicadas
CREATE OR REPLACE FUNCTION public.affiliate_commission_on_subscription()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner uuid; v_ref record; v_rate numeric := 10; v_amount numeric;
BEGIN
  IF NEW.status <> 'active' OR (TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM 'active') THEN
    RETURN NEW;
  END IF;
  SELECT owner_id INTO v_owner FROM public.stores WHERE id = NEW.store_id;
  IF v_owner IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_ref FROM public.affiliate_referrals WHERE referred_user_id = v_owner;
  IF v_ref.id IS NULL THEN RETURN NEW; END IF;
  v_amount := ROUND(COALESCE(NEW.price_aoa,0) * v_rate / 100, 2);
  IF v_amount <= 0 THEN RETURN NEW; END IF;
  INSERT INTO public.affiliate_commissions (affiliate_id, referral_id, source, subscription_id, base_aoa, rate_pct, amount_aoa, status, note)
  VALUES (v_ref.affiliate_id, v_ref.id, 'subscription', NEW.id, COALESCE(NEW.price_aoa,0), v_rate, v_amount, 'released', 'Subscrição de loja indicada')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_affiliate_commission_subscription AFTER INSERT OR UPDATE ON public.store_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.affiliate_commission_on_subscription();

-- ---------- Resumo para o painel ----------
CREATE OR REPLACE FUNCTION public.affiliate_dashboard()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_aff record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;
  SELECT * INTO v_aff FROM public.affiliate_accounts WHERE user_id = v_uid;
  IF v_aff.id IS NULL THEN
    RETURN jsonb_build_object('code', NULL, 'referrals_total', 0, 'stores_total', 0,
      'pending_aoa', 0, 'released_aoa', 0, 'paid_aoa', 0, 'commissions', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'code', v_aff.code,
    'is_active', v_aff.is_active,
    'referrals_total', (SELECT COUNT(*) FROM public.affiliate_referrals r WHERE r.affiliate_id = v_aff.id),
    'stores_total', (SELECT COUNT(*) FROM public.affiliate_referrals r WHERE r.affiliate_id = v_aff.id AND r.kind = 'store'),
    'pending_aoa', (SELECT COALESCE(SUM(amount_aoa),0) FROM public.affiliate_commissions c WHERE c.affiliate_id = v_aff.id AND c.status='pending'),
    'released_aoa', (SELECT COALESCE(SUM(amount_aoa),0) FROM public.affiliate_commissions c WHERE c.affiliate_id = v_aff.id AND c.status='released'),
    'paid_aoa', (SELECT COALESCE(SUM(amount_aoa),0) FROM public.affiliate_commissions c WHERE c.affiliate_id = v_aff.id AND c.status='paid'),
    'commissions', COALESCE((
      SELECT jsonb_agg(x) FROM (
        SELECT c.id, c.source, c.amount_aoa, c.status, c.note, c.created_at
          FROM public.affiliate_commissions c
         WHERE c.affiliate_id = v_aff.id
         ORDER BY c.created_at DESC LIMIT 50
      ) x), '[]'::jsonb)
  );
END; $$;

REVOKE EXECUTE ON FUNCTION public.affiliate_get_or_create_code() FROM anon;
REVOKE EXECUTE ON FUNCTION public.affiliate_register_referral(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.affiliate_dashboard() FROM anon;