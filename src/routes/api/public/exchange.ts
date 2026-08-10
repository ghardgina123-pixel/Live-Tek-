import { createFileRoute } from "@tanstack/react-router";

// Endpoint público de câmbios (dados reais, sem simulação).
// GET  /api/public/exchange -> devolve as taxas guardadas
// POST /api/public/exchange -> obtém as taxas reais do fornecedor e grava-as
//                              (protegido por CRON_SECRET + rate limit)

const BASE = "AOA";
const PROVIDER = "open.er-api.com";

type ProviderResponse = { result?: string; rates?: Record<string, number> };

/** Obtém as taxas reais 1 AOA -> moeda, para as moedas usadas na plataforma. */
async function fetchRealRates(targets: string[]) {
  const res = await fetch(`https://open.er-api.com/v6/latest/${BASE}`);
  if (!res.ok) throw new Error(`provider_error_${res.status}`);
  const payload = (await res.json()) as ProviderResponse;
  if (payload.result !== "success" || !payload.rates) throw new Error("provider_invalid_payload");
  const now = new Date().toISOString();
  return targets
    .filter((to) => to !== BASE && typeof payload.rates?.[to] === "number")
    .map((to) => ({
      from_currency: BASE,
      to_currency: to,
      rate: Number(payload.rates![to]!.toFixed(8)),
      source: PROVIDER,
      updated_at: now,
    }));
}

export const Route = createFileRoute("/api/public/exchange")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin
          .from("exchange_rates")
          .select("from_currency, to_currency, rate, source, updated_at")
          .order("from_currency");
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ rates: data ?? [] });
      },

      POST: async ({ request }) => {
        const { limitRequest } = await import("@/lib/rate-limit.server");
        const limited = await limitRequest(request, "api:exchange", 30, 60, 30);
        if (limited) return limited;
        const expected = process.env.CRON_SECRET;
        if (!expected) {
          return new Response(JSON.stringify({ error: "CRON_SECRET not configured" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          });
        }
        const provided = request.headers.get("x-cron-secret") ?? "";
        const a = Buffer.from(provided);
        const b = Buffer.from(expected);
        const { timingSafeEqual } = await import("crypto");
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // As moedas cobertas são as configuradas nos países ativos.
        const { data: countries } = await supabaseAdmin
          .from("countries")
          .select("currency_code")
          .eq("active", true);
        const targets = Array.from(
          new Set([
            ...(countries ?? []).map((c) => c.currency_code).filter((c): c is string => !!c),
            "USD",
            "EUR",
            "BRL",
            "ZAR",
          ]),
        );

        let rows: Awaited<ReturnType<typeof fetchRealRates>>;
        try {
          rows = await fetchRealRates(targets);
        } catch (e) {
          const message = e instanceof Error ? e.message : "provider_error";
          return new Response(JSON.stringify({ error: message }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        if (rows.length === 0) {
          return new Response(JSON.stringify({ error: "no_rates_returned" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          });
        }
        const { error } = await supabaseAdmin
          .from("exchange_rates")
          .upsert(rows, { onConflict: "from_currency,to_currency" });
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        return Response.json({ updated: rows.length, rates: rows });
      },

    },
  },
});
