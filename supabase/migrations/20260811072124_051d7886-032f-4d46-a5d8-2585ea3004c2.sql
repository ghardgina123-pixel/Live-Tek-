-- 1. CONFIGURAÇÃO DA CAMPANHA -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.signup_campaign_config (
  id integer PRIMARY KEY DEFAULT 1,
  country_code text NOT NULL DEFAULT 'AO',
  free_slots integer NOT NULL DEFAULT 50,
  fee_aoa numeric NOT NULL DEFAULT 9500,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT signup_campaign_singleton CHECK (id = 1)
);
GRANT SELECT ON public.signup_campaign_config TO anon, authenticated;
GRANT ALL ON public.signup_campaign_config TO service_role;
ALTER TABLE public.signup_campaign_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS scc_read ON public.signup_campaign_config;
CREATE POLICY scc_read ON public.signup_campaign_config FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS scc_admin_write ON public.signup_campaign_config;
CREATE POLICY scc_admin_write ON public.signup_campaign_config FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
INSERT INTO public.signup_campaign_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
DROP TRIGGER IF EXISTS trg_scc_updated ON public.signup_campaign_config;
CREATE TRIGGER trg_scc_updated BEFORE UPDATE ON public.signup_campaign_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. COLUNAS DE CAMPANHA NAS LOJAS --------------------------------------------
ALTER TABLE public.stores
  ADD COLUMN IF NOT EXISTS registration_position integer,
  ADD COLUMN IF NOT EXISTS signup_fee_aoa numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS signup_fee_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS signup_fee_waived_by uuid,
  ADD COLUMN IF NOT EXISTS signup_fee_waived_at timestamptz,
  ADD COLUMN IF NOT EXISTS signup_fee_waived_reason text,
  ADD COLUMN IF NOT EXISTS review_state text NOT NULL DEFAULT 'pending';

