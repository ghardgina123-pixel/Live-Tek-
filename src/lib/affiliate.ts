import { supabase } from "@/integrations/supabase/client";

const PENDING_KEY = "lm:ref";

/** Percentagens oficiais do programa (espelham os gatilhos da base de dados). */
export const AFFILIATE_RULES = {
  signupBonusAoa: 500,
  buyerOrderPct: 1,
  storeOrderPct: 5,
  subscriptionPct: 10,
} as const;

/** Guarda o código `?ref=` presente no URL para usar depois do registo/login. */
export function captureRefFromUrl() {
  if (typeof window === "undefined") return;
  const code = new URLSearchParams(window.location.search).get("ref");
  if (!code) return;
  try { localStorage.setItem(PENDING_KEY, code.trim().toUpperCase()); } catch { /* noop */ }
}

export function pendingRef(): string | null {
  if (typeof window === "undefined") return null;
  try { return localStorage.getItem(PENDING_KEY); } catch { return null; }
}

/** Regista a indicação assim que existe sessão. Idempotente do lado da BD. */
export async function consumePendingReferral() {
  const code = pendingRef();
  if (!code) return;
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return;
  const { error } = await supabase.rpc("affiliate_register_referral", { _code: code });
  if (!error) {
    try { localStorage.removeItem(PENDING_KEY); } catch { /* noop */ }
  }
}

export function affiliateLink(code: string) {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://www.livemarketplece.live";
  return `${origin}/cadastro?ref=${code}`;
}