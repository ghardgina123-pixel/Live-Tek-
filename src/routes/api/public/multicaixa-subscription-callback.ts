import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Webhook do Multicaixa Express para subscrições de parceiros.
 * Payload: { reference, external_id?, status: "approved" | "declined" | "pending" }
 * Cabeçalho: `x-mcx-signature: HMAC-SHA256(body, MULTICAIXA_EXPRESS_WEBHOOK_SECRET)`
 *
 * Totalmente idempotente: a ativação passa por `activate_subscription_by_reference`,
 * que não repete faturas nem estende o período quando o mesmo evento chega
 * várias vezes. O e-mail de confirmação usa chave de idempotência.
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

        if (payload.status !== "approved") {
          const { data, error } = await supabaseAdmin.rpc("reject_subscription_by_reference", {
            _reference: payload.reference,
            _status: payload.status === "declined" ? "rejected" : "pending",
            _payload: payload as never,
          });
          if (error) return new Response(error.message, { status: 500 });
          const res = data as { ok?: boolean; reason?: string } | null;
          if (!res?.ok) return new Response(res?.reason ?? "not_found", { status: 404 });
          return Response.json({ ok: true, status: payload.status });
        }

        const { data, error } = await supabaseAdmin.rpc("activate_subscription_by_reference", {
          _reference: payload.reference,
          _external_id: payload.external_id ?? undefined,
          _payload: payload as never,
        });
        if (error) return new Response(error.message, { status: 500 });
        const result = data as { ok?: boolean; reason?: string; subscription_id?: string; idempotent?: boolean } | null;
        if (!result?.ok) return new Response(result?.reason ?? "not_found", { status: 404 });

        // E-mail de pagamento confirmado — só no primeiro processamento real.
        if (!result.idempotent && result.subscription_id) {
          try {
            const { sendInternalEmail } = await import("@/lib/email/dispatch.server");
            const { data: sub } = await supabaseAdmin
              .from("store_subscriptions")
              .select("id, plan, price_aoa, expires_at, store_id, stores:store_id(name, owner_id)")
              .eq("id", result.subscription_id)
              .maybeSingle();
            const store = (sub as { stores?: { name?: string; owner_id?: string } } | null)?.stores;
            const { data: plan } = await supabaseAdmin
              .from("subscription_plans")
              .select("name")
              .eq("code", (sub as { plan?: string } | null)?.plan ?? "")
              .maybeSingle();
            const { data: invoice } = await supabaseAdmin
              .from("subscription_invoices")
              .select("number")
              .eq("subscription_id", result.subscription_id)
              .order("issued_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (store?.owner_id) {
              const { data: userRes } = await supabaseAdmin.auth.admin.getUserById(store.owner_id);
              const email = userRes?.user?.email;
              if (email) {
                await sendInternalEmail({
                  templateName: "subscription-paid",
                  recipientEmail: email,
                  idempotencyKey: `sub-paid-${result.subscription_id}-${(sub as { expires_at?: string } | null)?.expires_at ?? ""}`,
                  templateData: {
                    storeName: store.name,
                    planName: plan?.name ?? (sub as { plan?: string } | null)?.plan,
                    amountAoa: (sub as { price_aoa?: number } | null)?.price_aoa,
                    expiresAt: (sub as { expires_at?: string } | null)?.expires_at,
                    invoiceNumber: invoice?.number ?? null,
                  },
                });
              }
            }
          } catch (e) {
            console.error("subscription paid email failed", e);
          }
        }

        return Response.json({ ok: true, status: "active", idempotent: result.idempotent ?? false });
      },
    },
  },
});