DO $$ BEGIN
  ALTER TABLE public.stores ADD CONSTRAINT stores_signup_fee_status_chk
    CHECK (signup_fee_status IN ('not_required','pending','paid','waived'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.stores ADD CONSTRAINT stores_review_state_chk
    CHECK (review_state IN ('pending','under_review','approved','rejected','needs_correction','suspended'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- backfill determinístico das lojas retalhistas já existentes
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS pos
  FROM public.stores WHERE partner_type = 'retail' AND registration_position IS NULL
)
UPDATE public.stores s SET registration_position = o.pos FROM ordered o WHERE s.id = o.id;

UPDATE public.stores SET review_state = CASE
  WHEN status = 'active' THEN 'approved'
  WHEN status = 'rejected' THEN 'rejected'
  ELSE 'pending' END
WHERE review_state = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS stores_registration_position_uidx
  ON public.stores (registration_position) WHERE registration_position IS NOT NULL;

-- 3. ATRIBUIÇÃO ATÓMICA DA POSIÇÃO --------------------------------------------
CREATE OR REPLACE FUNCTION public.assign_store_registration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  cfg record; v_pos integer; v_owner_free boolean; v_free boolean;
BEGIN
  -- o cliente nunca decide estes campos
  NEW.registration_position := NULL;
  NEW.signup_fee_waived_by := NULL;
  NEW.signup_fee_waived_at := NULL;
  NEW.signup_fee_waived_reason := NULL;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    NEW.status := 'pending'::store_status;
  END IF;
  NEW.review_state := 'pending';

  -- serviços: registo livre, sem taxa e fora da campanha
  IF NEW.partner_type = 'service'::partner_type THEN
    NEW.signup_fee_aoa := 0;
    NEW.signup_fee_status := 'not_required';
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('live_teka_store_registration'));
  SELECT * INTO cfg FROM public.signup_campaign_config WHERE id = 1;

  SELECT COALESCE(MAX(registration_position), 0) + 1 INTO v_pos
  FROM public.stores WHERE registration_position IS NOT NULL;

  SELECT EXISTS(
    SELECT 1 FROM public.stores
    WHERE owner_id = NEW.owner_id AND registration_position IS NOT NULL
      AND signup_fee_aoa = 0
  ) INTO v_owner_free;

  NEW.registration_position := v_pos;
  v_free := COALESCE(cfg.is_active, false)
        AND v_pos <= COALESCE(cfg.free_slots, 0)
        AND NOT v_owner_free;

  IF v_free THEN
    NEW.signup_fee_aoa := 0;
    NEW.signup_fee_status := 'not_required';
  ELSE
    NEW.signup_fee_aoa := COALESCE(cfg.fee_aoa, 9500);
    NEW.signup_fee_status := 'pending';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_enforce_signup_fee ON public.stores;
DROP TRIGGER IF EXISTS enforce_signup_fee ON public.stores;
DROP TRIGGER IF EXISTS trg_assign_store_registration ON public.stores;
CREATE TRIGGER trg_assign_store_registration BEFORE INSERT ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.assign_store_registration();

-- impedir alteração dos campos de campanha por não-administradores
CREATE OR REPLACE FUNCTION public.guard_store_campaign_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    NEW.registration_position := OLD.registration_position;
    NEW.signup_fee_aoa := OLD.signup_fee_aoa;
    NEW.signup_fee_status := OLD.signup_fee_status;
    NEW.signup_fee_waived_by := OLD.signup_fee_waived_by;
    NEW.signup_fee_waived_at := OLD.signup_fee_waived_at;
    NEW.signup_fee_waived_reason := OLD.signup_fee_waived_reason;
    NEW.review_state := OLD.review_state;
    NEW.partner_type := OLD.partner_type;
    NEW.owner_id := OLD.owner_id;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_guard_store_campaign_fields ON public.stores;
CREATE TRIGGER trg_guard_store_campaign_fields BEFORE UPDATE ON public.stores
  FOR EACH ROW EXECUTE FUNCTION public.guard_store_campaign_fields();

-- 4. PAGAMENTOS DA TAXA DE ADESÃO ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_signup_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  amount_aoa numeric NOT NULL DEFAULT 0,
  method text,
  reference text,
  proof_url text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_by uuid,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_signup_fees_status_chk CHECK (status IN ('pending','paid','rejected'))
);
GRANT SELECT, INSERT ON public.store_signup_fees TO authenticated;
GRANT UPDATE ON public.store_signup_fees TO authenticated;
GRANT ALL ON public.store_signup_fees TO service_role;
ALTER TABLE public.store_signup_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ssf_owner_select ON public.store_signup_fees;
CREATE POLICY ssf_owner_select ON public.store_signup_fees FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)
     OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
DROP POLICY IF EXISTS ssf_owner_insert ON public.store_signup_fees;
CREATE POLICY ssf_owner_insert ON public.store_signup_fees FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
DROP POLICY IF EXISTS ssf_admin_update ON public.store_signup_fees;
CREATE POLICY ssf_admin_update ON public.store_signup_fees FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));

CREATE OR REPLACE FUNCTION public.enforce_signup_fee_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_due numeric;
BEGIN
  SELECT signup_fee_aoa INTO v_due FROM public.stores WHERE id = NEW.store_id;
  IF v_due IS NULL OR v_due <= 0 THEN RAISE EXCEPTION 'signup_fee_not_applicable'; END IF;
  NEW.amount_aoa := v_due;
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    NEW.status := 'pending';
    NEW.reviewed_by := NULL; NEW.reviewed_at := NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS trg_ssf_amount ON public.store_signup_fees;
CREATE TRIGGER trg_ssf_amount BEFORE INSERT ON public.store_signup_fees
  FOR EACH ROW EXECUTE FUNCTION public.enforce_signup_fee_amount();
