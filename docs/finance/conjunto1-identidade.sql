CREATE OR REPLACE FUNCTION public.normalize_identity_doc(_v text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT NULLIF(upper(regexp_replace(coalesce(_v,''), '[^0-9A-Za-z]', '', 'g')), '')
$$;

ALTER TABLE public.customer_fiscal_profiles
  ADD COLUMN IF NOT EXISTS bi_number text,
  ADD COLUMN IF NOT EXISTS nif_normalized text GENERATED ALWAYS AS (public.normalize_identity_doc(nif)) STORED,
  ADD COLUMN IF NOT EXISTS bi_normalized text GENERATED ALWAYS AS (public.normalize_identity_doc(bi_number)) STORED,
  ADD COLUMN IF NOT EXISTS identity_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS identity_conflict boolean NOT NULL DEFAULT false;

UPDATE public.customer_fiscal_profiles c SET identity_conflict = true
WHERE c.nif_normalized IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.customer_fiscal_profiles o
  WHERE o.user_id <> c.user_id AND o.nif_normalized = c.nif_normalized);

CREATE UNIQUE INDEX IF NOT EXISTS ux_cfp_nif_person ON public.customer_fiscal_profiles (nif_normalized)
  WHERE nif_normalized IS NOT NULL AND identity_conflict = false;
CREATE UNIQUE INDEX IF NOT EXISTS ux_cfp_bi_person ON public.customer_fiscal_profiles (bi_normalized)
  WHERE bi_normalized IS NOT NULL AND identity_conflict = false;

CREATE OR REPLACE FUNCTION public.identity_doc_valid(_nif text, _bi text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT coalesce(public.normalize_identity_doc(_bi) ~ '^[0-9]{9}[A-Z]{2}[0-9]{3}$', false)
     AND coalesce(public.normalize_identity_doc(_nif) ~ '^[0-9A-Z]{9,14}$', false)
$$;

CREATE OR REPLACE FUNCTION public.guard_identity_docs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('authenticated','anon') THEN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'identity_locked'; END IF;
    IF TG_OP = 'INSERT' AND (NEW.nif IS NOT NULL OR NEW.bi_number IS NOT NULL) THEN
      RAISE EXCEPTION 'identity_locked';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.nif IS DISTINCT FROM OLD.nif OR NEW.bi_number IS DISTINCT FROM OLD.bi_number
       OR NEW.identity_locked_at IS DISTINCT FROM OLD.identity_locked_at
       OR NEW.identity_conflict IS DISTINCT FROM OLD.identity_conflict) THEN
      RAISE EXCEPTION 'identity_locked';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_cfp_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON public.customer_fiscal_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_docs();

CREATE OR REPLACE FUNCTION public.capture_signup_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _nif text := NEW.raw_user_meta_data->>'nif'; _bi text := NEW.raw_user_meta_data->>'bi_number';
BEGIN
  IF _nif IS NULL AND _bi IS NULL THEN RETURN NEW; END IF;
  IF NOT public.identity_doc_valid(_nif, _bi) THEN RAISE EXCEPTION 'identity_invalid'; END IF;
  BEGIN
    INSERT INTO public.customer_fiscal_profiles (user_id, legal_name, nif, bi_number, email, identity_locked_at)
    VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'display_name',''), _nif, _bi, NEW.email, now());
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'identity_already_registered';
  END;
  NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'nif' - 'bi_number';
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_identity BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capture_signup_identity();

CREATE OR REPLACE FUNCTION public.identity_availability(_nif text, _bi text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.identity_doc_valid(_nif, _bi) THEN RETURN 'invalid'; END IF;
  IF EXISTS (SELECT 1 FROM public.customer_fiscal_profiles
             WHERE nif_normalized = public.normalize_identity_doc(_nif)
                OR bi_normalized = public.normalize_identity_doc(_bi)) THEN RETURN 'taken'; END IF;
  RETURN 'available';
END $$;

CREATE OR REPLACE FUNCTION public.register_my_identity(_full_name text, _nif text, _bi text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row public.customer_fiscal_profiles;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_authenticated'); END IF;
  IF length(trim(coalesce(_full_name,''))) < 5 THEN RETURN jsonb_build_object('ok',false,'error','name_required'); END IF;
  IF NOT public.identity_doc_valid(_nif, _bi) THEN RETURN jsonb_build_object('ok',false,'error','identity_invalid'); END IF;
  SELECT * INTO _row FROM public.customer_fiscal_profiles WHERE user_id = _uid FOR UPDATE;
  IF _row.identity_locked_at IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'error','identity_locked'); END IF;
  BEGIN
    IF _row.user_id IS NULL THEN
      INSERT INTO public.customer_fiscal_profiles (user_id, legal_name, nif, bi_number, identity_locked_at)
      VALUES (_uid, trim(_full_name), _nif, _bi, now());
    ELSE
      UPDATE public.customer_fiscal_profiles SET legal_name = trim(_full_name), nif = _nif, bi_number = _bi,
        identity_locked_at = now() WHERE user_id = _uid;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','identity_already_registered');
  END;
  INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
  VALUES ('identity_registered','info',_uid,_uid,'{}'::jsonb);
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION public.my_identity_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN c.identity_locked_at IS NULL THEN jsonb_build_object('registered',false)
    ELSE jsonb_build_object('registered',true,'legal_name',c.legal_name,
      'nif_masked','•••'||right(c.nif_normalized,3),'bi_masked','•••'||right(c.bi_normalized,3),
      'conflict',c.identity_conflict) END
  FROM (SELECT auth.uid() uid) u LEFT JOIN public.customer_fiscal_profiles c ON c.user_id = u.uid
$$;

CREATE OR REPLACE FUNCTION public.admin_correct_identity(_user_id uuid, _nif text, _bi text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.customer_fiscal_profiles;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
  IF length(trim(coalesce(_reason,''))) < 10 THEN RETURN jsonb_build_object('ok',false,'error','reason_required'); END IF;
  IF NOT public.identity_doc_valid(_nif, _bi) THEN RETURN jsonb_build_object('ok',false,'error','identity_invalid'); END IF;
  SELECT * INTO _row FROM public.customer_fiscal_profiles WHERE user_id = _user_id FOR UPDATE;
  IF _row.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
  BEGIN
    UPDATE public.customer_fiscal_profiles SET nif = _nif, bi_number = _bi, identity_conflict = false,
      identity_locked_at = coalesce(identity_locked_at, now()) WHERE user_id = _user_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok',false,'error','identity_already_registered');
  END;
  INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
  VALUES ('identity_corrected','warning',auth.uid(),_user_id, jsonb_build_object('reason',trim(_reason),
    'nif_before','•••'||right(_row.nif_normalized,3),'bi_before','•••'||right(_row.bi_normalized,3),
    'nif_after','•••'||right(public.normalize_identity_doc(_nif),3),'bi_after','•••'||right(public.normalize_identity_doc(_bi),3)));
  RETURN jsonb_build_object('ok',true);
END $$;

REVOKE ALL ON FUNCTION public.capture_signup_identity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.identity_availability(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_availability(text,text) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.register_my_identity(text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_my_identity(text,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.my_identity_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_identity_status() TO authenticated;
REVOKE ALL ON FUNCTION public.admin_correct_identity(uuid,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_correct_identity(uuid,text,text,text) TO authenticated;
