CREATE OR REPLACE FUNCTION public.affiliate_register_referral(_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_aff record; v_ref record; v_bonus numeric := 500; v_store uuid;
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

  SELECT id INTO v_store FROM public.stores WHERE owner_id = v_uid AND status = 'active'::store_status LIMIT 1;

  INSERT INTO public.affiliate_referrals (affiliate_id, referred_user_id, kind, store_id)
  VALUES (v_aff.id, v_uid, CASE WHEN v_store IS NULL THEN 'user' ELSE 'store' END::affiliate_referral_kind, v_store)
  RETURNING * INTO v_ref;

  INSERT INTO public.affiliate_commissions (affiliate_id, referral_id, source, base_aoa, rate_pct, amount_aoa, status, note)
  VALUES (v_aff.id, v_ref.id, 'signup', 0, 0, v_bonus, 'pending', 'Bónus por novo utilizador indicado');

  INSERT INTO public.user_notifications (user_id, kind, title, body, url, ref_id)
  VALUES (v_aff.user_id, 'affiliate.referral', 'Nova indicação registada',
          'Alguém criou conta com o seu link. Bónus de ' || v_bonus::text || ' Kz adicionado.',
          '/afiliados', v_ref.id);

  RETURN jsonb_build_object('ok', true, 'referral_id', v_ref.id);
END; $$;
REVOKE EXECUTE ON FUNCTION public.affiliate_register_referral(text) FROM anon;

-- Backend de confiança (service role, sem utilizador) pode concluir transições de estado
CREATE OR REPLACE FUNCTION public.guard_order_status_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean;
  v_is_seller boolean;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF auth.uid() IS NULL AND current_user IN ('service_role','postgres','supabase_admin') THEN
    RETURN NEW;
  END IF;
  v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  IF v_is_admin THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.stores s
    WHERE s.id = NEW.store_id AND s.owner_id = auth.uid()
  ) INTO v_is_seller;
  IF v_is_seller THEN
    IF NEW.status NOT IN ('preparing'::order_status, 'shipped'::order_status, 'cancelled'::order_status) THEN
      RAISE EXCEPTION 'order_status_not_allowed_for_seller';
    END IF;
    IF OLD.status = 'pending'::order_status AND NEW.status <> 'cancelled'::order_status THEN
      RAISE EXCEPTION 'seller_cannot_bypass_payment';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'order_status_change_not_authorized';
END; $$;