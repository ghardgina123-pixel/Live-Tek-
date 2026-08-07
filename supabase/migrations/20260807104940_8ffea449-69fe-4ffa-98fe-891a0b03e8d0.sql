CREATE TABLE IF NOT EXISTS public.security_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  event text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  actor_id uuid,
  subject_id uuid,
  ip inet,
  user_agent text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_security_audit_log_time ON public.security_audit_log (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_actor ON public.security_audit_log (actor_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_log_event ON public.security_audit_log (event, occurred_at DESC);

GRANT SELECT ON public.security_audit_log TO authenticated;
GRANT ALL ON public.security_audit_log TO service_role;

ALTER TABLE public.security_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admins read security audit log" ON public.security_audit_log;
CREATE POLICY "admins read security audit log"
ON public.security_audit_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.log_security_event(
  _event text,
  _severity text DEFAULT 'info',
  _actor uuid DEFAULT NULL,
  _subject uuid DEFAULT NULL,
  _metadata jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.security_audit_log (event, severity, actor_id, subject_id, metadata)
  VALUES (_event, COALESCE(_severity,'info'), _actor, _subject, COALESCE(_metadata,'{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.log_security_event(text, text, uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_security_event(text, text, uuid, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.log_security_event(text, text, uuid, uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_event(text, text, uuid, uuid, jsonb) TO service_role;