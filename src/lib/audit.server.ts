// Server-only audit trail helper. Writes to public.security_audit_log through
// the service-role client, so audit entries cannot be forged or deleted by
// clients (RLS only exposes read access to admins).

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEvent = {
  event: string;
  severity?: AuditSeverity;
  actorId?: string | null;
  subjectId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * Records a critical security event. Never throws — auditing must not break
 * the request it observes, but failures are logged for platform diagnostics.
 */
export async function recordSecurityEvent(entry: AuditEvent): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("security_audit_log").insert({
      event: entry.event,
      severity: entry.severity ?? "info",
      actor_id: entry.actorId ?? null,
      subject_id: entry.subjectId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      metadata: (entry.metadata ?? {}) as never,
    });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (err) {
    console.error("[audit] unavailable:", err);
  }
}

/** Extracts caller network metadata from an incoming request, if available. */
export function requestAuditMeta(request?: Request | null) {
  if (!request) return { ip: null, userAgent: null };
  const fwd = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for");
  return {
    ip: fwd ? (fwd.split(",")[0]?.trim() ?? null) : null,
    userAgent: request.headers.get("user-agent"),
  };
}