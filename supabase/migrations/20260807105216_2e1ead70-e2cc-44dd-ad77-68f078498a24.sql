CREATE TABLE IF NOT EXISTS public.login_attempts (
  key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  first_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

GRANT ALL ON public.login_attempts TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_login_throttle(_keys text[])
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_until timestamptz;
BEGIN
  SELECT MAX(blocked_until) INTO v_until
    FROM public.login_attempts
   WHERE key = ANY(_keys) AND blocked_until IS NOT NULL AND blocked_until > now();
  IF v_until IS NULL THEN
    RETURN jsonb_build_object('blocked', false, 'retry_after_seconds', 0);
  END IF;
  RETURN jsonb_build_object(
    'blocked', true,
    'retry_after_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_until - now())))::int)
  );
END; $$;

CREATE OR REPLACE FUNCTION public.register_login_failure(
  _keys text[],
  _max_attempts integer DEFAULT 5,
  _window_minutes integer DEFAULT 15,
  _block_minutes integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE k text; v_row record; v_blocked boolean := false; v_until timestamptz;
BEGIN
  FOREACH k IN ARRAY _keys LOOP
    INSERT INTO public.login_attempts (key, attempts, first_attempt_at, last_attempt_at)
    VALUES (k, 1, now(), now())
    ON CONFLICT (key) DO UPDATE
      SET attempts = CASE
            WHEN public.login_attempts.first_attempt_at < now() - make_interval(mins => _window_minutes)
            THEN 1 ELSE public.login_attempts.attempts + 1 END,
          first_attempt_at = CASE
            WHEN public.login_attempts.first_attempt_at < now() - make_interval(mins => _window_minutes)
            THEN now() ELSE public.login_attempts.first_attempt_at END,
          last_attempt_at = now()
    RETURNING * INTO v_row;

    IF v_row.attempts >= _max_attempts THEN
      UPDATE public.login_attempts
         SET blocked_until = now() + make_interval(mins => _block_minutes), attempts = 0, first_attempt_at = now()
       WHERE key = k
       RETURNING blocked_until INTO v_until;
      v_blocked := true;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'blocked', v_blocked,
    'retry_after_seconds', CASE WHEN v_until IS NULL THEN 0
      ELSE GREATEST(1, CEIL(EXTRACT(EPOCH FROM (v_until - now())))::int) END
  );
END; $$;

CREATE OR REPLACE FUNCTION public.clear_login_attempts(_keys text[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ DELETE FROM public.login_attempts WHERE key = ANY(_keys) $$;

REVOKE ALL ON FUNCTION public.check_login_throttle(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_login_throttle(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.check_login_throttle(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.check_login_throttle(text[]) TO service_role;

REVOKE ALL ON FUNCTION public.register_login_failure(text[], integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_login_failure(text[], integer, integer, integer) FROM anon;
REVOKE ALL ON FUNCTION public.register_login_failure(text[], integer, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_login_failure(text[], integer, integer, integer) TO service_role;

REVOKE ALL ON FUNCTION public.clear_login_attempts(text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_login_attempts(text[]) FROM anon;
REVOKE ALL ON FUNCTION public.clear_login_attempts(text[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.clear_login_attempts(text[]) TO service_role;