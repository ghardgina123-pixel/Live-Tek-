import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Crown, Download, ShieldCheck, AlertTriangle, Copy, Radio, Ban } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionStatus } from "@/hooks/use-subscription";
import { recommendedPlanCode, serviceCategoryLabel } from "@/lib/services";
import { createSubscriptionCheckout, cancelSubscription } from "@/lib/subscriptions.functions";
import type { InvoiceData } from "@/lib/invoice-pdf";

// jsPDF só é descarregado quando o lojista pede efetivamente a fatura.
const downloadInvoice = async (inv: InvoiceData) => {
  const { generateInvoicePdf } = await import("@/lib/invoice-pdf");
  generateInvoicePdf(inv);
};
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/lojista/subscricao")({
  head: () => ({
    meta: [
      { title: "Subscrição e faturação — Live Teká" },
      { name: "description", content: "Gerir o plano de parceiro, pagar por Multicaixa Express e descarregar faturas." },
      { property: "og:title", content: "Subscrição e faturação — Live Teká" },
      { property: "og:description", content: "Planos Básico, Profissional e Elite para parceiros Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShellPage,
});

type Plan = {
  id: string;
  code: string;
  name: string;
  price_aoa: number;
  period_days: number;
  max_lives_per_month: number | null;
  features: string[];
  sort_order: number;
  description: string | null;
  categories: string[] | null;
  audience: string;
};

type Sub = {
  id: string;
  plan: string;
  status: string;
  price_aoa: number;
  reference: string | null;
  expires_at: string | null;
  created_at: string;
};

const kz = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { maximumFractionDigits: 0 })}`;
const dt = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-AO") : "—");

type HistoryRow = { id: string; from_status: string | null; to_status: string; created_at: string };

const STATE_UI: Record<string, { title: string; tone: string; icon: typeof ShieldCheck }> = {
  active: { title: "Plano ativo", tone: "border-primary/40 bg-primary/5", icon: ShieldCheck },
  grace: { title: "Subscrição em carência", tone: "border-amber-500/40 bg-amber-500/5", icon: AlertTriangle },
  suspended: { title: "Subscrição suspensa", tone: "border-destructive/40 bg-destructive/5", icon: Ban },
  inactive: { title: "Sem subscrição ativa", tone: "border-amber-500/40 bg-amber-500/5", icon: AlertTriangle },
};

function SubscriptionManager() {
  const { t } = useT();
  const { store } = useLojistaStore();
  const storeId = store?.id;
  const { status, usage, reload } = useSubscriptionStatus(storeId);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    const [{ data: p }, { data: s }, { data: inv }, { data: hist }] = await Promise.all([
      supabase.from("subscription_plans").select("*").eq("is_active", true).order("sort_order"),
      supabase
        .from("store_subscriptions")
        .select("id, plan, status, price_aoa, reference, expires_at, created_at")
        .eq("store_id", storeId)
        .neq("plan", "signup_fee")
        .order("created_at", { ascending: false }),
      supabase
        .from("subscription_invoices")
        .select("*")
        .eq("store_id", storeId)
        .order("issued_at", { ascending: false }),
      supabase
        .from("subscription_history")
        .select("id, from_status, to_status, created_at")
        .eq("store_id", storeId)
        .order("created_at", { ascending: false })
        .limit(15),
    ]);
    setPlans((p as unknown as Plan[]) ?? []);
    setSubs((s as Sub[]) ?? []);
    setInvoices((inv as unknown as InvoiceData[]) ?? []);
    setHistory((hist as HistoryRow[]) ?? []);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const upgrade = async (planCode: string) => {
    if (!storeId) return;
    setBusy(planCode);
    try {
      const res = await createSubscriptionCheckout({ data: { storeId, planCode } });
      await Promise.all([load(), reload()]);
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      toast.success(`Referência ${res.intent.reference} criada. ${res.message}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível iniciar o pagamento");
    } finally {
      setBusy(null);
    }
  };

  const state = status?.subscription_status ?? "inactive";
  const active = state === "active";
  const grace = state === "grace";
  const suspended = state === "suspended";
  const ui = STATE_UI[state] ?? STATE_UI.inactive;
  const StateIcon = ui.icon;
  const recommended = recommendedPlanCode(plans ?? [], status?.service_category);
  const pending = subs.find((s) => s.status === "pending");

  const cancel = async () => {
    if (!storeId) return;
    if (!window.confirm("Cancelar a subscrição? As lives ficam bloqueadas, mas todas as faturas são preservadas.")) return;
    setCancelling(true);
    try {
      const res = await cancelSubscription({ data: { storeId } });
      if (!res.ok) throw new Error(res.reason === "no_subscription" ? t("s_nao_existe_subscricao_para_cancelar") : t("s_falha_ao_cancelar"));
      toast.success(t("s_subscricao_cancelada_o_historico_de_faturacao_fo"));
      await Promise.all([load(), reload()]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao cancelar");
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Estado atual */}
      <section className={`rounded-2xl border p-4 shadow-sm ${ui.tone}`}>
        <div className="flex items-start gap-3">
          <StateIcon className={active ? "text-primary" : suspended ? "text-destructive" : "text-amber-600"} size={20} />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {active ? `Plano ${status?.plan_name} ativo` : ui.title}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {active
                ? `Válido até ${dt(status?.expires_at)} · ${status?.days_remaining ?? 0} dia(s) restantes · lives ilimitadas`
                : grace
                  ? `O plano ${status?.plan_name ?? ""} expirou em ${dt(status?.expires_at)}. Renove até ${dt(status?.grace_until)} para evitar a suspensão.`
                  : suspended
                    ? "O perfil está oculto nas pesquisas e as lives estão bloqueadas. Nenhum dado foi apagado — renove para reativar automaticamente."
                : status?.subscription_required
                  ? t("s_como_parceiro_de_servicos_precisa_de_um_plano_at") : t("s_como_parceiro_de_retalho_paga_apenas_10_de_comis")}
            </p>
            {(active || grace || suspended) && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
                <div className="rounded-lg bg-card p-2"><p className="text-muted-foreground">Plano</p><p className="font-semibold">{status?.plan_name ?? "—"}</p></div>
                <div className="rounded-lg bg-card p-2"><p className="text-muted-foreground">Valor</p><p className="font-semibold">{kz(Number(status?.price_aoa ?? 0))}</p></div>
                <div className="rounded-lg bg-card p-2"><p className="text-muted-foreground">Vencimento</p><p className="font-semibold">{dt(status?.expires_at)}</p></div>
                <div className="rounded-lg bg-card p-2"><p className="text-muted-foreground">Dias restantes</p><p className="font-semibold">{status?.days_remaining ?? 0}</p></div>
              </div>
            )}
            {(grace || suspended) && status?.plan_code && (
              <Button size="sm" className="mt-3" disabled={busy !== null} onClick={() => upgrade(status.plan_code!)}>
                {busy ? <Loader2 className="animate-spin" size={14} /> : "Renovar agora"}
              </Button>
            )}
            {pending && (
              <div className="mt-3 rounded-xl border border-border bg-card p-3">
                <p className="text-[11px] text-muted-foreground">{t("s_pagamento_pendente_referencia_multicaixa_express")}</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="truncate rounded bg-muted px-2 py-1 text-xs font-semibold">{pending.reference}</code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      navigator.clipboard.writeText(pending.reference ?? "");
                      toast.success(t("s_referencia_copiada"));
                    }}
                  >
                    <Copy size={14} />
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">Valor: {kz(pending.price_aoa)}</p>
              </div>
            )}
            {active && (
              <Button size="sm" variant="outline" className="mt-3" disabled={cancelling} onClick={cancel}>
                {cancelling ? <Loader2 className="animate-spin" size={14} /> : <><Ban size={14} className="mr-1" /> {t("s_cancelar_subscricao")}</>}
              </Button>
            )}
          </div>
        </div>
      </section>

      {/* Consumo de lives do plano */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Radio size={16} className="text-primary" />
          <h2 className="text-sm font-semibold">{t("s_lives_deste_mes")}</h2>
        </div>
        {usage ? (
          <>
            <p className="mt-2 text-2xl font-extrabold">
              {usage.used}
              <span className="text-sm font-medium text-muted-foreground"> / ilimitadas</span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              Todos os planos incluem lives ilimitadas — sem limite mensal.
            </p>
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">Ative um plano para transmitir — todos incluem lives ilimitadas.</p>
        )}
      </section>

      {/* Planos */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("s_planos_de_parceiro")}</h2>
        {plans === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {plans.map((p) => {
              const isCurrent = active && status?.plan_code === p.code;
              const isRecommended = !isCurrent && recommended === p.code;
              return (
                <div key={p.id} className={`flex flex-col rounded-2xl border p-4 ${isCurrent ? "border-primary bg-primary/5" : isRecommended ? "border-primary/50 bg-card" : "border-border bg-card"}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">{p.name}</h3>
                    {p.code === "empresarial" && <Crown size={16} className="text-amber-500" />}
                  </div>
                  {isRecommended && (
                    <span className="mt-1 w-fit rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
                      Recomendado para {serviceCategoryLabel(status?.service_category)}
                    </span>
                  )}
                  <p className="mt-2 text-xl font-extrabold">{kz(p.price_aoa)}</p>
                  <p className="text-[11px] text-muted-foreground">por {p.period_days} dias</p>
                  {p.description && <p className="mt-1 text-[11px] text-muted-foreground">{p.description}</p>}
                  <p className="mt-2 inline-flex w-fit rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Lives ilimitadas
                  </p>
                  <ul className="mt-3 flex-1 space-y-1.5">
                    {(p.features ?? []).filter((f) => !/lives? (por m[êe]s|\/m[êe]s)|at[ée] \d+ lives/i.test(f)).map((f) => (
                      <li key={f} className="flex gap-2 text-[11px] text-muted-foreground">
                        <Check size={13} className="mt-0.5 shrink-0 text-primary" /> {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4 w-full"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || busy !== null}
                    onClick={() => upgrade(p.code)}
                  >
                    {busy === p.code ? <Loader2 className="animate-spin" size={16} /> : isCurrent ? t("s_plano_atual") : t("s_fazer_upgrade")}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Histórico de subscrição */}
      {history.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Histórico da subscrição</h2>
          <ul className="space-y-2">
            {history.map((h) => (
              <li key={h.id} className="flex items-center justify-between rounded-xl border border-border bg-card p-3 text-xs">
                <span>{h.from_status ? `${h.from_status} → ${h.to_status}` : h.to_status}</span>
                <span className="text-muted-foreground">{new Date(h.created_at).toLocaleString("pt-AO")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Faturas */}
      <section>
        <h2 className="mb-3 text-sm font-semibold">{t("s_faturas")}</h2>
        {invoices.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Ainda não existem faturas. São emitidas automaticamente após a confirmação do pagamento.
          </div>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li key={inv.number} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{inv.number}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Plano {inv.plan_name} · {kz(inv.amount_aoa)} · {new Date(inv.issued_at).toLocaleDateString("pt-AO")}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0">{inv.status === "paid" ? "Paga" : inv.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => void downloadInvoice(inv)}>
                  <Download size={14} className="mr-1" /> {t("s_pdf")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ShellPage() {
  const { t } = useT();
  return (
    <LojistaShell title={t("s_subscricao_e_faturacao")}>
      <SubscriptionManager />
    </LojistaShell>
  );
}