import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook do Multicaixa Express.
 *
 * Espera um payload:
 *   { reference: string, external_id: string, status: "approved" | "declined" | "pending", amount: number }
 *
 * Cabeçalho de autenticação: `x-mcx-signature: <HMAC-SHA256(body, MULTICAIXA_EXPRESS_WEBHOOK_SECRET)>`.
 * Se o segredo não estiver configurado o webhook responde 503, para que o provedor
 * repita a chamada quando a integração real estiver ativa.
 *
 * Ao receber `approved` marca o `payment_intent` como pago e coloca a `order`
 * em `paid` (o trigger `create_payout_on_paid` cria o payout com o split de 90/10).
 */
export const Route = createFileRoute("/api/public/multicaixa-callback")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { limitRequest } = await import("@/lib/rate-limit.server");
        const limited = await limitRequest(request, "api:mcx-order", 120, 60, 15);
        if (limited) return limited;
        const secret = process.env.MULTICAIXA_EXPRESS_WEBHOOK_SECRET;
        if (!secret) return new Response("provider_not_configured", { status: 503 });

        const raw = await request.text();
        const signature = request.headers.get("x-mcx-signature") ?? "";
        const expected = createHmac("sha256", secret).update(raw).digest("hex");
        const a = Buffer.from(signature);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("invalid_signature", { status: 401 });
        }

        let payload: { reference?: string; external_id?: string; status?: string; amount?: number };
        try { payload = JSON.parse(raw); } catch { return new Response("bad_json", { status: 400 }); }
        if (!payload.reference || !payload.status) return new Response("missing_fields", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        if (payload.status !== "approved") {
          const { data: intent, error } = await supabaseAdmin
            .from("payment_intents")
            .select("id, order_id")
            .eq("reference", payload.reference)
            .maybeSingle();
          if (error) return new Response(error.message, { status: 500 });
          if (!intent) return new Response("not_found", { status: 404 });
          await supabaseAdmin.from("payment_intents").update({
            status: payload.status,
            external_id: payload.external_id ?? null,
            raw_payload: payload,
          }).eq("id", intent.id);
          return Response.json({ ok: true, status: payload.status });
        }

        // Só o webhook validado pode marcar a intenção e a encomenda como pagas.
        const { data, error } = await supabaseAdmin.rpc("confirm_payment_intent_by_reference", {
          _reference: payload.reference,
          _verified_source: "multicaixa_express_webhook",
          _external_id: payload.external_id ?? undefined,
          _payload: payload as never,
        });
        if (error) return new Response(error.message, { status: 500 });
        const result = data as { ok?: boolean; reason?: string; idempotent?: boolean } | null;
        if (!result?.ok) return new Response(result?.reason ?? "not_found", { status: 404 });
        return Response.json({ ok: true, status: "paid", idempotent: result.idempotent ?? false });
      },
    },
  },
});