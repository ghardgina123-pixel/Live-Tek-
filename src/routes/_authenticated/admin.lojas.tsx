import { createFileRoute, redirect } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2, Store as StoreIcon, MapPin } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/lojas")({
  head: () => ({ meta: [{ title: "Admin · Aprovação de Lojas — Live Teká" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", u.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/perfil" });
  },
  component: AdminLojas,
  errorComponent: PanelErrorBoundary,
});

type StoreRow = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected";
  nif: string | null;
  phone: string | null;
  category: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_holder: string | null;
  logo_url: string | null;
  created_at: string;
  owner_id: string;
  rejection_reason: string | null;
  owner_name: string | null;
  signup_fee_required?: boolean | null;
  fee_status?: string | null;
  fee_proof_url?: string | null;
};

const FILTERS = [
  { value: "pending", label: "Pendentes" },
  { value: "active", label: "Aprovadas" },
  { value: "rejected", label: "Rejeitadas" },
  { value: "all", label: "Todas" },
] as const;

function AdminLojas() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("pending");
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [approvedCount, setApprovedCount] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("stores")
      .select("id, name, status, phone, category, logo_url, created_at, owner_id, rejection_reason, signup_fee_required")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    const stores = (data ?? []) as Omit<StoreRow, "nif" | "bank_name" | "bank_account" | "bank_holder" | "owner_name" | "fee_status" | "fee_proof_url">[];
    const ids = stores.map((s) => s.id);
    const owners = Array.from(new Set(stores.map((s) => s.owner_id)));
    let priv: Record<string, { nif: string | null; bank_name: string | null; bank_account: string | null; bank_holder: string | null }> = {};
    let names: Record<string, string | null> = {};
    let subs: Record<string, { status: string | null; proof_url: string | null }> = {};
    if (ids.length) {
      const [{ data: pdata }, { data: sdata }] = await Promise.all([
        supabase
          .from("store_private")
          .select("store_id, nif, bank_name, bank_account, bank_holder")
          .in("store_id", ids),
        supabase
          .from("store_subscriptions")
          .select("store_id, status, proof_url, plan")
          .in("store_id", ids)
          .eq("plan", "signup_fee"),
      ]);
      priv = Object.fromEntries((pdata ?? []).map((p) => [p.store_id, p]));
      subs = Object.fromEntries((sdata ?? []).map((s) => [s.store_id, { status: s.status, proof_url: s.proof_url }]));
    }
    if (owners.length) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", owners);
      names = Object.fromEntries((profs ?? []).map((p) => [p.id, p.display_name]));
    }
    setRows(
      stores.map((s) => ({
        ...s,
        nif: priv[s.id]?.nif ?? null,
        bank_name: priv[s.id]?.bank_name ?? null,
        bank_account: priv[s.id]?.bank_account ?? null,
        bank_holder: priv[s.id]?.bank_holder ?? null,
        owner_name: names[s.owner_id] ?? null,
        fee_status: subs[s.id]?.status ?? null,
        fee_proof_url: subs[s.id]?.proof_url ?? null,
      })),
    );
    const { data: st } = await supabase.rpc("seller_signup_status");
    if (st && typeof st === "object") setApprovedCount((st as { approved_count?: number }).approved_count ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [filter]);

  const approve = async (s: StoreRow) => {
    setBusyId(s.id);
    const { error } = await supabase.rpc("admin_approve_store", { _store_id: s.id });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(`Loja "${s.name}" aprovada e lojista promovido.`);
    load();
  };

  const reject = async (s: StoreRow) => {
    const reason = window.prompt("Motivo da rejeição:", "");
    if (reason === null) return;
    setBusyId(s.id);
    const { error } = await supabase.rpc("admin_reject_store", { _store_id: s.id, _reason: reason });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(`Loja "${s.name}" rejeitada.`);
    load();
  };

  return (
    <AppShell>
      <header className="px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <div className="flex items-center gap-3">
          <BackButton fallback="/admin-dashboard" />
          <StoreIcon size={20} />
          <h1 className="text-lg font-semibold">Aprovação de Lojas</h1>
        </div>
        <p className="mt-1 text-xs text-white/80">Reveja os dados de onboarding e aprove ou rejeite cada loja.</p>
        {approvedCount !== null && (
          <p className="mt-2 text-[11px] text-white/90">
            {approvedCount} / 50 lojas gratuitas aprovadas · {approvedCount >= 50 ? "Taxa de inscrição obrigatória." : `${50 - approvedCount} vagas gratuitas restantes.`}
          </p>
        )}
      </header>

      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto bg-background px-5 py-3 border-b">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.value ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-4 space-y-3">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma loja nesta categoria.</p>
        ) : (
          rows.map((s) => (
            <article key={s.id} className="rounded-2xl border bg-card p-4 shadow-sm">
              <div className="flex items-start gap-3">
                {s.logo_url ? (
                  <img src={s.logo_url} alt={s.name} className="h-12 w-12 rounded-xl object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent">
                    <StoreIcon size={20} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate font-semibold">{s.name}</h2>
                    <StatusBadge status={s.status} />
                    {s.signup_fee_required && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Taxa</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Responsável: <span className="font-medium text-foreground">{s.owner_name ?? "—"}</span> · {s.category ?? "Sem categoria"} · {new Date(s.created_at).toLocaleDateString("pt-AO")}
                  </p>
                </div>
              </div>

              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <Info label="NIF" value={s.nif} />
                <Info label="Telefone" value={s.phone} />
                <Info label="Banco" value={s.bank_name} />
                <Info label="Titular" value={s.bank_holder} />
                <div className="col-span-2">
                  <Info label="IBAN / Conta" value={s.bank_account} mono />
                </div>
                {s.signup_fee_required && (
                  <div className="col-span-2 rounded-lg bg-amber-500/10 p-2 text-[11px]">
                    <p className="font-semibold text-amber-800">Taxa de inscrição (9.600 AOA): {s.fee_status ?? "—"}</p>
                    {s.fee_proof_url && /^https:\/\//i.test(s.fee_proof_url) && (
                      <a href={s.fee_proof_url} target="_blank" rel="noreferrer" className="text-primary underline">
                        Ver comprovativo
                      </a>
                    )}
                  </div>
                )}
              </dl>

              {s.status === "rejected" && s.rejection_reason && (
                <p className="mt-2 rounded-lg bg-destructive/10 p-2 text-[11px] text-destructive">
                  Motivo: {s.rejection_reason}
                </p>
              )}

              {s.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <Button
                    onClick={() => approve(s)}
                    disabled={busyId === s.id}
                    className="flex-1"
                  >
                    {busyId === s.id ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}
                    <span className="ml-1">Aprovar</span>
                  </Button>
                  <Button
                    onClick={() => reject(s)}
                    disabled={busyId === s.id}
                    variant="outline"
                    className="flex-1 border-destructive/40 text-destructive hover:bg-destructive/10"
                  >
                    <XCircle size={16} />
                    <span className="ml-1">Rejeitar</span>
                  </Button>
                </div>
              )}
            </article>
          ))
        )}
      </div>
    </AppShell>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`truncate font-medium ${mono ? "font-mono text-[11px]" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

function StatusBadge({ status }: { status: StoreRow["status"] }) {
  const map = {
    pending: { label: "Pendente", cls: "bg-yellow-500/15 text-yellow-700" },
    active: { label: "Aprovada", cls: "bg-emerald-500/15 text-emerald-700" },
    rejected: { label: "Rejeitada", cls: "bg-destructive/15 text-destructive" },
  } as const;
  const m = map[status];
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${m.cls}`}>{m.label}</span>;
}