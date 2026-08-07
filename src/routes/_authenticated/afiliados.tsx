import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Users, Share2, Gift, Copy, Check, Loader2, Wallet, Store as StoreIcon, BadgePercent } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AFFILIATE_RULES, affiliateLink } from "@/lib/affiliate";
import { PayoutWallet } from "@/components/PayoutWallet";
import { toast } from "sonner";

type Commission = {
  id: string;
  source: string;
  amount_aoa: number;
  status: string;
  note: string | null;
  created_at: string;
};

type Dashboard = {
  code: string | null;
  referrals_total: number;
  stores_total: number;
  pending_aoa: number;
  released_aoa: number;
  paid_aoa: number;
  commissions: Commission[];
};

const kz = (v: number) =>
  "Kz " + Number(v || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const SOURCE_LABEL: Record<string, string> = {
  signup: "Novo utilizador indicado",
  order_buyer: "Compra de utilizador indicado",
  order_store: "Venda de loja indicada",
  subscription: "Subscrição de loja indicada",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  released: "Disponível",
  paid: "Pago",
  cancelled: "Cancelado",
};

export const Route = createFileRoute("/_authenticated/afiliados")({
  head: () => ({ meta: [{ title: "Afiliados — Live Teká" }] }),
  component: Afiliados,
});

function Afiliados() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const { data: raw, error } = await supabase.rpc("affiliate_dashboard");
    if (error) { toast.error("Não foi possível carregar o painel de afiliados."); setLoading(false); return; }
    setData(raw as unknown as Dashboard);
    setLoading(false);
  };

  useEffect(() => { void load(); }, []);

  const generate = async () => {
    setGenerating(true);
    const { error } = await supabase.rpc("affiliate_get_or_create_code");
    setGenerating(false);
    if (error) { toast.error("Não foi possível gerar o seu link."); return; }
    await load();
    toast.success("Link de afiliado criado!");
  };

  const link = data?.code ? affiliateLink(data.code) : "";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Link copiado!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copie manualmente: " + link);
    }
  };

  const share = async () => {
    if (typeof navigator !== "undefined" && navigator.share) {
      try { await navigator.share({ title: "Live Teká", text: "Junte-se à Live Teká", url: link }); return; } catch { /* cancelado */ }
    }
    void copy();
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Programa de Afiliados</h1>
      </header>
      <div className="px-5 py-6">
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-accent p-5">
          <Users className="text-primary" size={28} />
          <h2 className="mt-3 text-lg font-bold">Indique e ganhe</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Convide amigos e lojas para a Live Teká e receba comissão sobre cada venda realizada por eles.
          </p>
        </div>

        {loading ? (
          <div className="mt-6 flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : (
          <>
            <section className="mt-6 rounded-2xl border border-border p-4">
              <p className="text-sm font-semibold">O seu link de afiliado</p>
              {data?.code ? (
                <>
                  <div className="mt-3 flex items-center gap-2 rounded-xl bg-accent px-3 py-2">
                    <p className="flex-1 truncate text-xs text-accent-foreground">{link}</p>
                    <button
                      onClick={copy}
                      aria-label="Copiar link"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background"
                    >
                      {copied ? <Check size={15} className="text-primary" /> : <Copy size={15} />}
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">Código: <span className="font-mono font-semibold">{data.code}</span></p>
                  <Button onClick={share} className="mt-3 w-full gap-2"><Share2 size={16} /> Partilhar link</Button>
                </>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">Crie o seu link único para começar a indicar.</p>
                  <Button onClick={generate} disabled={generating} className="mt-3 w-full gap-2">
                    {generating ? <Loader2 size={16} className="animate-spin" /> : <Gift size={16} />} Gerar meu link
                  </Button>
                </>
              )}
            </section>

            <section className="mt-4 grid grid-cols-2 gap-3">
              <Stat icon={<Users size={16} />} label="Indicações" value={String(data?.referrals_total ?? 0)} />
              <Stat icon={<StoreIcon size={16} />} label="Lojas indicadas" value={String(data?.stores_total ?? 0)} />
              <Stat icon={<Wallet size={16} />} label="Disponível" value={kz(data?.released_aoa ?? 0)} />
              <Stat icon={<BadgePercent size={16} />} label="Pendente" value={kz(data?.pending_aoa ?? 0)} />
            </section>

            <PayoutWallet kind="affiliate" subtitle="Comissões libertadas, prontas para levantamento." />

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Regras do programa</h3>
              <div className="mt-3 space-y-3">
                <Item icon={<Gift size={18} />} title={`Bónus de ${kz(AFFILIATE_RULES.signupBonusAoa)} por novo utilizador`} desc="Creditado quando alguém cria conta com o seu link (fica pendente até validação)." />
                <Item icon={<BadgePercent size={18} />} title={`${AFFILIATE_RULES.buyerOrderPct}% em cada compra do indicado`} desc="Sobre o total do pedido, libertado quando a encomenda é entregue." />
                <Item icon={<StoreIcon size={18} />} title={`${AFFILIATE_RULES.storeOrderPct}% nas vendas de lojas indicadas`} desc="Sobre cada pedido entregue da loja que você trouxe para a plataforma." />
                <Item icon={<Wallet size={18} />} title={`${AFFILIATE_RULES.subscriptionPct}% em cada subscrição`} desc="Sempre que uma loja indicada ativa ou renova o plano." />
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                Não é permitido auto-indicação. Cada utilizador só pode ser indicado uma vez e pelo primeiro link usado.
                Comissões de pedidos cancelados ou reembolsados são anuladas. Pagamentos são efetuados pela equipa Live Teká
                sobre o saldo disponível.
              </p>
            </section>

            <section className="mt-6">
              <h3 className="text-sm font-semibold">Histórico de comissões</h3>
              {(data?.commissions?.length ?? 0) === 0 ? (
                <p className="mt-2 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Ainda sem comissões. Partilhe o seu link para começar a ganhar.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {data!.commissions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{SOURCE_LABEL[c.source] ?? c.source}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(c.created_at).toLocaleDateString("pt-AO")} · {STATUS_LABEL[c.status] ?? c.status}
                        </p>
                      </div>
                      <p className="shrink-0 text-sm font-semibold text-primary">{kz(c.amount_aoa)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="flex items-center gap-2 text-muted-foreground">{icon}<span className="text-[11px]">{label}</span></div>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}

function Item({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border p-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">{icon}</div>
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
    </div>
  );
}