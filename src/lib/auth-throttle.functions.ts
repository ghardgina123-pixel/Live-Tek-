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