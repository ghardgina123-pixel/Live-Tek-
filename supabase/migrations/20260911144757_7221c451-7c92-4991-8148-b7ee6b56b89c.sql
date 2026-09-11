ALTER TABLE public.platform_fiscal_identity
  ADD COLUMN IF NOT EXISTS entity_type text,
  ADD COLUMN IF NOT EXISTS vat_regime text;

CREATE OR REPLACE FUNCTION public.fiscal_snapshot_platform()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'kind', 'platform',
    'legal_name', p.legal_name,
    'trade_name', p.trade_name,
    'nif', p.nif,
    'fiscal_address', p.fiscal_address,
    'province', p.province,
    'municipality', p.municipality,
    'country_code', p.country_code,
    'email', p.email,
    'phone', p.phone,
    'entity_type', p.entity_type,
    'tax_regime', p.tax_regime,
    'vat_regime', p.vat_regime,
    'currency_code', p.currency_code,
    'configured', p.is_active,
    'snapshot_at', to_jsonb(now())
  ))
  FROM public.platform_fiscal_identity p
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.fiscal_snapshot_platform() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_snapshot_platform() TO service_role;

COMMENT ON COLUMN public.platform_fiscal_identity.vat_regime IS
  'Regime de IVA confirmado. NULL significa não verificado; nunca deve ser inferido.';