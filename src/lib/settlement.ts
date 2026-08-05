/**
 * Modelo de liquidação do lojista.
 *
 * Espelha, em TypeScript puro, o contrato implementado na base de dados:
 *  - `store_commission_pct`  → retalho 10%, serviços 0%
 *  - `calc_transaction_split` → bruto / taxa da plataforma / líquido
 *  - `create_payout_on_paid`  → pedido `paid` cria repasse `pending`
 *  - `release_payout_on_delivered` → pedido `delivered` liberta o repasse
 *  - `store_balance`          → agregação em compensação / disponível / taxas
 *
 * O painel do lojista consome estas funções, por isso os testes de integração
 * validam exactamente os números apresentados na interface.
 */

export type PartnerType = "retail" | "service";
export type OrderStatus = "pending" | "paid" | "preparing" | "shipped" | "delivered" | "cancelled";
export type PayoutStatus = "pending" | "released" | "failed";

export type TransactionSplit = {
  gross_aoa: number;
  commission_pct: number;
  platform_fee_aoa: number;
  net_aoa: number;
};

export type Payout = {
  order_id: string;
  status: PayoutStatus;
  gross_aoa: number;
  commission_pct: number;
  platform_fee_aoa: number;
  net_aoa: number;
};

export type OrderLike = { id: string; total_aoa: number; status: string; created_at: string };
export type PayoutLike = { net_aoa: number; status: string };

export type StoreBalance = {
  partner_type: PartnerType;
  commission_pct: number;
  pending_clearance_aoa: number;
  available_aoa: number;
  platform_fees_aoa: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Estados em que o pedido já conta como receita realizada. */
export const PAID_STATUSES: OrderStatus[] = ["paid", "preparing", "shipped", "delivered"];

/** Transições de estado permitidas (igual a `guard_order_status_transition`). */
export const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

export function storeCommissionPct(partnerType: PartnerType): number {
  return partnerType === "service" ? 0 : 10;
}

export function calcTransactionSplit(partnerType: PartnerType, amountAoa: number): TransactionSplit {
  const gross = round2(amountAoa);
  const pct = storeCommissionPct(partnerType);
  const fee = round2((gross * pct) / 100);
  return { gross_aoa: gross, commission_pct: pct, platform_fee_aoa: fee, net_aoa: round2(gross - fee) };
}

/**
 * Aplica uma transição de estado ao pedido e devolve o repasse resultante,
 * replicando os triggers `create_payout_on_paid` e `release_payout_on_delivered`.
 */
export function applyOrderTransition(input: {
  orderId: string;
  partnerType: PartnerType;
  totalAoa: number;
  from: OrderStatus;
  to: OrderStatus;
  payout: Payout | null;
}): { status: OrderStatus; payout: Payout | null } {
  const { orderId, partnerType, totalAoa, from, to } = input;
  if (from === to) return { status: from, payout: input.payout };
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new Error(`order_status_not_allowed:${from}->${to}`);
  }

  let payout = input.payout;
  const split = calcTransactionSplit(partnerType, totalAoa);

  if (to === "paid" && !payout) {
    payout = { order_id: orderId, status: "pending", ...split };
  }
  if (to === "delivered") {
    payout = { order_id: orderId, status: "released", ...split };
  }
  return { status: to, payout };
}

/** Agrega repasses no saldo mostrado ao lojista (igual a `store_balance`). */
export function summarizeStoreBalance(partnerType: PartnerType, payouts: Payout[]): StoreBalance {
  const sum = (f: (p: Payout) => number, filter: (p: Payout) => boolean) =>
    round2(payouts.filter(filter).reduce((s, p) => s + Number(f(p) || 0), 0));

  return {
    partner_type: partnerType,
    commission_pct: storeCommissionPct(partnerType),
    pending_clearance_aoa: sum((p) => p.net_aoa, (p) => p.status === "pending"),
    available_aoa: sum((p) => p.net_aoa, (p) => p.status === "released"),
    platform_fees_aoa: sum((p) => p.platform_fee_aoa, () => true),
  };
}

/** Estatísticas do painel "Visão Geral" do lojista. */
export function computeDashboardStats(orders: OrderLike[], payouts: PayoutLike[], today = new Date()) {
  const paid = orders.filter((o) => (PAID_STATUSES as string[]).includes(o.status));
  const daily: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    daily[d.toISOString().slice(0, 10)] = 0;
  }
  paid.forEach((o) => {
    const k = new Date(o.created_at).toISOString().slice(0, 10);
    if (k in daily) daily[k] += Number(o.total_aoa);
  });

  return {
    orders: orders.length,
    ordersPaid: paid.length,
    revenue: round2(paid.reduce((s, o) => s + Number(o.total_aoa), 0)),
    payoutsPending: round2(
      payouts.filter((p) => p.status === "pending").reduce((s, p) => s + Number(p.net_aoa), 0),
    ),
    payoutsReleased: round2(
      payouts.filter((p) => p.status === "released").reduce((s, p) => s + Number(p.net_aoa), 0),
    ),
    daily: Object.entries(daily).map(([day, total]) => ({ day, total })),
  };
}
