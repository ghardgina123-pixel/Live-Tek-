-- 1. CRÍTICO: confirmação de pagamento / activação de subscrição só pelo service_role
REVOKE ALL ON FUNCTION public.confirm_payment_intent_by_reference(text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_payment_intent_by_reference(text, text, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_subscription_by_reference(text, text, jsonb, text) TO service_role;

-- 2. Funções de gatilho: não devem ser invocáveis por clientes
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype = 'trigger'::regtype
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- 3. Consultas administrativas fora do alcance de visitantes
REVOKE ALL ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_financial_transactions(text, uuid, text, timestamptz, timestamptz, integer) TO authenticated, service_role;

-- 4. Storage: posse de fotos de imóveis por caminho exacto (igual à regra de upload)
DROP POLICY IF EXISTS property_images_update_owner ON storage.objects;
DROP POLICY IF EXISTS property_images_delete_owner ON storage.objects;

CREATE POLICY property_images_update_owner ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'property-images'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.real_estate_agencies a ON a.id = p.agency_id
      WHERE a.owner_id = auth.uid()
        AND split_part(storage.objects.name, '/', 1) = p.id::text
    )
  )
)
WITH CHECK (
  bucket_id = 'property-images'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.real_estate_agencies a ON a.id = p.agency_id
      WHERE a.owner_id = auth.uid()
        AND split_part(storage.objects.name, '/', 1) = p.id::text
    )
  )
);

CREATE POLICY property_images_delete_owner ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'property-images'
  AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.real_estate_agencies a ON a.id = p.agency_id
      WHERE a.owner_id = auth.uid()
        AND split_part(storage.objects.name, '/', 1) = p.id::text
    )
  )
);