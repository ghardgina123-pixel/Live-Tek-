ALTER TABLE public.customer_fiscal_profiles ADD COLUMN IF NOT EXISTS company_nif text;
COMMENT ON COLUMN public.customer_fiscal_profiles.company_nif IS 'Optional NIF of a represented company. Not a personal identifier or unique key; never automatically copied from historical nif or to stores.';
COMMENT ON COLUMN public.customer_fiscal_profiles.nif IS 'Existing customer fiscal NIF retained unchanged for fiscal compatibility. Not the company_nif field and no longer a personal uniqueness key.';
CREATE UNIQUE INDEX ux_cfp_bi_identity ON public.customer_fiscal_profiles (bi_normalized) WHERE bi_normalized IS NOT NULL;
DROP INDEX IF EXISTS public.ux_cfp_nif_person;
DROP INDEX IF EXISTS public.ux_cfp_bi_person;
CREATE OR REPLACE FUNCTION public.identity_doc_valid(_nif text, _bi text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT coalesce(public.normalize_identity_doc(_bi) ~ '^[0-9]{9}[A-Z]{2}[0-9]{3}$', false)
 AND (public.normalize_identity_doc(_nif) IS NULL OR public.normalize_identity_doc(_nif) ~ '^[0-9A-Z]{9,14}$')
$$;
CREATE OR REPLACE FUNCTION public.guard_identity_docs()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF current_user IN ('authenticated','anon') THEN
 IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'identity_locked'; END IF;
 IF TG_OP = 'INSERT' AND (NEW.nif IS NOT NULL OR NEW.bi_number IS NOT NULL OR NEW.company_nif IS NOT NULL) THEN RAISE EXCEPTION 'identity_locked'; END IF;
 IF TG_OP = 'UPDATE' AND (NEW.nif IS DISTINCT FROM OLD.nif OR NEW.bi_number IS DISTINCT FROM OLD.bi_number
 OR NEW.company_nif IS DISTINCT FROM OLD.company_nif
 OR NEW.identity_locked_at IS DISTINCT FROM OLD.identity_locked_at
 OR NEW.identity_conflict IS DISTINCT FROM OLD.identity_conflict) THEN RAISE EXCEPTION 'identity_locked'; END IF;
 END IF;
 IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.capture_signup_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _legacy_nif text := NEW.raw_user_meta_data->>'nif';
 _company_nif text := NEW.raw_user_meta_data->>'company_nif';
 _bi text := NEW.raw_user_meta_data->>'bi_number';
BEGIN
 IF _legacy_nif IS NULL AND _company_nif IS NULL AND _bi IS NULL THEN RETURN NEW; END IF;
 IF NOT public.identity_doc_valid(_company_nif, _bi) OR NOT public.identity_doc_valid(_legacy_nif, _bi) THEN RAISE EXCEPTION 'identity_invalid'; END IF;
 BEGIN
 INSERT INTO public.customer_fiscal_profiles (user_id, legal_name, nif, company_nif, bi_number, email, identity_locked_at)
 VALUES (NEW.id, coalesce(NEW.raw_user_meta_data->>'display_name',''), _legacy_nif,
 public.normalize_identity_doc(_company_nif), public.normalize_identity_doc(_bi), NEW.email, now());
 EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'identity_already_registered';
 END;
 NEW.raw_user_meta_data := NEW.raw_user_meta_data - 'nif' - 'company_nif' - 'bi_number';
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.identity_availability(_nif text, _bi text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF NOT public.identity_doc_valid(_nif, _bi) THEN RETURN 'invalid'; END IF;
 IF EXISTS (SELECT 1 FROM public.customer_fiscal_profiles WHERE bi_normalized = public.normalize_identity_doc(_bi)) THEN RETURN 'taken'; END IF;
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
 INSERT INTO public.customer_fiscal_profiles (user_id, legal_name, company_nif, bi_number, identity_locked_at)
 VALUES (_uid, trim(_full_name), public.normalize_identity_doc(_nif), public.normalize_identity_doc(_bi), now());
 ELSE
 UPDATE public.customer_fiscal_profiles SET legal_name = trim(_full_name), company_nif = public.normalize_identity_doc(_nif),
 bi_number = public.normalize_identity_doc(_bi), identity_locked_at = now() WHERE user_id = _uid;
 END IF;
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','identity_already_registered');
 END;
 INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
 VALUES ('identity_registered','info',_uid,_uid,'{}'::jsonb);
 RETURN jsonb_build_object('ok',true);
END $$;
CREATE OR REPLACE FUNCTION public.my_identity_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT CASE WHEN c.identity_locked_at IS NULL THEN jsonb_build_object('registered',false)
 ELSE jsonb_build_object('registered',true,'legal_name',c.legal_name,
 'nif_masked','•••'||right(c.nif_normalized,3),
 'company_nif_masked',CASE WHEN c.company_nif IS NULL THEN NULL ELSE '•••'||right(c.company_nif,3) END,
 'bi_masked','•••'||right(c.bi_normalized,3),'conflict',c.identity_conflict) END
 FROM (SELECT auth.uid() uid) u LEFT JOIN public.customer_fiscal_profiles c ON c.user_id = u.uid
$$;
CREATE OR REPLACE FUNCTION public.admin_correct_identity(_user_id uuid, _nif text, _bi text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row public.customer_fiscal_profiles;
BEGIN
 IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(),'admin') THEN RETURN jsonb_build_object('ok',false,'error','forbidden'); END IF;
 IF length(trim(coalesce(_reason,''))) < 10 THEN RETURN jsonb_build_object('ok',false,'error','reason_required'); END IF;
 IF NOT public.identity_doc_valid(_nif, _bi) THEN RETURN jsonb_build_object('ok',false,'error','identity_invalid'); END IF;
 SELECT * INTO _row FROM public.customer_fiscal_profiles WHERE user_id = _user_id FOR UPDATE;
 IF _row.user_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','not_found'); END IF;
 BEGIN
 UPDATE public.customer_fiscal_profiles SET company_nif = public.normalize_identity_doc(_nif), bi_number = public.normalize_identity_doc(_bi),
 identity_conflict = false, identity_locked_at = coalesce(identity_locked_at, now()) WHERE user_id = _user_id;
 EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('ok',false,'error','identity_already_registered');
 END;
 INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
 VALUES ('identity_corrected','warning',auth.uid(),_user_id, jsonb_build_object('reason',trim(_reason),
 'company_nif_before',CASE WHEN _row.company_nif IS NULL THEN NULL ELSE '•••'||right(_row.company_nif,3) END,
 'bi_before','•••'||right(_row.bi_normalized,3),
 'company_nif_after',CASE WHEN public.normalize_identity_doc(_nif) IS NULL THEN NULL ELSE '•••'||right(public.normalize_identity_doc(_nif),3) END,
 'bi_after','•••'||right(public.normalize_identity_doc(_bi),3)));
 RETURN jsonb_build_object('ok',true);
END $$;