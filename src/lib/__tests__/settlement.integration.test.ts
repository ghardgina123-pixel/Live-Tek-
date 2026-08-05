import { describe, it, expect } from "vitest";
import {
  applyOrderTransition,
  calcTransactionSplit,
  computeDashboardStats,
  summarizeStoreBalance,
  type OrderStatus,
  type PartnerType,
  type Payout,
} from "@/lib/settlement";

/** Percorre o ciclo de vida completo do pedido e devolve o estado final. */
function runLifecycle(partnerType: PartnerType, totalAoa: number, path: OrderStatus[]) {
  let status: OrderStatus = "pending";
  let payout: Payout | null = null;
  const trail: { status: OrderStatus; payout: Payout | null }[] = [];
  for (const next of path) {
    const r = applyOrderTransition({ orderId: "o1", partnerType, totalAoa, from: status, to: next, payout });
    status = r.status;
    payout = r.payout;
    trail.push({ status, payout: payout ? { ...payout } : null });
  }
  return { status, payout, trail };
}

describe("split de transação", () => {
  it("retalho aplica 10% de comissão", () => {
    expect(calcTransactionSplit("retail", 10000)).toEqual({
      gross_aoa: 10000, commission_pct: 10, platform_fee_aoa: 1000, net_aoa: 9000,
    });
  });

  it("serviços não têm comissão", () => {
    expect(calcTransactionSplit("service", 10000)).toEqual({
      gross_aoa: 10000, commission_pct: 0, platform_fee_aoa: 0, net_aoa: 10000,
    });
  });

  it("arredonda a duas casas decimais", () => {
    const s = calcTransactionSplit("retail", 1234.567);
    expect(s.platform_fee_aoa).toBe(123.46);
    expect(s.net_aoa).toBe(1111.11);
    expect(s.platform_fee_aoa + s.net_aoa).toBeCloseTo(s.gross_aoa, 1);
  });
});

describe("ciclo de vida do pedido → saldo do lojista", () => {
  it("pending não gera repasse nem saldo", () => {
    const b = summarizeStoreBalance("retail", []);
    expect(b.pending_clearance_aoa).toBe(0);
    expect(b.available_aoa).toBe(0);
  });

  it("paid coloca o líquido em compensação", () => {
    const { payout } = runLifecycle("retail", 20000, ["paid"]);
    expect(payout).toMatchObject({ status: "pending", net_aoa: 18000, platform_fee_aoa: 2000 });
    const b = summarizeStoreBalance("retail", [payout!]);
    expect(b.pending_clearance_aoa).toBe(18000);
    expect(b.available_aoa).toBe(0);
  });

  it("preparing e shipped não alteram o repasse", () => {
    const { trail } = runLifecycle("retail", 20000, ["paid", "preparing", "shipped"]);
    expect(trail.map((t) => t.payout?.status)).toEqual(["pending", "pending", "pending"]);
    expect(trail.at(-1)!.payout!.net_aoa).toBe(18000);
  });

  it("delivered liberta o repasse: em compensação → disponível", () => {
    const { payout } = runLifecycle("retail", 20000, ["paid", "preparing", "shipped", "delivered"]);
    expect(payout!.status).toBe("released");
    const b = summarizeStoreBalance("retail", [payout!]);
    expect(b.pending_clearance_aoa).toBe(0);
    expect(b.available_aoa).toBe(18000);
    expect(b.platform_fees_aoa).toBe(2000);
  });

  it("parceiro de serviços recebe 100% após entrega", () => {
    const { payout } = runLifecycle("service", 20000, ["paid", "preparing", "shipped", "delivered"]);
    const b = summarizeStoreBalance("service", [payout!]);
    expect(b.commission_pct).toBe(0);
    expect(b.available_aoa).toBe(20000);
    expect(b.platform_fees_aoa).toBe(0);
  });

  it("cancelado antes do pagamento nunca cria repasse", () => {
    const { payout } = runLifecycle("retail", 20000, ["cancelled"]);
    expect(payout).toBeNull();
    expect(summarizeStoreBalance("retail", []).available_aoa).toBe(0);
  });

  it("cancelado depois de pago mantém o valor em compensação (não libertado)", () => {
    const { payout } = runLifecycle("retail", 20000, ["paid", "cancelled"]);
    expect(payout!.status).toBe("pending");
    expect(summarizeStoreBalance("retail", [payout!]).available_aoa).toBe(0);
  });

  it("bloqueia transições inválidas", () => {
    expect(() => runLifecycle("retail", 100, ["delivered"])).toThrow(/order_status_not_allowed/);
    expect(() => runLifecycle("retail", 100, ["paid", "shipped"])).toThrow(/order_status_not_allowed/);
    expect(() => runLifecycle("retail", 100, ["paid", "preparing", "shipped", "delivered", "cancelled"])).toThrow();
  });

  it("libertar é idempotente (não duplica o saldo)", () => {
    const { payout } = runLifecycle("retail", 20000, ["paid", "preparing", "shipped", "delivered"]);
    const again = applyOrderTransition({
      orderId: "o1", partnerType: "retail", totalAoa: 20000, from: "delivered", to: "delivered", payout,
    });
    expect(summarizeStoreBalance("retail", [again.payout!]).available_aoa).toBe(18000);
  });
});

