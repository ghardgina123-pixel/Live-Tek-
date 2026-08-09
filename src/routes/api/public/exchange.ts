import { createFileRoute } from "@tanstack/react-router";

// Public endpoint to read and refresh exchange rates.
// GET  /api/public/exchange           -> returns all stored rates
// POST /api/public/exchange           -> simulates a fetch from a provider
//                                        and upserts rates (mock data).
//
// In production the POST handler should call a real provider (e.g. openexchangerates,
// exchangerate.host, BNA) and validate a shared secret. Here we ship a deterministic
// mock so the rest of the stack can be wired up.

const BASE = "AOA";
const TARGETS = ["USD", "EUR", "BRL", "ZAR"] as const;

// Indicative central rates (1 AOA = X target). We add tiny random noise so the
// "refresh" looks alive in dashboards.
const CENTRAL: Record<(typeof TARGETS)[number], number> = {
  USD: 0.0011,
  EUR: 0.00102,
  BRL: 0.0061,
  ZAR: 0.0205,
};

function mockFetchRates() {
  const now = new Date().toISOString();
  return TARGETS.map((to) => {
    const noise = 1 + (Math.random() - 0.5) * 0.02; // +/- 1%
    const rate = +(CENTRAL[to] * noise).toFixed(8);
    return { from_currency: BASE, to_currency: to, rate, source: "mock", updated_at: now };
  });
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
        const rows = mockFetchRates();
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
