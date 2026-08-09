import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

/**
 * Tarefa agendada (pg_cron) que expira subscrições vencidas e envia o e-mail
 * de expiração ao parceiro. Autenticada por Bearer com PUSH_WEBHOOK_SECRET.
 * Idempotente: cada subscrição só gera um e-mail por período.
 */
export const Route = createFileRoute("/api/public/subscription-cron")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { limitRequest } = await import("@/lib/rate-limit.server");
        const limited = await limitRequest(request, "api:sub-cron", 120, 60, 15);
        if (limited) return limited;
        const secret = process.env["PUSH_WEBHOOK_SECRET"];
        if (!secret) return new Response("not_configured", { status: 503 });
        const provided = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
        const a = Buffer.from(provided);
        const b = Buffer.from(secret);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendInternalEmail } = await import("@/lib/email/dispatch.server");

        const { data: expiredCount, error } = await supabaseAdmin.rpc("expire_due_subscriptions");
        if (error) return new Response(error.message, { status: 500 });

        // Avisos de renovação 15/7/3/1/0 dias (idempotentes por marco e ciclo).
        const { data: noticeCount } = await supabaseAdmin.rpc("subscription_renewal_notices");

        const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
        const { data: rows } = await supabaseAdmin
          .from("store_subscriptions")
          .select("id, plan, expires_at, updated_at, store_id, stores:store_id(name, owner_id)")
          .in("status", ["grace", "suspended", "expired"])
          .gte("updated_at", since);

        let emailed = 0;
        for (const row of (rows ?? []) as Array<{
          id: string;
          plan: string;
          expires_at: string | null;
          stores?: { name?: string; owner_id?: string } | null;
        }>) {
          const ownerId = row.stores?.owner_id;
          if (!ownerId) continue;
          const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(ownerId);
          const email = userRes?.user?.email;
          if (!email) continue;
          const { data: plan } = await supabaseAdmin
            .from("subscription_plans")
            .select("name")
            .eq("code", row.plan)
            .maybeSingle();
          const res = await sendInternalEmail({
            templateName: "subscription-expired",
            recipientEmail: email,
            idempotencyKey: `sub-expired-${row.id}-${row.expires_at ?? ""}`,
            templateData: { storeName: row.stores?.name, planName: plan?.name ?? row.plan, expiresAt: row.expires_at },
          });
          if (res.sent) emailed += 1;
        }

        return Response.json({ ok: true, expired: expiredCount ?? 0, notices: noticeCount ?? 0, emailed });
      },
    },
  },
});