describe("painel do lojista reflecte os pedidos", () => {
  const day = (offset: number) => {
    const d = new Date("2026-08-05T10:00:00.000Z");
    d.setDate(d.getDate() - offset);
    return d.toISOString();
  };
  const today = new Date("2026-08-05T10:00:00.000Z");

  it("receita conta apenas pedidos pagos ou posteriores", () => {
    const orders = [
      { id: "1", total_aoa: 10000, status: "pending", created_at: day(0) },
      { id: "2", total_aoa: 20000, status: "paid", created_at: day(0) },
      { id: "3", total_aoa: 30000, status: "delivered", created_at: day(1) },
      { id: "4", total_aoa: 40000, status: "cancelled", created_at: day(1) },
    ];
    const stats = computeDashboardStats(orders, [], today);
    expect(stats.orders).toBe(4);
    expect(stats.ordersPaid).toBe(2);
    expect(stats.revenue).toBe(50000);
  });

  it("soma dos repasses do painel bate certo com o saldo do lojista", () => {
    const a = runLifecycle("retail", 20000, ["paid"]).payout!;
    const b = runLifecycle("retail", 30000, ["paid", "preparing", "shipped", "delivered"]).payout!;
    const balance = summarizeStoreBalance("retail", [a, b]);
    const stats = computeDashboardStats([], [a, b], today);

    expect(stats.payoutsPending).toBe(balance.pending_clearance_aoa);
    expect(stats.payoutsReleased).toBe(balance.available_aoa);
    expect(balance.pending_clearance_aoa).toBe(18000);
    expect(balance.available_aoa).toBe(27000);
    expect(balance.platform_fees_aoa).toBe(5000);
    expect(balance.pending_clearance_aoa + balance.available_aoa + balance.platform_fees_aoa).toBe(50000);
  });

  it("gráfico diário cobre 7 dias e ignora pedidos fora da janela", () => {
    const orders = [
      { id: "1", total_aoa: 5000, status: "delivered", created_at: day(0) },
      { id: "2", total_aoa: 7000, status: "paid", created_at: day(6) },
      { id: "3", total_aoa: 9000, status: "delivered", created_at: day(30) },
    ];
    const stats = computeDashboardStats(orders, [], today);
    expect(stats.daily).toHaveLength(7);
    expect(stats.daily.at(-1)!.total).toBe(5000);
    expect(stats.daily[0].total).toBe(7000);
    expect(stats.daily.reduce((s, d) => s + d.total, 0)).toBe(12000);
    expect(stats.revenue).toBe(21000);
  });
});
