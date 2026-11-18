-- LIVE TEKÁ — FASE 1 — SQL PROPOSTO (NÃO APLICADO). Aguarda autorização por conjunto.
-- Não altera limites, comissões, M1/M2, nem marca pagamentos. Sem integração bancária.

-- ===================== CONJUNTO 1 — Identidade única (NIF + BI) =====================
-- Reutiliza customer_fiscal_profiles (0 linhas hoje, 0 NIF duplicados verificados em 18/11/2026).
ALTER TABLE public.customer_fiscal_profiles
  ADD COLUMN IF NOT EXISTS bi_number text,
  ADD COLUMN IF NOT EXISTS nif_normalized text GENERATED ALWAYS AS (upper(regexp_replace(nif,'[^0-9A-Za-z]','','g'))) STORED,
  ADD COLUMN IF NOT EXISTS bi_normalized  text GENERATED ALWAYS AS (upper(regexp_replace(bi_number,'[^0-9A-Za-z]','','g'))) STORED,
  ADD COLUMN IF NOT EXISTS identity_locked_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_nif_person ON public.customer_fiscal_profiles(nif_normalized) WHERE nif_normalized IS NOT NULL AND nif_normalized <> '';
CREATE UNIQUE INDEX IF NOT EXISTS ux_fiscal_bi_person  ON public.customer_fiscal_profiles(bi_normalized)  WHERE bi_normalized  IS NOT NULL AND bi_normalized  <> '';

-- Após primeira gravação, NIF/BI só mudam por administrador (impede troca para contornar a regra).
CREATE OR REPLACE FUNCTION public.guard_identity_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.nif IS NOT NULL AND NEW.bi_number IS NOT NULL THEN NEW.identity_locked_at := now(); END IF;
    RETURN NEW;
  END IF;
  IF OLD.identity_locked_at IS NOT NULL
     AND (NEW.nif IS DISTINCT FROM OLD.nif OR NEW.bi_number IS DISTINCT FROM OLD.bi_number)
     AND NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'identity_locked';
  END IF;
  IF OLD.identity_locked_at IS NULL AND NEW.nif IS NOT NULL AND NEW.bi_number IS NOT NULL THEN
    NEW.identity_locked_at := now();
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_identity_lock BEFORE INSERT OR UPDATE ON public.customer_fiscal_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_identity_lock();
-- RLS existente (proprietário/admin) preservada; nenhuma política alargada.

-- ===================== CONJUNTO 2 — Destino bancário imutável e estados =====================
-- Corrige colunas que admin_settle_payout já referencia mas não existem; aceita 'rejected'.
ALTER TABLE public.payout_requests
  ADD COLUMN IF NOT EXISTS bank_reference text,
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'unverified'
    CHECK (verification_state IN ('unverified','pending_bank','verified','failed')),
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS beneficiary_identity jsonb;
ALTER TABLE public.payout_requests DROP CONSTRAINT payout_requests_status_check;
ALTER TABLE public.payout_requests ADD CONSTRAINT payout_requests_status_check
  CHECK (status IN ('pending','processing','paid','cancelled','rejected'));

-- Snapshot do destino a partir dos dados registados (ignora o que o cliente enviar).
CREATE OR REPLACE FUNCTION public.snapshot_payout_destination() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.user_payment_accounts; f public.customer_fiscal_profiles;
BEGIN
  SELECT * INTO a FROM public.user_payment_accounts
   WHERE user_id=NEW.user_id AND coalesce(iban,account_number) IS NOT NULL
   ORDER BY is_default DESC, updated_at DESC LIMIT 1;
  IF a.id IS NULL THEN RAISE EXCEPTION 'bank_account_required'; END IF;
  SELECT * INTO f FROM public.customer_fiscal_profiles WHERE user_id=NEW.user_id;
  IF f.identity_locked_at IS NULL THEN RAISE EXCEPTION 'identity_required'; END IF;
  NEW.destination := jsonb_build_object('source','user_payment_accounts','account_id',a.id,
    'holder',a.account_holder,'bank',a.bank_name,'iban',a.iban,'account',a.account_number,'captured_at',now());
  NEW.beneficiary_identity := jsonb_build_object('user_id',NEW.user_id,'legal_name',f.legal_name,'nif',f.nif_normalized);
  NEW.verification_state := 'unverified'; NEW.bank_reference := NULL; NEW.verified_at := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payout_destination BEFORE INSERT ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_payout_destination();

CREATE OR REPLACE FUNCTION public.snapshot_store_withdrawal_destination() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE p public.store_private;
BEGIN
  SELECT * INTO p FROM public.store_private WHERE store_id=NEW.store_id;
  IF p.store_id IS NULL OR coalesce(p.bank_account,'')='' OR coalesce(p.bank_holder,'')='' THEN
    RAISE EXCEPTION 'bank_account_required'; END IF;
  NEW.destination := jsonb_build_object('source','store_private','holder',p.bank_holder,'bank',p.bank_name,
    'account',p.bank_account,'legal_name',p.legal_name,'nif',p.nif,'captured_at',now());
  RETURN NEW;
END $$;
CREATE TRIGGER trg_store_withdrawal_destination BEFORE INSERT ON public.store_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.snapshot_store_withdrawal_destination();

-- Imutabilidade do snapshot e dos campos submetidos.
CREATE OR REPLACE FUNCTION public.guard_withdrawal_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.destination IS DISTINCT FROM OLD.destination OR NEW.amount_aoa IS DISTINCT FROM OLD.amount_aoa THEN
    RAISE EXCEPTION 'withdrawal_snapshot_immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payout_immutable BEFORE UPDATE ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_immutable();
CREATE TRIGGER trg_store_withdrawal_immutable BEFORE UPDATE ON public.store_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.guard_withdrawal_immutable();

-- ===================== CONJUNTO 3 — Consulta administrativa auditada =====================
CREATE OR REPLACE FUNCTION public.admin_withdrawal_destination(_kind text, _id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE d jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF _kind='store' THEN SELECT destination INTO d FROM public.store_withdrawals WHERE id=_id;
  ELSE SELECT destination || jsonb_build_object('beneficiary',beneficiary_identity) INTO d FROM public.payout_requests WHERE id=_id; END IF;
  INSERT INTO public.financial_audit_log(actor_id,action,resource,resource_id,result,metadata)
  VALUES (auth.uid(),'withdrawal_destination_viewed',_kind,_id::text,CASE WHEN d IS NULL THEN 'not_found' ELSE 'ok' END,'{}');
  RETURN d;
END $$;
REVOKE ALL ON FUNCTION public.admin_withdrawal_destination(text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_withdrawal_destination(text,uuid) TO authenticated;

-- ===================== CONJUNTO 4 — Bloquear "pago" sem confirmação bancária =====================
-- admin_settle_payout deixa de poder definir status='paid'/'verified' com referência manual.
CREATE OR REPLACE FUNCTION public.guard_paid_requires_bank() RETURNS trigger
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF upper(NEW.status)='PAID' AND upper(OLD.status)<>'PAID'
     AND coalesce(current_setting('app.bank_confirmation',true),'')<>'official' THEN
    RAISE EXCEPTION 'bank_confirmation_required'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payout_paid_guard BEFORE UPDATE ON public.payout_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_requires_bank();
CREATE TRIGGER trg_store_withdrawal_paid_guard BEFORE UPDATE ON public.store_withdrawals
  FOR EACH ROW EXECUTE FUNCTION public.guard_paid_requires_bank();
-- 'app.bank_confirmation' só será definido pelo futuro adaptador oficial do Banco Atlântico.
