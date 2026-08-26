import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Wallet, TrendingUp, Receipt, Banknote, CheckCircle2, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/financeiro")({
  head: () => ({
    meta: [
      { title: "Admin · Financeiro — Live Teká" },
      { name: "description", content: "Painel financeiro do gestor: vendas, comissões, taxas de adesão, subscrições e pedidos de saque." },
      { property: "og:title", content: "Admin · Financeiro — Live Teká" },
      { property: "og:description", content: "Receita real, comissões da plataforma, transações e liquidação de saques." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw redirect({ to: "/perfil" });
  },
  component: AdminFinance,
  errorComponent: PanelErrorBoundary,
});

type Summary = {
  orders_total: number;
  orders_paid: number;
  orders_pending: number;
  orders_cancelled: number;
  gross_aoa: number;
  commission_aoa: number;
  net_sellers_aoa: number;
  gross_unverified_aoa: number;
  orders_unverified: number;
  subscriptions_unverified_aoa: number;
  signup_fees_paid_aoa: number;
  signup_fees_pending_aoa: number;
  subscriptions_active: number;
  subscriptions_paid_aoa: number;
  payouts_pending_aoa: number;
  payouts_paid_aoa: number;
  stores_total: number;
  stores_active: number;
};

type Tx = {
  id: string;
  created_at: string;
  paid_at: string | null;
  status: string;
  customer_name: string | null;
  store_name: string | null;
  store_id: string;
  gross_aoa: number;
  commission_aoa: number;
  net_aoa: number;
  payment_method: string | null;
  reference: string | null;
  items: number;
  verified: boolean;
  verified_source: string | null;
};

type PayoutReq = {
  id: string;
  user_id: string;
  user_name: string | null;
  kind: string;
  amount_aoa: number;
  method: string | null;
  status: string;
  created_at: string;
  due_at: string | null;
  processed_at: string | null;
};

const kz = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { maximumFractionDigits: 0 })}`;
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-AO") : "—");

const STATUSES = ["all", "pending", "paid", "preparing", "shipped", "delivered", "cancelled"] as const;
const PERIODS = [
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "90", label: "90 dias" },
  { key: "all", label: "Tudo" },
] as const;

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <p className="text-[11px] font-medium">{label}</p>
      </div>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function AdminFinance() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<Tx[] | null>(null);
  const [payouts, setPayouts] = useState<PayoutReq[] | null>(null);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("30");
  const [method, setMethod] = useState("");
  const [storeQ, setStoreQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fromISO = useMemo(() => {
    if (period === "all") return undefined;
    const d = new Date();
    d.setDate(d.getDate() - Number(period));
    return d.toISOString();
  }, [period]);

  const load = useCallback(async () => {
    setLoading(true);
    const [s, t, p] = await Promise.all([
      supabase.rpc("admin_financial_summary"),
      supabase.rpc("admin_financial_transactions", {
        _status: status === "all" ? undefined : status,
        _method: method.trim() || undefined,
        _from: fromISO,
        _limit: 200,
      }),
      supabase.rpc("admin_payout_requests"),
    ]);
    setLoading(false);
    if (s.error) toast.error(s.error.message);
    else setSummary(s.data as unknown as Summary);
    if (t.error) { toast.error(t.error.message); setRows([]); }
    else setRows((t.data as unknown as Tx[]) ?? []);
    if (p.error) setPayouts([]);
    else setPayouts((p.data as unknown as PayoutReq[]) ?? []);
  }, [status, method, fromISO]);

  useEffect(() => { load(); }, [load]);

  const settle = async (id: string, ok: boolean) => {
    setBusy(id);
    const { error } = await supabase.rpc("admin_settle_payout", {
      _payout_id: id,
      _status: ok ? "paid" : "rejected",
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(ok ? "Saque marcado como pago" : "Saque rejeitado");
    load();
  };

  const visible = (rows ?? []).filter((r) =>
    !storeQ.trim() ? true : (r.store_name ?? "").toLowerCase().includes(storeQ.trim().toLowerCase()),
  );

  const totals = visible.reduce(
    (a, r) => ({
      gross: a.gross + Number(r.gross_aoa || 0),
      commission: a.commission + Number(r.commission_aoa || 0),
      net: a.net + Number(r.net_aoa || 0),
    }),
    { gross: 0, commission: 0, net: 0 },
  );

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/admin-dashboard" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Financeiro</h1>
          <p className="text-xs text-white/80">Vendas, comissões, subscrições e saques</p>
        </div>
        <button onClick={() => load()} aria-label="Atualizar" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="cv-auto space-y-5 px-5 py-4">
        {summary === null ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <section className="grid grid-cols-2 gap-3">
            <Stat icon={<TrendingUp size={14} />} label="Receita bruta" value={kz(summary.gross_aoa)} hint={`${summary.orders_paid} pedidos pagos`} />
            <Stat icon={<Receipt size={14} />} label="Comissões plataforma" value={kz(summary.commission_aoa)} hint="5% retalho · 0% serviços" />
            <Stat icon={<Banknote size={14} />} label="Líquido lojistas" value={kz(summary.net_sellers_aoa)} />
            <Stat icon={<Wallet size={14} />} label="Saques pendentes" value={kz(summary.payouts_pending_aoa)} hint={`Pagos: ${kz(summary.payouts_paid_aoa)}`} />
            <Stat icon={<Receipt size={14} />} label="Taxas de adesão" value={kz(summary.signup_fees_paid_aoa)} hint={`Por liquidar: ${kz(summary.signup_fees_pending_aoa)}`} />
            <Stat icon={<TrendingUp size={14} />} label="Subscrições ativas" value={String(summary.subscriptions_active)} hint={kz(summary.subscriptions_paid_aoa)} />
            <Stat icon={<Receipt size={14} />} label="Pedidos" value={String(summary.orders_total)} hint={`${summary.orders_pending} pendentes · ${summary.orders_cancelled} cancelados`} />
            <Stat icon={<TrendingUp size={14} />} label="Lojas" value={`${summary.stores_active}/${summary.stores_total}`} hint="ativas / total" />
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Transações</h2>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPeriod(p.key)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  period === p.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  status === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
                }`}
              >
                {s === "all" ? "Todos" : s}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Input value={storeQ} onChange={(e) => setStoreQ(e.target.value)} placeholder="Filtrar por loja" />
            <Input value={method} onChange={(e) => setMethod(e.target.value)} placeholder="Método (ex.: cod)" />
          </div>

          <div className="rounded-2xl border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground">
            <p>Bruto: <span className="font-semibold text-foreground">{kz(totals.gross)}</span></p>
            <p>Comissão: <span className="font-semibold text-foreground">{kz(totals.commission)}</span></p>
            <p>Líquido lojistas: <span className="font-semibold text-foreground">{kz(totals.net)}</span></p>
          </div>

          {loading && rows === null ? (
            <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
          ) : visible.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              Nenhuma transação no período selecionado.
            </div>
          ) : (
            <ul className="space-y-3">
              {visible.map((r) => (
                <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.store_name ?? "—"}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{r.customer_name ?? "Cliente"} · {r.items} item(s)</p>
                    </div>
                    <Badge className="shrink-0 border-0 bg-muted text-muted-foreground">{r.status}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <p>Bruto: <span className="font-medium text-foreground">{kz(r.gross_aoa)}</span></p>
                    <p>Comissão: <span className="font-medium text-foreground">{kz(r.commission_aoa)}</span></p>
                    <p>Líquido: <span className="font-medium text-foreground">{kz(r.net_aoa)}</span></p>
                    <p>Método: {r.payment_method ?? "—"}</p>
                    <p>Criado: {dt(r.created_at)}</p>
                    <p>Pago: {dt(r.paid_at)}</p>
                  </div>
                  {r.reference && (
                    <code className="mt-2 inline-block truncate rounded bg-muted px-2 py-1 text-[11px] font-semibold">{r.reference}</code>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Pedidos de saque</h2>
          {payouts === null ? (
            <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" /></div>
          ) : payouts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Sem pedidos de saque.
            </div>
          ) : (
            <ul className="space-y-3">
              {payouts.map((p) => (
                <li key={p.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{p.user_name ?? "Utilizador"}</p>
                      <p className="text-[11px] text-muted-foreground">{p.kind} · {p.method ?? "—"}</p>
                    </div>
                    <Badge className="shrink-0 border-0 bg-muted text-muted-foreground">{p.status}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                    <p>Valor: <span className="font-medium text-foreground">{kz(p.amount_aoa)}</span></p>
                    <p>Pedido: {dt(p.created_at)}</p>
                    <p>Prazo: {dt(p.due_at)}</p>
                    <p>Processado: {dt(p.processed_at)}</p>
                  </div>
                  {p.status !== "paid" && p.status !== "rejected" && (
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" className="flex-1" disabled={busy === p.id} onClick={() => settle(p.id, true)}>
                        {busy === p.id ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} className="mr-1" /> Marcar pago</>}
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => settle(p.id, false)}>
                        <XCircle size={14} className="mr-1" /> Rejeitar
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
