import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Sparkles, Users, MessageSquare, BarChart3, Tag, Loader2, Upload, XCircle, Clock, FileCheck2, Send, TrendingUp, ShoppingBag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { BrandLogo, getBrand } from "@/lib/payment-brands";

export const Route = createFileRoute("/_authenticated/lojista-crm")({
  head: () => ({ meta: [{ title: "CRM Premium — Live Teká" }] }),
  component: CRM,
});

const PRICE_AOA = 9900;

type Sub = {
  id: string;
  status: string;
  expires_at: string | null;
  started_at: string | null;
  payment_method: string | null;
  proof_url: string | null;
  rejection_reason: string | null;
};

const PAYMENT_METHODS = [
  { value: "multicaixa_express", label: "Multicaixa Express" },
  { value: "ekwanza", label: "e-Kwanza" },
  { value: "unitel_money", label: "Unitel Money" },
  { value: "afrimoney", label: "Afrimoney" },
  { value: "kwik", label: "Kwik" },
  { value: "multicaixa_reference", label: "Referência Multicaixa" },
];

function CRM() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [sub, setSub] = useState<Sub | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    if (!user) return;
    const { data: s } = await supabase.from("stores").select("id").eq("owner_id", user.id).maybeSingle();
    if (!s) { setLoading(false); return; }
    setStoreId(s.id);
    const { data } = await supabase
      .from("store_subscriptions")
      .select("id, status, expires_at, started_at, payment_method, proof_url, rejection_reason")
      .eq("store_id", s.id)
      .eq("plan", "crm")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setSub((data as Sub) ?? null);
    setLoading(false);
  };

  useEffect(() => { refresh();  }, [user?.id]);

  const subscribe = async () => {
    if (!storeId) return;
    setBusy(true);
    const { error } = await supabase.from("store_subscriptions").insert({
      store_id: storeId,
      plan: "crm",
      status: "pending",
      price_aoa: PRICE_AOA,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Assinatura criada! Agora envie o comprovativo.");
    refresh();
  };

  const active = sub?.status === "active" && (!sub.expires_at || new Date(sub.expires_at) > new Date());
  const expired = sub?.status === "active" && sub.expires_at && new Date(sub.expires_at) <= new Date();

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/lojista" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">CRM Premium <Sparkles size={16} className="text-amber-300" /></h1>
          <p className="text-xs text-white/80">Ferramenta exclusiva para lojistas</p>
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : !storeId ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-muted-foreground">Você precisa ter uma loja para assinar o CRM.</p>
          <Link to="/lojista" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Abrir minha loja</Link>
        </div>
      ) : active && !expired ? (
        <ActiveView expiresAt={sub!.expires_at} storeId={storeId} />
      ) : sub && sub.status === "pending" ? (
        <PendingView sub={sub} storeId={storeId} onRefresh={refresh} />
      ) : sub && sub.status === "rejected" ? (
        <RejectedView sub={sub} storeId={storeId} onRefresh={refresh} />
      ) : (
        <Paywall onSubscribe={subscribe} busy={busy} expired={!!expired} />
      )}
    </AppShell>
  );
}

type CustomerRow = {
  customer_id: string;
  display_name: string | null;
  avatar_url: string | null;
  orders_count: number;
  paid_count: number;
  total_spent: number;
  last_order_at: string;
};

const PAID_STATUSES = ["paid", "preparing", "shipped", "delivered"];

