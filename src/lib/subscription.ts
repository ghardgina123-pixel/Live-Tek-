/**
 * Espelho puro (TypeScript) das regras de subscrição implementadas na base de
 * dados. Usado pelos testes de integração para validar idempotência do webhook,
 * transições de estado, faturação e limites de plano sem tocar na produção.
 */

export type SubscriptionStatusValue = "pending" | "active" | "rejected" | "cancelled" | "expired";

export type SubscriptionRecord = {
  id: string;
  store_id: string;
  plan: string;
  status: SubscriptionStatusValue;
  price_aoa: number;
  reference: string;
  external_id: string | null;
  started_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
};

export type InvoiceRecord = {
  subscription_id: string;
  number: string;
  amount_aoa: number;
  period_start: string;
  period_end: string | null;
  status: "paid";
};

export type PlanRecord = { code: string; name: string; period_days: number; max_lives_per_month: number | null };

export type SubscriptionState = {
  subscriptions: SubscriptionRecord[];
  invoices: InvoiceRecord[];
  plans: PlanRecord[];
  notifications: Array<{ user_id: string; kind: string; ref_id: string }>;
  emails: Array<{ template: string; idempotency_key: string }>;
};

export type WebhookEvent = {
  reference: string;
  status: "approved" | "declined" | "pending";
  external_id?: string;
};

const addDays = (from: Date, days: number) => new Date(from.getTime() + days * 86_400_000);

/** Espelha `activate_subscription_by_reference` / `reject_subscription_by_reference`. */
export function applyWebhook(
  state: SubscriptionState,
  event: WebhookEvent,
  now: Date = new Date(),
): { ok: boolean; reason?: string; idempotent?: boolean; status?: SubscriptionStatusValue } {
  const sub = state.subscriptions.find((s) => s.reference === event.reference);
  if (!sub) return { ok: false, reason: "not_found" };

  if (event.status !== "approved") {
    if (sub.status === "active") return { ok: true, status: "active", idempotent: true };
    sub.status = event.status === "declined" ? "rejected" : "pending";
    return { ok: true, status: sub.status };
  }

  const stillValid = sub.expires_at === null || new Date(sub.expires_at) > now;
  if (sub.status === "active" && stillValid) {
    return { ok: true, status: "active", idempotent: true };
  }

  const plan = state.plans.find((p) => p.code === sub.plan);
  const periodDays = plan?.period_days ?? 30;
  const startedAt = sub.started_at ?? now.toISOString();

  sub.status = "active";
  sub.started_at = startedAt;
  sub.expires_at = addDays(now, periodDays).toISOString();
  sub.external_id = event.external_id ?? sub.external_id;
  sub.cancelled_at = null;

  issueInvoice(state, sub, plan ?? null);
  return { ok: true, status: "active", idempotent: false };
}

/** Espelha o trigger `create_invoice_on_subscription_active` (único por período). */
export function issueInvoice(state: SubscriptionState, sub: SubscriptionRecord, plan: PlanRecord | null) {
  const periodStart = sub.started_at!;
  const exists = state.invoices.some((i) => i.subscription_id === sub.id && i.period_start === periodStart);
  if (exists) return;
  state.invoices.push({
    subscription_id: sub.id,
    number: `FT-${new Date().getFullYear()}/${String(state.invoices.length + 1).padStart(6, "0")}`,
    amount_aoa: sub.price_aoa,
    period_start: periodStart,
    period_end: sub.expires_at,
    status: "paid",
  });
  state.notifications.push({ user_id: sub.store_id, kind: "subscription.active", ref_id: sub.id });
}

/** Espelha `cancel_store_subscription`: histórico preservado, acesso cortado. */
export function cancelSubscription(state: SubscriptionState, storeId: string, now: Date = new Date()) {
  const sub = state.subscriptions.find(
    (s) => s.store_id === storeId && (s.status === "active" || s.status === "pending"),
  );
  if (!sub) return { ok: false, reason: "no_subscription" as const };
  sub.status = "cancelled";
  sub.cancelled_at = now.toISOString();
  sub.expires_at = now.toISOString();
  return { ok: true as const, status: sub.status };
}

/** Espelha `expire_due_subscriptions`. */
export function expireDue(state: SubscriptionState, now: Date = new Date()): number {
  let count = 0;
  for (const s of state.subscriptions) {
    if (s.status === "active" && s.expires_at && new Date(s.expires_at) <= now) {
      s.status = "expired";
      count += 1;
    }
  }
  return count;
}

/** Espelha `store_subscription_status`. */
export function subscriptionStatus(
  state: SubscriptionState,
  storeId: string,
  partnerType: "retail" | "service",
  now: Date = new Date(),
) {
  const sub = state.subscriptions.find(
    (s) => s.store_id === storeId && s.status === "active" && (!s.expires_at || new Date(s.expires_at) > now),
  );
  const active = Boolean(sub);
  return {
    subscription_required: partnerType === "service",
    subscription_status: active ? ("active" as const) : ("inactive" as const),
    plan_code: sub?.plan ?? null,
    expires_at: sub?.expires_at ?? null,
    can_go_live: partnerType !== "service" || active,
  };
}

/** Espelha `store_live_usage` + o bloqueio do trigger `enforce_live_subscription`. */
export function liveUsage(state: SubscriptionState, storeId: string, livesThisMonth: number, now: Date = new Date()) {
  const sub = state.subscriptions.find(
    (s) => s.store_id === storeId && s.status === "active" && (!s.expires_at || new Date(s.expires_at) > now),
  );
  const plan = sub ? (state.plans.find((p) => p.code === sub.plan) ?? null) : null;
  // Lives ilimitadas em todos os planos.
  const limit = null;
  return {
    plan_code: plan?.code ?? null,
    used: livesThisMonth,
    limit,
    unlimited: true,
    remaining: null,
  };
}

export function canCreateLive(
  state: SubscriptionState,
  storeId: string,
  partnerType: "retail" | "service",
  livesThisMonth: number,
  now: Date = new Date(),
): { allowed: boolean; error?: "subscription_inactive" | "live_limit_reached" } {
  const status = subscriptionStatus(state, storeId, partnerType, now);
  if (!status.can_go_live) return { allowed: false, error: "subscription_inactive" };
  const usage = liveUsage(state, storeId, livesThisMonth, now);
  if (usage.limit !== null && usage.used >= usage.limit) return { allowed: false, error: "live_limit_reached" };
  return { allowed: true };
}

/** Idempotência de e-mail: a mesma chave nunca é enviada duas vezes. */
export function queueEmail(state: SubscriptionState, template: string, idempotencyKey: string) {
  if (state.emails.some((e) => e.idempotency_key === idempotencyKey)) return false;
  state.emails.push({ template, idempotency_key: idempotencyKey });
  return true;
}
