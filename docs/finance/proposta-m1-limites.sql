-- ============================================================================
-- PROPOSTA M1 — Gestão de Limites Financeiros (APENAS PARA REVISÃO — NÃO APLICAR)
-- Live Teká · 2026-11-07
-- Aditiva: não remove nem altera dados existentes. Preserva Angola 10.000/200.000 AOA.
-- ============================================================================

-- 1. Regras de limite por país/moeda, versionadas
CREATE TABLE public.withdrawal_limit_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_id uuid REFERENCES public.countries(id),
  currency text NOT NULL,
  min_amount numeric NOT NULL CHECK (min_amount > 0),
  max_daily_amount numeric NOT NULL CHECK (max_daily_amount >= min_amount),
  timezone text NOT NULL DEFAULT 'Africa/Luanda',
  applies_to text[] NOT NULL DEFAULT '{store,affiliate,courier}',
  combined_daily_cap boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX withdrawal_limit_rules_one_active
  ON public.withdrawal_limit_rules (country_id, currency) WHERE is_active;

GRANT SELECT ON public.withdrawal_limit_rules TO authenticated;
GRANT ALL ON public.withdrawal_limit_rules TO service_role;

ALTER TABLE public.withdrawal_limit_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_limit_rules_read ON public.withdrawal_limit_rules
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2. Histórico imutável de alterações
CREATE TABLE public.withdrawal_limit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid REFERENCES public.withdrawal_limit_rules(id),
  actor_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('created','updated','activated','suspended')),
  reason text NOT NULL,
  previous_state jsonb,
  new_state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.withdrawal_limit_history TO authenticated;
GRANT ALL ON public.withdrawal_limit_history TO service_role;

ALTER TABLE public.withdrawal_limit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY withdrawal_limit_history_read ON public.withdrawal_limit_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER withdrawal_limit_history_no_update
  BEFORE UPDATE OR DELETE ON public.withdrawal_limit_history
  FOR EACH ROW EXECUTE FUNCTION public.block_mutation();