DROP TRIGGER IF EXISTS trg_ssf_updated ON public.store_signup_fees;
CREATE TRIGGER trg_ssf_updated BEFORE UPDATE ON public.store_signup_fees
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. FUNÇÕES ADMINISTRATIVAS ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_confirm_signup_fee(_fee_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.store_signup_fees SET status='paid', reviewed_by=auth.uid(), reviewed_at=now()
   WHERE id=_fee_id RETURNING store_id INTO v_store;
  IF v_store IS NULL THEN RAISE EXCEPTION 'fee_not_found'; END IF;
  UPDATE public.stores SET signup_fee_status='paid', updated_at=now() WHERE id=v_store;
  PERFORM public.log_security_event('signup_fee.confirmed','info',auth.uid(),v_store,
    jsonb_build_object('fee_id',_fee_id));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_reject_signup_fee(_fee_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_store uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  UPDATE public.store_signup_fees SET status='rejected', rejection_reason=_reason,
         reviewed_by=auth.uid(), reviewed_at=now()
   WHERE id=_fee_id RETURNING store_id INTO v_store;
  IF v_store IS NULL THEN RAISE EXCEPTION 'fee_not_found'; END IF;
  UPDATE public.stores SET signup_fee_status='pending', updated_at=now() WHERE id=v_store;
  PERFORM public.log_security_event('signup_fee.rejected','warning',auth.uid(),v_store,
    jsonb_build_object('fee_id',_fee_id,'reason',_reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_waive_signup_fee(_store_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required'; END IF;
  UPDATE public.stores
     SET signup_fee_status='waived', signup_fee_waived_by=auth.uid(),
         signup_fee_waived_at=now(), signup_fee_waived_reason=_reason, updated_at=now()
   WHERE id=_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_not_found'; END IF;
  PERFORM public.log_security_event('signup_fee.waived','warning',auth.uid(),_store_id,
    jsonb_build_object('reason',_reason));
END; $$;

CREATE OR REPLACE FUNCTION public.admin_set_store_review_state(_store_id uuid, _state text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;
  IF _state NOT IN ('pending','under_review','approved','rejected','needs_correction','suspended') THEN
    RAISE EXCEPTION 'invalid_state';
  END IF;
  UPDATE public.stores SET review_state=_state,
         rejection_reason = CASE WHEN _state IN ('rejected','needs_correction') THEN _reason ELSE rejection_reason END,
         updated_at=now()
   WHERE id=_store_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'store_not_found'; END IF;
  PERFORM public.log_security_event('store.review_state','info',auth.uid(),_store_id,
    jsonb_build_object('state',_state,'reason',_reason));
END; $$;

-- aprovação exige taxa liquidada quando aplicável
CREATE OR REPLACE FUNCTION public.admin_approve_store(_store_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_owner uuid; v_fee numeric; v_fee_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  SELECT owner_id, signup_fee_aoa, signup_fee_status
    INTO v_owner, v_fee, v_fee_status
    FROM public.stores WHERE id = _store_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'store_not_found'; END IF;

  IF COALESCE(v_fee,0) > 0 AND COALESCE(v_fee_status,'pending') NOT IN ('paid','waived') THEN
    RAISE EXCEPTION 'signup_fee_unpaid';
  END IF;

  UPDATE public.stores
     SET status = 'active'::store_status, review_state='approved',
         rejection_reason = NULL, updated_at = now()
   WHERE id = _store_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (v_owner, 'seller'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  PERFORM public.log_security_event('store.approved','info',auth.uid(),_store_id,
    jsonb_build_object('fee_aoa',v_fee,'fee_status',v_fee_status));
END; $$;

-- 6. ESTADO OFICIAL DA CAMPANHA -----------------------------------------------
CREATE OR REPLACE FUNCTION public.seller_signup_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE cfg record; v_next integer; v_free_used integer; v_mine record;
BEGIN
  SELECT * INTO cfg FROM public.signup_campaign_config WHERE id = 1;
  SELECT COALESCE(MAX(registration_position),0) + 1 INTO v_next
    FROM public.stores WHERE registration_position IS NOT NULL;
  SELECT COUNT(*)::int INTO v_free_used
    FROM public.stores WHERE registration_position IS NOT NULL AND signup_fee_aoa = 0;

  SELECT registration_position, signup_fee_aoa, signup_fee_status, status::text, review_state
    INTO v_mine FROM public.stores WHERE owner_id = auth.uid()
    ORDER BY created_at LIMIT 1;

  RETURN jsonb_build_object(
    'campaign_active', COALESCE(cfg.is_active,false),
    'free_slots_total', COALESCE(cfg.free_slots,0),
    'free_slots_used', v_free_used,
    'slots_left', GREATEST(0, COALESCE(cfg.free_slots,0) - v_free_used),
    'next_position', v_next,
    'fee_required', NOT (COALESCE(cfg.is_active,false) AND v_next <= COALESCE(cfg.free_slots,0)),
    'fee_aoa', COALESCE(cfg.fee_aoa,9500),
    'approved_count', (SELECT COUNT(*)::int FROM public.stores WHERE status='active'::store_status),
    'my_store', CASE WHEN v_mine.registration_position IS NULL AND v_mine.status IS NULL THEN NULL
      ELSE jsonb_build_object(
        'registration_position', v_mine.registration_position,
        'signup_fee_aoa', v_mine.signup_fee_aoa,
        'signup_fee_status', v_mine.signup_fee_status,
        'status', v_mine.status,
        'review_state', v_mine.review_state) END
  );
END; $$;
REVOKE EXECUTE ON FUNCTION public.seller_signup_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seller_signup_status() TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_confirm_signup_fee(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_reject_signup_fee(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_waive_signup_fee(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_set_store_review_state(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_confirm_signup_fee(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reject_signup_fee(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_waive_signup_fee(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_store_review_state(uuid, text, text) TO authenticated;

-- 7. REQUISITOS CONFIGURÁVEIS DAS ÁREAS DE SERVIÇO -----------------------------
CREATE TABLE IF NOT EXISTS public.service_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_category text,
  key text NOT NULL,
  label text NOT NULL,
  description text,
  input_type text NOT NULL DEFAULT 'text',
  is_required boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_requirements_input_chk CHECK (input_type IN ('text','textarea','phone','file','url','number'))
);
CREATE UNIQUE INDEX IF NOT EXISTS service_requirements_key_uidx
  ON public.service_requirements (COALESCE(service_category,'*'), key);
GRANT SELECT ON public.service_requirements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.service_requirements TO authenticated;
GRANT ALL ON public.service_requirements TO service_role;
ALTER TABLE public.service_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sr_read ON public.service_requirements;
CREATE POLICY sr_read ON public.service_requirements FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS sr_admin_all ON public.service_requirements;
CREATE POLICY sr_admin_all ON public.service_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role));
DROP TRIGGER IF EXISTS trg_sr_updated ON public.service_requirements;
CREATE TRIGGER trg_sr_updated BEFORE UPDATE ON public.service_requirements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.service_requirements (service_category, key, label, description, input_type, is_required, sort_order)
VALUES
  (NULL,'company_name','Nome do profissional ou empresa','Nome que será publicado no diretório.','text',true,1),
  (NULL,'contact_phone','Telefone de contacto','Número usado pelos clientes para marcações.','phone','true'::boolean,2),
  (NULL,'service_description','Descrição dos serviços','Explique o que oferece e a área de cobertura.','textarea',true,3),
  (NULL,'identity_document','Documento de identificação','BI, passaporte ou documento equivalente do responsável.','file',true,4),
  (NULL,'proof_of_address','Comprovativo de morada ou localização','Documento ou fotografia do local de trabalho.','file',false,5),
  (NULL,'certification','Certificação ou licença profissional','Anexe se a categoria exigir certificação.','file',false,6)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.service_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id uuid NOT NULL REFERENCES public.stores(id) ON DELETE CASCADE,
  requirement_key text NOT NULL,
  value text,
  file_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, requirement_key)
);
GRANT SELECT, INSERT, UPDATE ON public.service_submissions TO authenticated;
GRANT ALL ON public.service_submissions TO service_role;
ALTER TABLE public.service_submissions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ss_owner_select ON public.service_submissions;
CREATE POLICY ss_owner_select ON public.service_submissions FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role)
     OR EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
DROP POLICY IF EXISTS ss_owner_write ON public.service_submissions;
CREATE POLICY ss_owner_write ON public.service_submissions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
DROP POLICY IF EXISTS ss_owner_update ON public.service_submissions;
CREATE POLICY ss_owner_update ON public.service_submissions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.stores s WHERE s.id = store_id AND s.owner_id = auth.uid()));
DROP TRIGGER IF EXISTS trg_ss_updated ON public.service_submissions;
CREATE TRIGGER trg_ss_updated BEFORE UPDATE ON public.service_submissions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();