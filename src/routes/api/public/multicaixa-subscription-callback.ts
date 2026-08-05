import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook do Multicaixa Express para subscrições de parceiros.
 * Payload: { reference, external_id?, status: "approved" | "declined" | "pending" }
 * Cabeçalho: `x-mcx-signature: HMAC-SHA256(body, MULTICAIXA_EXPRESS_WEBHOOK_SECRET)`
 *
 * Em `approved` ativa a subscrição (o trigger `create_invoice_on_subscription_active`
 * emite a fatura real e notifica o lojista).
 */
export const Route = createFileRoute("/api/public/multicaixa-subscription-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["MULTICAIXA_EXPRESS_WEBHOOK_SECRET"];
        if (!secret) return new Response("provider_not_configured", { status: 503 });

        const raw = await request.text();
        const signature = request.headers.get("x-mcx-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid_signature", { status: 401 });
        }

        let payload: { reference?: string; external_id?: string; status?: string };
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad_json", { status: 400 });
        }
        if (!payload.reference || !payload.status) return new Response("missing_fields", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: sub, error } = await supabaseAdmin
          .from("store_subscriptions")
          .select("id, plan, status, store_id")
          .eq("reference", payload.reference)
          .maybeSingle();
        if (error) return new Response(error.message, { status: 500 });
        if (!sub) return new Response("not_found", { status: 404 });

        if (payload.status !== "approved") {
          await supabaseAdmin
            .from("store_subscriptions")
            .update({ status: payload.status === "declined" ? "rejected" : "pending", raw_payload: payload })
            .eq("id", sub.id);
          return Response.json({ ok: true, status: payload.status });
        }

        const { data: plan } = await supabaseAdmin
          .from("subscription_plans")
          .select("period_days")
          .eq("code", sub.plan)
          .maybeSingle();

        const now = new Date();
        const expires = new Date(now.getTime() + (plan?.period_days ?? 30) * 86400000);

        const { error: upErr } = await supabaseAdmin
          .from("store_subscriptions")
          .update({
            status: "active",
            started_at: now.toISOString(),
            expires_at: expires.toISOString(),
            external_id: payload.external_id ?? null,
            raw_payload: payload,
            rejection_reason: null,
          })
          .eq("id", sub.id);
        if (upErr) return new Response(upErr.message, { status: 500 });

        return Response.json({ ok: true, status: "active" });
      },
    },
  },
});