-- 3. Resolução central de limites (fail-closed)
CREATE OR REPLACE FUNCTION public.resolve_withdrawal_limits(p_user_id uuid, p_kind text)
RETURNS public.withdrawal_limit_rules
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.*
  FROM public.withdrawal_limit_rules r
  JOIN public.profiles p ON p.id = p_user_id
  WHERE r.is_active
    AND p_kind = ANY (r.applies_to)
    AND (r.country_id IS NULL OR r.country_id = p.country_id)
    AND r.effective_from <= now()
  ORDER BY r.country_id NULLS LAST, r.effective_from DESC
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_withdrawal_limits(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_withdrawal_limits(uuid, text) TO service_role;

-- 4. Gravação administrativa de limites (validação + histórico na mesma transação)
CREATE OR REPLACE FUNCTION public.admin_save_withdrawal_limit(
  p_country_id uuid,
  p_currency text,
  p_min_amount numeric,
  p_max_daily_amount numeric,
  p_timezone text,
  p_applies_to text[],
  p_combined_daily_cap boolean,
  p_reason text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prev public.withdrawal_limit_rules;
  v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'limits.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  IF p_min_amount IS NULL OR p_min_amount <= 0 THEN
    RAISE EXCEPTION 'min_amount must be positive';
  END IF;
  IF p_max_daily_amount IS NULL OR p_max_daily_amount < p_min_amount THEN
    RAISE EXCEPTION 'max_daily_amount must be >= min_amount';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required';
  END IF;
  PERFORM 1 FROM pg_timezone_names WHERE name = p_timezone;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid timezone';
  END IF;

  SELECT * INTO v_prev FROM public.withdrawal_limit_rules
  WHERE country_id IS NOT DISTINCT FROM p_country_id AND currency = p_currency AND is_active
  FOR UPDATE;

  IF FOUND THEN
    UPDATE public.withdrawal_limit_rules SET is_active = false WHERE id = v_prev.id;
    INSERT INTO public.withdrawal_limit_history (rule_id, actor_id, action, reason, previous_state, new_state)
    VALUES (v_prev.id, auth.uid(), 'suspended', p_reason, to_jsonb(v_prev),
            jsonb_build_object('is_active', false));
  END IF;

  INSERT INTO public.withdrawal_limit_rules
    (country_id, currency, min_amount, max_daily_amount, timezone, applies_to, combined_daily_cap, created_by)
  VALUES
    (p_country_id, p_currency, p_min_amount, p_max_daily_amount, p_timezone,
     COALESCE(p_applies_to, '{store,affiliate,courier}'), COALESCE(p_combined_daily_cap, true), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.withdrawal_limit_history (rule_id, actor_id, action, reason, previous_state, new_state)
  SELECT v_id, auth.uid(),
         CASE WHEN v_prev.id IS NULL THEN 'created' ELSE 'updated' END,
         p_reason, to_jsonb(v_prev), to_jsonb(r)
  FROM public.withdrawal_limit_rules r WHERE r.id = v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_withdrawal_limit(uuid, text, numeric, numeric, text, text[], boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_save_withdrawal_limit(uuid, text, numeric, numeric, text, text[], boolean, text) TO authenticated;

-- 5. Ativar/suspender regra
CREATE OR REPLACE FUNCTION public.admin_set_withdrawal_limit_active(
  p_rule_id uuid, p_active boolean, p_reason text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_rule public.withdrawal_limit_rules;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_staff_permission(auth.uid(), 'limits.manage') THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT * INTO v_rule FROM public.withdrawal_limit_rules WHERE id = p_rule_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rule not found'; END IF;
  IF v_rule.is_active = p_active THEN RETURN; END IF; -- idempotente

  UPDATE public.withdrawal_limit_rules SET is_active = p_active WHERE id = p_rule_id;

  INSERT INTO public.withdrawal_limit_history (rule_id, actor_id, action, reason, previous_state, new_state)
  SELECT p_rule_id, auth.uid(),
         CASE WHEN p_active THEN 'activated' ELSE 'suspended' END,
         p_reason, to_jsonb(v_rule), to_jsonb(r)
  FROM public.withdrawal_limit_rules r WHERE r.id = p_rule_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_withdrawal_limit_active(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_withdrawal_limit_active(uuid, boolean, text) TO authenticated;

-- 6. Migração da regra Angola (preserva 10.000 / 200.000 AOA) — dados iniciais
-- NOTA: created_by deve ser o user_id do gestor no momento da aplicação.
INSERT INTO public.withdrawal_limit_rules
  (country_id, currency, min_amount, max_daily_amount, timezone, applies_to, combined_daily_cap, created_by)
SELECT c.id, 'AOA', 10000, 200000, 'Africa/Luanda', '{store,affiliate,courier}', true, c.id -- placeholder: substituir created_by pelo user_id do gestor
FROM public.countries c WHERE c.code = 'AO'
ON CONFLICT DO NOTHING;

-- 7. Deprecação do fallback legado (sem perda de dados)
COMMENT ON COLUMN public.financial_settings.min_withdrawal_aoa IS
  'DEPRECATED: substituído por withdrawal_limit_rules (mínimo real 10.000 AOA). Valor legado 200000 preservado apenas como histórico.';

-- 8. min_withdrawal_aoa() / max_daily_withdrawal_aoa() passam a ler a regra ativa (fail-closed)
CREATE OR REPLACE FUNCTION public.min_withdrawal_aoa()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min_amount FROM public.withdrawal_limit_rules
  WHERE currency = 'AOA' AND is_active AND effective_from <= now()
  ORDER BY country_id NULLS LAST, effective_from DESC LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.max_daily_withdrawal_aoa()
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT max_daily_amount FROM public.withdrawal_limit_rules
  WHERE currency = 'AOA' AND is_active AND effective_from <= now()
  ORDER BY country_id NULLS LAST, effective_from DESC LIMIT 1
$$;

-- NOTA: a reescrita de request_store_withdrawal / request_payout para usar
-- resolve_withdrawal_limits + teto conjunto multi-função fica para a fase de
-- implementação, com testes de concorrência, para não alterar fluxos ativos sem
-- validação em ambiente isolado.
