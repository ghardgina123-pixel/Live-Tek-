import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Home as HomeIcon, ExternalLink } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/imobiliarias")({
  head: () => ({ meta: [{ title: "Admin · Imobiliárias — Live Teká" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/perfil" });
  },
  component: AdminImobiliariasPage,
  errorComponent: PanelErrorBoundary,
});

type Agency = { id: string; name: string; nif: string; phone: string; status: string; rejection_reason: string | null };
type Property = { id: string; title: string; status: string; price_aoa: number; agency_id: string; real_estate_agencies: { name: string } | null };
type Fee = { id: string; agency_id: string; amount_aoa: number; status: string; payment_method: string | null; proof_url: string | null; created_at: string; real_estate_agencies: { name: string } | null };

function AdminImobiliariasPage() {
  const [tab, setTab] = useState<"agencias" | "imoveis" | "lives">("agencias");
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Imobiliárias · Admin</h1>
          <p className="text-xs text-white/80">Aprovações</p>
        </div>
        <HomeIcon size={20} />
      </header>
      <div className="flex gap-2 border-b border-border px-5">
        {(["agencias", "imoveis", "lives"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`py-2 px-3 text-sm font-semibold capitalize ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>{t}</button>
        ))}
      </div>
      <div className="px-5 py-4">
        {tab === "agencias" && <AgenciesAdmin />}
        {tab === "imoveis" && <PropertiesAdmin />}
        {tab === "lives" && <LiveFeesAdmin />}
      </div>
    </AppShell>
  );
}

function AgenciesAdmin() {
  const [rows, setRows] = useState<Agency[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("real_estate_agencies").select("id,name,nif,phone,status,rejection_reason").order("created_at", { ascending: false });
    setRows((data as Agency[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const approve = async (id: string) => {
    const { error } = await (supabase as any).rpc("admin_approve_agency", { _agency_id: id });
    if (error) return toast.error(error.message);
    toast.success("Aprovada"); load();
  };
  const reject = async (id: string) => {
    const reason = prompt("Motivo da rejeição?") ?? "";
    if (!reason) return;
    const { error } = await (supabase as any).rpc("admin_reject_agency", { _agency_id: id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Rejeitada"); load();
  };
  if (loading) return <Spinner />;
  return (
    <div className="space-y-2">
      {rows.map((a) => (
        <div key={a.id} className="rounded-xl border border-border p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{a.name}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeColor(a.status)}`}>{a.status}</span>
          </div>
          <p className="text-xs text-muted-foreground">NIF {a.nif} · {a.phone}</p>
          {a.status === "pending" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => approve(a.id)}>Aprovar</Button>
              <Button size="sm" variant="outline" onClick={() => reject(a.id)}>Rejeitar</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PropertiesAdmin() {
  const [rows, setRows] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("properties").select("id,title,status,price_aoa,agency_id,real_estate_agencies(name)").order("created_at", { ascending: false });
    setRows((data as Property[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const approve = async (id: string) => {
    const { error } = await (supabase as any).rpc("admin_approve_property", { _property_id: id });
    if (error) return toast.error(error.message);
    toast.success("Aprovado"); load();
  };
  const reject = async (id: string) => {
    const reason = prompt("Motivo?") ?? "";
    if (!reason) return;
    const { error } = await (supabase as any).rpc("admin_reject_property", { _property_id: id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Rejeitado"); load();
  };
  if (loading) return <Spinner />;
  return (
    <div className="space-y-2">
      {rows.map((p) => (
        <div key={p.id} className="rounded-xl border border-border p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{p.title}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeColor(p.status)}`}>{p.status}</span>
          </div>
          <p className="text-xs text-muted-foreground">{p.real_estate_agencies?.name ?? "—"} · {Number(p.price_aoa).toLocaleString("pt-AO")} Kz</p>
          <div className="mt-2 flex gap-2">
            <Link to="/imoveis/$id" params={{ id: p.id }} className="text-xs text-primary underline">Ver imóvel</Link>
            {p.status === "pending" && (
              <>
                <Button size="sm" onClick={() => approve(p.id)}>Aprovar</Button>
                <Button size="sm" variant="outline" onClick={() => reject(p.id)}>Rejeitar</Button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiveFeesAdmin() {
  const [rows, setRows] = useState<Fee[]>([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("agency_live_fees").select("*, real_estate_agencies(name)").order("created_at", { ascending: false });
    setRows((data as Fee[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);
  const approve = async (id: string) => {
    const { error } = await (supabase as any).rpc("admin_approve_agency_live_fee", { _fee_id: id });
    if (error) return toast.error(error.message);
    toast.success("Aprovado"); load();
  };
  const reject = async (id: string) => {
    const reason = prompt("Motivo?") ?? "";
    if (!reason) return;
    const { error } = await (supabase as any).rpc("admin_reject_agency_live_fee", { _fee_id: id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Rejeitado"); load();
  };
  if (loading) return <Spinner />;
  return (
    <div className="space-y-2">
      {rows.map((f) => (
        <div key={f.id} className="rounded-xl border border-border p-3 text-sm">
          <div className="flex items-center justify-between">
            <p className="font-semibold">{f.real_estate_agencies?.name ?? "—"}</p>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${badgeColor(f.status)}`}>{f.status}</span>
          </div>
          <p className="text-xs text-muted-foreground">{Number(f.amount_aoa).toLocaleString("pt-AO")} Kz · {f.payment_method ?? "—"}</p>
          {f.proof_url && /^https:\/\//i.test(f.proof_url) && (
            <a href={f.proof_url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline">
              <ExternalLink size={11} /> Ver comprovativo
            </a>
          )}
          {f.status !== "approved" && f.status !== "rejected" && (
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => approve(f.id)}>Aprovar</Button>
              <Button size="sm" variant="outline" onClick={() => reject(f.id)}>Rejeitar</Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Spinner() { return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>; }
function badgeColor(s: string) {
  if (s === "approved" || s === "active") return "bg-green-500/15 text-green-700";
  if (s === "rejected") return "bg-destructive/15 text-destructive";
  return "bg-yellow-500/15 text-yellow-700";
}