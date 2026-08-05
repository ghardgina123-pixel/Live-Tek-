import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Package, ShoppingBag, Wallet, TrendingUp, Loader2 } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { PartnerSettlementCard } from "@/components/PartnerSettlementCard";
import { supabase } from "@/integrations/supabase/client";
import { computeDashboardStats } from "@/lib/settlement";

export const Route = createFileRoute("/_authenticated/lojista/dashboard")({
  head: () => ({ meta: [{ title: "Visão Geral — Lojista" }] }),
  component: Dashboard,
});

type Stats = { products: number } & ReturnType<typeof computeDashboardStats>;

function Dashboard() {
  return (
    <LojistaShell title="Visão Geral">
      <DashboardContent />
    </LojistaShell>
  );
}

function DashboardContent() {
  const { store } = useLojistaStore();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!store) return;
    (async () => {
      const [prodRes, ordersRes, payoutsRes] = await Promise.all([
        supabase.from("products").select("id", { count: "exact", head: true }).eq("store_id", store.id),
        supabase.from("orders").select("id, total_aoa, status, created_at").eq("store_id", store.id),
        supabase.from("payouts").select("net_aoa, status").eq("store_id", store.id),
      ]);
      const orders = (ordersRes.data ?? []) as { id: string; total_aoa: number; status: string; created_at: string }[];
      const payouts = (payoutsRes.data ?? []) as { net_aoa: number; status: string }[];
      setStats({ products: prodRes.count ?? 0, ...computeDashboardStats(orders, payouts) });
    })();
  }, [store?.id]);

  if (!stats) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>;

  const max = Math.max(1, ...stats.daily.map((d) => d.total));

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <p className="text-xs opacity-80">Receita total (pedidos pagos)</p>
        <p className="text-2xl font-bold">Kz {stats.revenue.toLocaleString("pt-AO")}</p>
        <p className="mt-1 text-[11px] opacity-80">{stats.ordersPaid} de {stats.orders} pedidos pagos</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatCard icon={Package} label="Produtos" value={String(stats.products)} />
        <StatCard icon={ShoppingBag} label="Pedidos" value={String(stats.orders)} />
        <StatCard icon={Wallet} label="A receber" value={`${stats.payoutsPending.toLocaleString("pt-AO", { maximumFractionDigits: 0 })} AOA`} />
      </div>

      {store && <PartnerSettlementCard storeId={store.id} />}

      <div className="rounded-2xl border border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <TrendingUp size={16} className="text-primary" />
          <h3 className="text-sm font-bold">Vendas — últimos 7 dias</h3>
        </div>
        <div className="flex h-32 items-end gap-1.5">
          {stats.daily.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-md bg-primary/80"
                style={{ height: `${(d.total / max) * 100}%`, minHeight: 2 }}
                title={`Kz ${d.total.toLocaleString("pt-AO")}`}
              />
              <span className="text-[9px] text-muted-foreground">{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border p-3 text-xs text-muted-foreground">
        Repasses liberados: <strong className="text-foreground">{stats.payoutsReleased.toLocaleString("pt-AO", { maximumFractionDigits: 2 })} AOA</strong>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Package; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <Icon size={16} className="text-primary" />
      <p className="mt-2 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-base font-bold">{value}</p>
    </div>
  );
}