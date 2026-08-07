import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, XCircle, Loader2, FileText, ExternalLink, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { BrandLogo, getBrand } from "@/lib/payment-brands";

export const Route = createFileRoute("/_authenticated/admin-crm")({
  head: () => ({ meta: [{ title: "Admin · CRM — Live Teká" }] }),
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
  component: AdminCRM,
  errorComponent: PanelErrorBoundary,
});

type Row = {
  id: string;
  store_id: string;
  status: string;
  price_aoa: number;
  payment_method: string | null;
  proof_url: string | null;
  started_at: string | null;
  expires_at: string | null;
  rejection_reason: string | null;
  created_at: string;
  stores: { name: string; owner_id: string } | null;
};

const FILTERS = [
  { value: "pending", label: "Pendentes" },
  { value: "active", label: "Ativos" },
  { value: "rejected", label: "Rejeitados" },
  { value: "all", label: "Todos" },
];

function AdminCRM() {
  const [filter, setFilter] = useState("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Row | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from("store_subscriptions")
      .select("id, store_id, status, price_aoa, payment_method, proof_url, started_at, expires_at, rejection_reason, created_at, stores(name, owner_id)")
      .eq("plan", "crm")
      .order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    const { data, error } = await q;
    if (error) toast.error(error.message);
    setRows(((data ?? []) as unknown) as Row[]);
    setLoading(false);
  };

  useEffect(() => { load();  }, [filter]);

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold flex items-center gap-2">CRM Premium <Sparkles size={16} className="text-amber-300" /></h1>
          <p className="text-xs text-white/80">Aprovação de assinaturas</p>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold ${
              filter === f.value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhuma solicitação.</p>
      ) : (
        <ul className="space-y-2 px-4 pb-6">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelected(r)}
                className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-3 text-left"
              >
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-semibold">{r.stores?.name ?? "Loja"}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("pt-AO")} · Kz {Number(r.price_aoa).toLocaleString("pt-AO")}
                  </p>
                  {r.payment_method && (
                    <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span
                        className="inline-flex h-4 w-4 items-center justify-center rounded"
                        style={{ background: getBrand(r.payment_method).bg }}
                      />
                      via {getBrand(r.payment_method).name}
                    </p>
                  )}
                </div>
                <StatusBadge status={r.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && <ReviewSheet sub={selected} onClose={() => setSelected(null)} onDone={() => { setSelected(null); load(); }} />}
    </AppShell>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-900",
    active: "bg-emerald-100 text-emerald-900",
    rejected: "bg-red-100 text-red-900",
    expired: "bg-muted text-muted-foreground",
  };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${map[status] ?? "bg-muted"}`}>{status}</span>;
}

function ReviewSheet({ sub, onClose, onDone }: { sub: Row; onClose: () => void; onDone: () => void }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [reason, setReason] = useState(sub.rejection_reason ?? "");
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sub.proof_url) return;
    supabase.storage.from("subscription-proofs").createSignedUrl(sub.proof_url, 60 * 10)
      .then(({ data }) => setProofUrl(data?.signedUrl ?? null));
  }, [sub.proof_url]);

  const approve = async () => {
    setBusy(true);
    const started = new Date();
    const expires = new Date(started); expires.setMonth(expires.getMonth() + months);
    const { error } = await supabase.from("store_subscriptions").update({
      status: "active",
      started_at: started.toISOString(),
      expires_at: expires.toISOString(),
      rejection_reason: null,
    }).eq("id", sub.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Assinatura aprovada");
    onDone();
  };

  const reject = async () => {
    if (!reason.trim()) return toast.error("Informe o motivo da rejeição");
    setBusy(true);
    const { error } = await supabase.from("store_subscriptions").update({
      status: "rejected",
      rejection_reason: reason.trim(),
    }).eq("id", sub.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Assinatura rejeitada");
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-full overflow-y-auto rounded-t-3xl bg-background p-5">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
        <h2 className="text-lg font-bold">{sub.stores?.name ?? "Loja"}</h2>
        <p className="text-xs text-muted-foreground">Plano CRM · Kz {Number(sub.price_aoa).toLocaleString("pt-AO")}</p>
        <div className="mt-2 flex items-center gap-2">
          {sub.payment_method ? (
            <>
              <BrandLogo methodType={sub.payment_method} size={32} rounded="rounded-lg" />
              <div>
                <p className="text-xs font-semibold">{getBrand(sub.payment_method).name}</p>
                <p className="text-[11px] text-muted-foreground">{getBrand(sub.payment_method).tagline}</p>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Método: —</p>
          )}
        </div>

        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground">Comprovativo</p>
          {!sub.proof_url ? (
            <div className="mt-1 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Lojista ainda não anexou comprovativo
            </div>
          ) : !proofUrl ? (
            <div className="mt-1 flex h-32 items-center justify-center rounded-xl bg-muted"><Loader2 className="animate-spin" /></div>
          ) : sub.proof_url.match(/\.(png|jpg|jpeg|webp|gif)$/i) ? (
            <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
              <img loading="lazy" decoding="async" src={proofUrl} alt="comprovativo" className="mt-1 max-h-72 w-full rounded-xl object-contain bg-muted" />
            </a>
          ) : (
            <a href={proofUrl} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-2 rounded-xl border border-border p-3 text-sm">
              <FileText size={16} /> Abrir ficheiro <ExternalLink size={14} className="ml-auto" />
            </a>
          )}
        </div>

        {sub.status === "pending" && (
          <>
            <div className="mt-4">
              <label className="text-xs font-semibold text-muted-foreground">Duração da ativação (meses)</label>
              <input
                type="number" min={1} max={12} value={months}
                onChange={(e) => setMonths(Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
                className="mt-1 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm"
              />
            </div>
            <Button onClick={approve} disabled={busy} className="mt-3 h-11 w-full rounded-xl bg-emerald-500 font-semibold text-white hover:bg-emerald-600">
              {busy ? <Loader2 className="animate-spin" /> : <><CheckCircle2 size={16} className="mr-2" /> Aprovar</>}
            </Button>

            <div className="mt-4">
              <label className="text-xs font-semibold text-muted-foreground">Motivo da rejeição</label>
              <textarea
                value={reason} onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Ex.: comprovativo ilegível"
                className="mt-1 w-full rounded-xl border border-border bg-background p-3 text-sm"
              />
            </div>
            <Button onClick={reject} disabled={busy} variant="outline" className="mt-2 h-11 w-full rounded-xl border-red-300 font-semibold text-red-600 hover:bg-red-50">
              <XCircle size={16} className="mr-2" /> Rejeitar
            </Button>
          </>
        )}

        {sub.status === "active" && sub.expires_at && (
          <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-900">
            Ativo até {new Date(sub.expires_at).toLocaleDateString("pt-AO")}
          </p>
        )}
        {sub.status === "rejected" && sub.rejection_reason && (
          <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-900">Motivo: {sub.rejection_reason}</p>
        )}

        <button onClick={onClose} className="mt-4 h-10 w-full rounded-xl border border-border text-sm font-semibold">Fechar</button>
      </div>
    </div>
  );
}