function ActiveView({ expiresAt, storeId }: { expiresAt: string | null; storeId: string }) {
  const [open, setOpen] = useState<null | "clientes" | "relatorios" | "campanhas" | "tags">(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: orders } = await supabase
        .from("orders")
        .select("id, customer_id, total_aoa, status, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false });
      const list = (orders ?? []) as { id: string; customer_id: string; total_aoa: number; status: string; created_at: string }[];
      const map = new Map<string, CustomerRow>();
      for (const o of list) {
        const paid = PAID_STATUSES.includes(o.status);
        const cur = map.get(o.customer_id);
        if (!cur) {
          map.set(o.customer_id, {
            customer_id: o.customer_id,
            display_name: null,
            avatar_url: null,
            orders_count: 1,
            paid_count: paid ? 1 : 0,
            total_spent: paid ? Number(o.total_aoa) : 0,
            last_order_at: o.created_at,
          });
        } else {
          cur.orders_count += 1;
          if (paid) { cur.paid_count += 1; cur.total_spent += Number(o.total_aoa); }
          if (o.created_at > cur.last_order_at) cur.last_order_at = o.created_at;
        }
      }
      const ids = Array.from(map.keys());
      if (ids.length) {
        const { data: profs } = await supabase
          .from("public_profiles")
          .select("id, display_name, avatar_url")
          .in("id", ids);
        for (const p of (profs ?? []) as { id: string; display_name: string | null; avatar_url: string | null }[]) {
          const c = map.get(p.id);
          if (c) { c.display_name = p.display_name; c.avatar_url = p.avatar_url; }
        }
      }
      setCustomers(Array.from(map.values()).sort((a, b) => b.total_spent - a.total_spent));
      setLoading(false);
    })();
  }, [storeId]);

  return (
    <div className="px-5 py-6">
      <div className="rounded-2xl bg-gradient-to-br from-amber-100 to-orange-100 p-5">
        <Sparkles className="text-orange-500" size={24} />
        <p className="mt-2 text-sm font-bold">CRM ativo</p>
        {expiresAt && <p className="text-xs text-muted-foreground">Renovação em {new Date(expiresAt).toLocaleDateString("pt-AO")}</p>}
      </div>
      <div className="mt-5 space-y-3">
        <Feature onClick={() => setOpen("clientes")} icon={<Users size={18} />} title="Meus clientes" desc={loading ? "A carregar…" : `${customers.length} cliente(s) com pedidos.`} />
        <Feature onClick={() => setOpen("relatorios")} icon={<BarChart3 size={18} />} title="Relatórios" desc="Ticket médio, volume de vendas e recompra." />
        <Feature onClick={() => setOpen("campanhas")} icon={<MessageSquare size={18} />} title="Campanhas" desc="Enviar mensagens em massa pelo chat." />
        <Feature onClick={() => setOpen("tags")} icon={<Tag size={18} />} title="Segmentação" desc="Tags e notas internas por cliente." />
      </div>
      <Sheet open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
          {open === "clientes" && <ClientesPanel customers={customers} loading={loading} />}
          {open === "relatorios" && <RelatoriosPanel storeId={storeId} customers={customers} />}
          {open === "campanhas" && <CampanhasPanel storeId={storeId} customers={customers} onDone={() => setOpen(null)} />}
          {open === "tags" && (
            <>
              <SheetHeader className="text-left">
                <SheetTitle>Tags e notas</SheetTitle>
                <SheetDescription>Organize a sua carteira de clientes.</SheetDescription>
              </SheetHeader>
              <p className="mt-4 text-sm text-muted-foreground">
                Segmentação por tags (VIP, atacado, devedor) e notas privadas por cliente. Módulo em preparação.
              </p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ClientesPanel({ customers, loading }: { customers: CustomerRow[]; loading: boolean }) {
  const [q, setQ] = useState("");
  const filtered = customers.filter((c) => (c.display_name ?? "").toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>Meus clientes</SheetTitle>
        <SheetDescription>Histórico agregado de quem comprou na sua loja.</SheetDescription>
      </SheetHeader>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por nome…"
        className="mt-3 h-10 w-full rounded-xl border border-border bg-background px-3 text-sm"
      />
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
      ) : (
        <ul className="mt-3 space-y-2 pb-4">
          {filtered.map((c) => (
            <li key={c.customer_id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-bold uppercase text-accent-foreground">
                {c.avatar_url ? <img loading="lazy" decoding="async" src={c.avatar_url} alt="" className="h-full w-full object-cover" /> : (c.display_name ?? "?").slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{c.display_name ?? "Cliente"}</p>
                <p className="text-[11px] text-muted-foreground">
                  {c.paid_count}/{c.orders_count} pedido(s) pagos · última {new Date(c.last_order_at).toLocaleDateString("pt-AO")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold">Kz {c.total_spent.toLocaleString("pt-AO")}</p>
                <p className="text-[10px] uppercase text-muted-foreground">Total gasto</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RelatoriosPanel({ storeId, customers }: { storeId: string; customers: CustomerRow[] }) {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<{ total: number; count: number; avg: number; daily: { day: string; total: number }[] } | null>(null);

  useEffect(() => {
    (async () => {
      setData(null);
      const since = new Date(); since.setDate(since.getDate() - period);
      const { data: rows } = await supabase
        .from("orders")
        .select("total_aoa, status, created_at")
        .eq("store_id", storeId)
        .gte("created_at", since.toISOString());
      const list = (rows ?? []) as { total_aoa: number; status: string; created_at: string }[];
      const paid = list.filter((o) => PAID_STATUSES.includes(o.status));
      const total = paid.reduce((s, o) => s + Number(o.total_aoa), 0);
      const count = paid.length;
      const daily: Record<string, number> = {};
      for (let i = period - 1; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        daily[d.toISOString().slice(0, 10)] = 0;
      }
      paid.forEach((o) => {
        const k = new Date(o.created_at).toISOString().slice(0, 10);
        if (k in daily) daily[k] += Number(o.total_aoa);
      });
      setData({ total, count, avg: count ? total / count : 0, daily: Object.entries(daily).map(([day, total]) => ({ day, total })) });
    })();
  }, [storeId, period]);

  const repeat = customers.filter((c) => c.paid_count >= 2).length;

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>Relatórios</SheetTitle>
        <SheetDescription>Métricas de desempenho da sua loja.</SheetDescription>
      </SheetHeader>
      <div className="mt-3 flex gap-2">
        {([7, 30, 90] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${period === p ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {p}d
          </button>
        ))}
      </div>
      {!data ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin" /></div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <MetricCard icon={ShoppingBag} label="Volume de vendas" value={`Kz ${data.total.toLocaleString("pt-AO")}`} />
            <MetricCard icon={TrendingUp} label="Ticket médio" value={`Kz ${Math.round(data.avg).toLocaleString("pt-AO")}`} />
            <MetricCard icon={ShoppingBag} label="Pedidos pagos" value={String(data.count)} />
            <MetricCard icon={Users} label="Clientes recorrentes" value={String(repeat)} />
          </div>
          <div className="mt-4 rounded-2xl border border-border p-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Vendas por dia</p>
            <div className="flex h-28 items-end gap-0.5">
              {data.daily.map((d) => {
                const max = Math.max(1, ...data.daily.map((x) => x.total));
                return (
                  <div key={d.day} className="flex flex-1 flex-col items-center">
                    <div className="w-full rounded-t bg-primary/80" style={{ height: `${(d.total / max) * 100}%`, minHeight: 1 }} title={`Kz ${d.total.toLocaleString("pt-AO")}`} />
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Users; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <Icon size={14} className="text-primary" />
      <p className="mt-1 text-[10px] uppercase text-muted-foreground">{label}</p>
      <p className="text-sm font-bold">{value}</p>
    </div>
  );
}

function CampanhasPanel({ storeId, customers, onDone }: { storeId: string; customers: CustomerRow[]; onDone: () => void }) {
  const { user } = useAuth();
  const [segment, setSegment] = useState<"all" | "vip" | "recent" | "custom">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const now = Date.now();
  const segmented = customers.filter((c) => {
    if (segment === "vip") return c.total_spent >= 50000;
    if (segment === "recent") return now - new Date(c.last_order_at).getTime() < 30 * 86400_000;
    return true;
  });
  const recipients = segment === "custom"
    ? customers.filter((c) => selected.has(c.customer_id))
    : segmented;

  const send = async () => {
    if (!user) return;
    if (!text.trim()) return toast.error("Escreva a mensagem");
    if (recipients.length === 0) return toast.error("Nenhum destinatário");
    setBusy(true);
    try {
      let sent = 0;
      for (const c of recipients) {
        // Ensure conversation exists
        const { data: conv, error: cErr } = await supabase
          .from("conversations")
          .upsert({ customer_id: c.customer_id, store_id: storeId }, { onConflict: "customer_id,store_id" })
          .select("id")
          .single();
        if (cErr || !conv) continue;
        const { error: mErr } = await supabase.from("messages").insert({
          conversation_id: conv.id,
          sender_id: user.id,
          text: text.trim(),
        });
        if (!mErr) sent++;
      }
      toast.success(`Campanha enviada para ${sent} cliente(s).`);
      setText("");
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SheetHeader className="text-left">
        <SheetTitle>Campanha no chat</SheetTitle>
        <SheetDescription>Envie uma mensagem em massa para um grupo de clientes.</SheetDescription>
      </SheetHeader>
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          { v: "all", l: "Todos" },
          { v: "vip", l: "VIP (≥50k)" },
          { v: "recent", l: "Últimos 30d" },
          { v: "custom", l: "Selecionar" },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => setSegment(s.v as typeof segment)}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${segment === s.v ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            {s.l}
          </button>
        ))}
      </div>

      {segment === "custom" && (
        <div className="mt-3 max-h-52 space-y-1 overflow-y-auto rounded-xl border border-border p-2">
          {customers.length === 0 && <p className="p-2 text-xs text-muted-foreground">Nenhum cliente.</p>}
          {customers.map((c) => {
            const on = selected.has(c.customer_id);
            return (
              <label key={c.customer_id} className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-accent/40">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    const n = new Set(selected);
                    if (on) n.delete(c.customer_id); else n.add(c.customer_id);
                    setSelected(n);
                  }}
                />
                <span className="truncate text-sm">{c.display_name ?? "Cliente"}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">Kz {c.total_spent.toLocaleString("pt-AO")}</span>
              </label>
            );
          })}
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground">{recipients.length} destinatário(s)</p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder="Ex.: Olá! Temos 20% off até domingo — corre à loja 🎁"
        className="mt-2 w-full rounded-xl border border-border bg-background p-3 text-sm"
      />
      <Button
        onClick={send}
        disabled={busy || recipients.length === 0 || !text.trim()}
        className="mt-3 h-11 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-white"
      >
        {busy ? <Loader2 className="animate-spin" /> : (<><Send size={16} className="mr-2" /> Enviar para {recipients.length}</>)}
      </Button>
    </>
  );
}

function Paywall({ onSubscribe, busy, expired }: { onSubscribe: () => void; busy: boolean; expired: boolean }) {
  return (
    <div className="px-5 py-6">
      {expired && (
        <div className="mb-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          Sua assinatura expirou. Renove para continuar a usar o CRM.
        </div>
      )}
      <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-orange-50 p-5 ring-1 ring-orange-200">
        <div className="flex items-center gap-2">
          <Sparkles className="text-orange-500" size={20} />
          <span className="rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase text-white">PRO</span>
        </div>
        <h2 className="mt-2 text-xl font-bold">Cresça sua loja com CRM</h2>
        <p className="mt-1 text-sm text-muted-foreground">Conheça seus clientes, fidelize e venda mais com mensagens segmentadas.</p>
        <p className="mt-3 text-2xl font-bold">Kz {PRICE_AOA.toLocaleString("pt-AO")}<span className="text-sm font-normal text-muted-foreground"> / mês</span></p>
      </div>

      <div className="mt-5 space-y-3">
        <Feature icon={<Users size={18} />} title="Base de clientes" desc="Veja quem comprou, quando e o quê." />
        <Feature icon={<BarChart3 size={18} />} title="Relatórios e métricas" desc="Acompanhe o desempenho da loja." />
        <Feature icon={<MessageSquare size={18} />} title="Campanhas no chat" desc="Envie ofertas para grupos de clientes." />
        <Feature icon={<Tag size={18} />} title="Tags e notas" desc="Organize e segmente sua carteira." />
      </div>

      <Button
        onClick={onSubscribe}
        disabled={busy}
        className="mt-6 h-12 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-base font-bold text-white shadow-md hover:opacity-95"
      >
        {busy ? <Loader2 className="animate-spin" /> : expired ? "Renovar assinatura" : "Assinar CRM Premium"}
      </Button>
    </div>
  );
}

function PendingView({ sub, storeId, onRefresh }: { sub: Sub; storeId: string; onRefresh: () => void }) {
  const hasProof = !!sub.proof_url;
  return (
    <div className="px-5 py-6 space-y-5">
      <StatusBanner
        tone="pending"
        icon={<Clock size={18} />}
        title={hasProof ? "Aguardando confirmação" : "Envie o comprovativo"}
        desc={hasProof
          ? "Recebemos seu comprovativo. A nossa equipa irá validar em até 24h."
          : "Realize o pagamento de Kz " + PRICE_AOA.toLocaleString("pt-AO") + " e anexe o comprovativo abaixo."}
      />
      <PaymentForm sub={sub} storeId={storeId} onSaved={onRefresh} />
    </div>
  );
}

function RejectedView({ sub, storeId, onRefresh }: { sub: Sub; storeId: string; onRefresh: () => void }) {
  return (
    <div className="px-5 py-6 space-y-5">
      <StatusBanner
        tone="rejected"
        icon={<XCircle size={18} />}
        title="Comprovativo recusado"
        desc={sub.rejection_reason || "O comprovativo enviado não foi aceite. Por favor, envie um novo."}
      />
      <PaymentForm sub={sub} storeId={storeId} onSaved={onRefresh} forceResubmit />
    </div>
  );
}

function StatusBanner({ tone, icon, title, desc }: { tone: "pending" | "rejected"; icon: React.ReactNode; title: string; desc: string }) {
  const cls = tone === "pending"
    ? "bg-amber-50 ring-amber-200 text-amber-900"
    : "bg-red-50 ring-red-200 text-red-900";
  return (
    <div className={`flex gap-3 rounded-2xl p-4 ring-1 ${cls}`}>
      <div className="mt-0.5">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="mt-0.5 text-xs opacity-90">{desc}</p>
      </div>
    </div>
  );
}

function PaymentForm({ sub, storeId, onSaved, forceResubmit }: { sub: Sub; storeId: string; onSaved: () => void; forceResubmit?: boolean }) {
  const [method, setMethod] = useState(sub.payment_method ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!method) return toast.error("Selecione o método de pagamento");
    if (!file && (!sub.proof_url || forceResubmit)) return toast.error("Anexe o comprovativo");
    setBusy(true);
    try {
      let proofUrl = sub.proof_url;
      if (file) {
        const ext = file.name.split(".").pop() ?? "bin";
        const path = `${storeId}/${sub.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("subscription-proofs")
          .upload(path, file, { upsert: true, contentType: file.type });
        if (upErr) throw upErr;
        proofUrl = path;
      }
      // Se foi rejeitada, reabrir como pending para nova analise
      const patch: {
        payment_method: string;
        proof_url: string | null;
        status?: string;
        rejection_reason?: string | null;
      } = { payment_method: method, proof_url: proofUrl };
      if (sub.status === "rejected") {
        patch.status = "pending";
        patch.rejection_reason = null;
      }
      const { error } = await supabase
        .from("store_subscriptions")
        .update(patch)
        .eq("id", sub.id);
      if (error) throw error;
      toast.success("Comprovativo enviado! Aguarde validação.");
      setFile(null);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-border p-4">
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Método de pagamento</label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {PAYMENT_METHODS.map((m) => {
            const brand = getBrand(m.value);
            const active = method === m.value;
            return (
              <button
                type="button"
                key={m.value}
                onClick={() => setMethod(m.value)}
                className="flex items-center gap-2 rounded-xl border p-2 text-left transition"
                style={{
                  borderColor: active ? brand.bg : "hsl(var(--border))",
                  background: active ? brand.tint : "transparent",
                  boxShadow: active ? `0 0 0 2px ${brand.ring}` : undefined,
                }}
              >
                <BrandLogo methodType={m.value} size={32} rounded="rounded-lg" />
                <span className="text-[12px] font-semibold leading-tight">{m.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-xs font-semibold text-muted-foreground">Comprovativo (imagem ou PDF)</label>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm"
        >
          <Upload size={16} />
          {file ? file.name : sub.proof_url && !forceResubmit ? "Substituir comprovativo" : "Anexar ficheiro"}
        </button>
        {sub.proof_url && !file && (
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <FileCheck2 size={12} /> Comprovativo anterior em análise.
          </p>
        )}
      </div>

      <Button
        onClick={submit}
        disabled={busy}
        className="h-11 w-full rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 font-semibold text-white"
      >
        {busy ? <Loader2 className="animate-spin" /> : "Enviar para análise"}
      </Button>

      <p className="text-[11px] text-muted-foreground">
        Após validação pela equipa Live Teká, o acesso ao CRM será ativado automaticamente.
      </p>
    </div>
  );
}

function Feature({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick?: () => void }) {
  const cls = "flex w-full items-start gap-3 rounded-xl border border-border p-3 text-left transition";
  const content = (
    <>
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} hover:bg-accent/40 active:scale-[0.99]`}>
        {content}
      </button>
    );
  }
  return (
    <div className={cls}>{content}</div>
  );
}