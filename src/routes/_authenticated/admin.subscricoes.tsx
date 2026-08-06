import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, CheckCircle2, XCircle, Copy, Search } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/subscricoes")({
  head: () => ({
    meta: [
      { title: "Admin · Subscrições — Live Teká" },
      { name: "description", content: "Gestão de intenções de subscrição, referências Multicaixa e reprocessamento de pagamentos." },
      { property: "og:title", content: "Admin · Subscrições — Live Teká" },
      { property: "og:description", content: "Estados, referências e reprocessamento manual de subscrições de parceiros." },
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
  component: AdminSubscriptions,
  errorComponent: PanelErrorBoundary,
});

type Row = {
  id: string;
  store_id: string;
  store_name: string | null;
  owner_email: string | null;
  plan: string;
  plan_name: string | null;
  status: string;
  price_aoa: number;
  reference: string | null;
  payment_method: string | null;
  external_id: string | null;
  started_at: string | null;
  expires_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  invoice_count: number;
};

const FILTERS = ["all", "pending", "active", "expired", "cancelled", "rejected"] as const;
const kz = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { maximumFractionDigits: 0 })}`;
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-AO") : "—");

const badgeFor = (status: string) => {
  if (status === "active") return "bg-primary/10 text-primary";
  if (status === "pending") return "bg-amber-500/10 text-amber-600";
  if (status === "expired") return "bg-muted text-muted-foreground";
  return "bg-destructive/10 text-destructive";
};

function AdminSubscriptions() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    const { data, error } = await supabase.rpc("admin_list_subscriptions", {
      _status: filter === "all" ? null : filter,
    });
    if (error) {
      toast.error(error.message);
      setRows([]);
      return;
    }
    setRows((data as unknown as Row[]) ?? []);
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const ch = supabase
      .channel("admin-subscriptions")
      .on("postgres_changes", { event: "*", schema: "public", table: "store_subscriptions" }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [load]);

  const reprocess = async (reference: string, approve: boolean) => {
    setBusy(reference);
    const { data, error } = await supabase.rpc("admin_reprocess_subscription", {
      _reference: reference,
      _approve: approve,
    });
    setBusy(null);
    if (error) return toast.error(error.message);
    const res = data as { ok?: boolean; reason?: string; idempotent?: boolean; status?: string } | null;
    if (!res?.ok) return toast.error(res?.reason === "not_found" ? "Referência não encontrada" : "Falha no reprocessamento");
    toast.success(
      res.idempotent
        ? "Já estava ativa — nenhuma alteração (idempotente)"
        : approve
          ? "Subscrição ativada e fatura emitida"
          : "Subscrição rejeitada",
    );
    load();
  };

  const visible = (rows ?? []).filter((r) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return (
      (r.store_name ?? "").toLowerCase().includes(t) ||
      (r.reference ?? "").toLowerCase().includes(t) ||
      (r.owner_email ?? "").toLowerCase().includes(t)
    );
  });

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/admin-dashboard" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Subscrições</h1>
          <p className="text-xs text-white/80">Intenções, referências Multicaixa e reprocessamento</p>
        </div>
        <button onClick={() => load()} aria-label="Atualizar" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <RefreshCw size={16} />
        </button>
      </header>

      <div className="cv-auto space-y-4 px-5 py-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium ${
                filter === f ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"
              }`}
            >
              {f === "all" ? "Todas" : f}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar loja, e-mail ou referência" className="pl-9" />
        </div>

        {rows === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="animate-spin text-primary" />
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma subscrição encontrada.
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((r) => (
              <li key={r.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{r.store_name ?? "—"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{r.owner_email ?? "—"}</p>
                  </div>
                  <Badge className={`shrink-0 border-0 ${badgeFor(r.status)}`}>{r.status}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <p>Plano: <span className="font-medium text-foreground">{r.plan_name ?? r.plan}</span></p>
                  <p>Valor: <span className="font-medium text-foreground">{kz(r.price_aoa)}</span></p>
                  <p>Início: {dt(r.started_at)}</p>
                  <p>Expira: {dt(r.expires_at)}</p>
                  <p>Faturas: {r.invoice_count}</p>
                  <p>Método: {r.payment_method ?? "—"}</p>
                </div>

                {r.reference && (
                  <div className="mt-2 flex items-center gap-2">
                    <code className="truncate rounded bg-muted px-2 py-1 text-[11px] font-semibold">{r.reference}</code>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard.writeText(r.reference ?? "");
                        toast.success("Referência copiada");
                      }}
                    >
                      <Copy size={13} />
                    </Button>
                  </div>
                )}

                {r.reference && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" className="flex-1" disabled={busy === r.reference} onClick={() => reprocess(r.reference!, true)}>
                      {busy === r.reference ? <Loader2 size={14} className="animate-spin" /> : <><CheckCircle2 size={14} className="mr-1" /> Reprocessar pagamento</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy === r.reference || r.status === "active"} onClick={() => reprocess(r.reference!, false)}>
                      <XCircle size={14} className="mr-1" /> Rejeitar
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
