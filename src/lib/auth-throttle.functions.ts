import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Anti-brute-force para o login. O contador vive na base de dados (worker é
// stateless) e é manipulado apenas por este endpoint de servidor: 5 falhas em
// 15 minutos bloqueiam a combinação email+IP durante 15 minutos.
const emailInput = z.object({ email: z.string().trim().toLowerCase().email().max(255) });

export const checkLoginThrottle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => emailInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { requestAuditMeta } = await import("./audit.server");
    const { ip } = requestAuditMeta(getRequest());
    const keys = [`email:${data.email}`, ...(ip ? [`ip:${ip}`] : [])];
    const { data: res } = await supabaseAdmin.rpc("check_login_throttle", { _keys: keys });
    const out = (res ?? {}) as { blocked?: boolean; retry_after_seconds?: number };
    return { blocked: !!out.blocked, retryAfterSeconds: out.retry_after_seconds ?? 0 };
  });

export const registerLoginFailure = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => emailInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { recordSecurityEvent, requestAuditMeta } = await import("./audit.server");
    const meta = requestAuditMeta(getRequest());
    const keys = [`email:${data.email}`, ...(meta.ip ? [`ip:${meta.ip}`] : [])];
    const { data: res } = await supabaseAdmin.rpc("register_login_failure", { _keys: keys });
    const out = (res ?? {}) as { blocked?: boolean; retry_after_seconds?: number };
    await recordSecurityEvent({
      event: out.blocked ? "auth.login_blocked" : "auth.login_failed",
      severity: out.blocked ? "critical" : "warning",
      metadata: { email: data.email },
      ...meta,
    });
    return { blocked: !!out.blocked, retryAfterSeconds: out.retry_after_seconds ?? 0 };
  });

export const clearLoginThrottle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => emailInput.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { recordSecurityEvent, requestAuditMeta } = await import("./audit.server");
    const meta = requestAuditMeta(getRequest());
    const keys = [`email:${data.email}`, ...(meta.ip ? [`ip:${meta.ip}`] : [])];
    await supabaseAdmin.rpc("clear_login_attempts", { _keys: keys });
    await recordSecurityEvent({
      event: "auth.login_success",
      severity: "info",
      metadata: { email: data.email },
      ...meta,
    });
    return { ok: true };
  });
// Limitador genérico para acções sensíveis não autenticadas (cadastro,
// recuperação de palavra-passe, etc.). Chave por IP + identificador opcional.
export const checkActionThrottle = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        action: z.enum(["signup", "password_reset", "contact"]),
        identifier: z.string().trim().toLowerCase().max(255).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const { limitByKey } = await import("./rate-limit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const { requestAuditMeta, recordSecurityEvent } = await import("./audit.server");
    const meta = requestAuditMeta(getRequest());
    const limits: Record<string, [number, number, number]> = {
      signup: [5, 60, 60],
      password_reset: [5, 60, 60],
      contact: [10, 60, 30],
    };
    const [max, windowMin, blockMin] = limits[data.action] ?? [10, 60, 30];
    const keys = [
      `${data.action}:ip:${meta.ip ?? "unknown"}`,
      ...(data.identifier ? [`${data.action}:id:${data.identifier}`] : []),
    ];
    let blocked = false;
    let retryAfterSeconds = 0;
    for (const key of keys) {
      const res = await limitByKey(key, max, windowMin, blockMin);
      if (res.blocked) {
        blocked = true;
        retryAfterSeconds = Math.max(retryAfterSeconds, res.retryAfterSeconds);
      }
    }
    if (blocked) {
      await recordSecurityEvent({
        event: `abuse.${data.action}_blocked`,
        severity: "warning",
        metadata: { identifier: data.identifier ?? null },
        ...meta,
      });
    }
    return { blocked, retryAfterSeconds };
  });
