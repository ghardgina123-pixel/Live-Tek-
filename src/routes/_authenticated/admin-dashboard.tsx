import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { useEffect, useState } from "react";
import { ArrowLeft, Store as StoreIcon, Home as HomeIcon, Building2, CheckCircle2, XCircle, Loader2, UserPlus, Sparkles } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin-dashboard")({
  head: () => ({ meta: [{ title: "Admin · Painel — Live Teká" }] }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    const isAdmin = (roles ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw redirect({ to: "/perfil" });
  },
  component: AdminHub,
  errorComponent: PanelErrorBoundary,
});

type StoreRow = { id: string; name: string; status: string; phone: string | null; category: string | null; created_at: string };

function AdminHub() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Painel do Administrador</h1>
          <p className="text-xs text-white/80">Aprovações e gestão de membros</p>
        </div>
        <HomeIcon size={20} />
      </header>

      <div className="cv-auto px-5 py-4 space-y-3">
        <Link to="/admin/lojas" className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <StoreIcon className="text-primary" />
          <div className="flex-1">
            <p className="font-semibold">Aprovação de Lojas</p>
            <p className="text-xs text-muted-foreground">Revisar lojas pendentes</p>
          </div>
        </Link>
        <Link to="/admin/imobiliarias" className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <Building2 className="text-primary" />
          <div className="flex-1">
            <p className="font-semibold">Imobiliárias</p>
            <p className="text-xs text-muted-foreground">Agências, imóveis e taxas de live</p>
          </div>
        </Link>
        <Link to="/admin-crm" className="flex items-center gap-3 rounded-2xl border bg-card p-4 shadow-sm">
          <Sparkles className="text-primary" />
          <div className="flex-1">
            <p className="font-semibold">CRM · Assinaturas</p>
            <p className="text-xs text-muted-foreground">Aprovar planos CRM e comprovativos</p>
          </div>
        </Link>
      </div>

      <PendingApprovals />
      <MembersManagement />
    </AppShell>
  );
}

function PendingApprovals() {
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("stores")
      .select("id,name,status,phone,category,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    setRows((data as StoreRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const approve = async (s: StoreRow) => {
    setBusy(s.id);
    const { error } = await supabase.rpc("admin_approve_store", { _store_id: s.id });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Loja "${s.name}" aprovada.`); load();
  };
  const reject = async (s: StoreRow) => {
    const reason = window.prompt("Motivo da rejeição:", "") ?? "";
    if (!reason) return;
    setBusy(s.id);
    const { error } = await supabase.rpc("admin_reject_store", { _store_id: s.id, _reason: reason });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Loja "${s.name}" rejeitada.`); load();
  };

  return (
    <section className="cv-auto px-5 py-4">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">Aprovação de Lojas · Pendentes</h2>
      {loading ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" /></div>
        : rows.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma loja pendente.</p>
        : (
          <div className="space-y-2">
            {rows.map((s) => (
              <article key={s.id} className="rounded-xl border bg-card p-3 text-sm">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{s.name}</p>
                  <span className="rounded-full bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-yellow-700">Pendente</span>
                </div>
                <p className="text-xs text-muted-foreground">{s.category ?? "—"} · {s.phone ?? "—"}</p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={() => approve(s)} disabled={busy === s.id}>
                    {busy === s.id ? <Loader2 className="animate-spin" size={14} /> : <CheckCircle2 size={14} />}<span className="ml-1">Aprovar</span>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => reject(s)} disabled={busy === s.id} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                    <XCircle size={14} /><span className="ml-1">Rejeitar</span>
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
    </section>
  );
}

function MembersManagement() {
  const [active, setActive] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("stores")
      .select("id,name,status,phone,category,created_at")
      .eq("status", "active")
      .order("created_at", { ascending: false });
    setActive((data as StoreRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !name) return toast.error("E-mail e nome são obrigatórios.");
    setCreating(true);
    const { error } = await supabase.rpc("admin_create_store_for_email" as never, {
      _email: email, _name: name, _category: category || null, _phone: phone || null, _activate: true,
    } as never);
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("Loja criada e ativada.");
    setEmail(""); setName(""); setCategory(""); setPhone(""); load();
  };

  return (
    <section className="cv-auto px-5 py-4 space-y-4">
      <div>
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wider text-muted-foreground">Gestão de Membros · Lojas Ativas</h2>
        {loading ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" /></div>
          : active.length === 0 ? <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma loja ativa.</p>
          : (
            <div className="space-y-2">
              {active.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-xl border bg-card p-3 text-sm">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.category ?? "—"} · {s.phone ?? "—"}</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700">Ativa</span>
                </div>
              ))}
            </div>
          )}
      </div>

      <form onSubmit={invite} className="rounded-2xl border bg-card p-4 space-y-2">
        <div className="flex items-center gap-2">
          <UserPlus className="text-primary" size={18} />
          <h3 className="font-semibold">Adicionar loja manualmente</h3>
        </div>
        <p className="text-xs text-muted-foreground">O e-mail deve corresponder a um utilizador já registado.</p>
        <Input placeholder="E-mail do dono" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <Input placeholder="Nome da loja" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input placeholder="Categoria (opcional)" value={category} onChange={(e) => setCategory(e.target.value)} />
        <Input placeholder="Telefone (opcional)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <Button type="submit" disabled={creating} className="w-full">
          {creating ? <Loader2 className="animate-spin" size={16} /> : <UserPlus size={16} />}
          <span className="ml-1">Criar e ativar loja</span>
        </Button>
      </form>
    </section>
  );
}