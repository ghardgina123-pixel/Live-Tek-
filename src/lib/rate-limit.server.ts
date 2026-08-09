// Limitador de abuso partilhado (server-only). O contador vive na base de
// dados porque o worker é stateless; a função `rate_limit_hit` está restrita
// ao service_role.
export type RateLimitResult = { blocked: boolean; retryAfterSeconds: number };

export async function limitByKey(
  key: string,
  max: number,
  windowMinutes: number,
  blockMinutes: number,
): Promise<RateLimitResult> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("rate_limit_hit", {
      _key: key,
      _max_attempts: max,
      _window_minutes: windowMinutes,
      _block_minutes: blockMinutes,
    });
    const out = (data ?? {}) as { blocked?: boolean; retry_after_seconds?: number };
    return { blocked: !!out.blocked, retryAfterSeconds: out.retry_after_seconds ?? 0 };
  } catch (e) {
    console.error("rate_limit_hit failed", e);
    return { blocked: false, retryAfterSeconds: 0 };
  }
}

export function clientIp(request: Request): string {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

/** Limita por IP e devolve uma Response 429 pronta a devolver, ou null. */
export async function limitRequest(
  request: Request,
  prefix: string,
  max: number,
  windowMinutes: number,
  blockMinutes: number,
): Promise<Response | null> {
  const res = await limitByKey(`${prefix}:${clientIp(request)}`, max, windowMinutes, blockMinutes);
  if (!res.blocked) return null;
  return new Response(JSON.stringify({ error: "rate_limited", retry_after: res.retryAfterSeconds }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(res.retryAfterSeconds) },
  });
}
