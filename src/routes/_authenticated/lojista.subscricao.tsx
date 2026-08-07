import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Crown, Download, ShieldCheck, AlertTriangle, Copy, Radio, Ban } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionStatus } from "@/hooks/use-subscription";
import { createSubscriptionCheckout, cancelSubscription } from "@/lib/subscriptions.functions";
import { generateInvoicePdf, type InvoiceData } from "@/lib/invoice-pdf";
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

function SubscriptionManager() {
  const { t } = useT();
  const { store } = useLojistaStore();
  const storeId = store?.id;
  const { status, usage, reload } = useSubscriptionStatus(storeId);
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [subs, setSubs] = useState<Sub[]>([]);
  const [invoices, setInvoices] = useState<InvoiceData[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!storeId) return;
    const [{ data: p }, { data: s }, { data: inv }] = await Promise.all([
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
    ]);
    setPlans((p as unknown as Plan[]) ?? []);
    setSubs((s as Sub[]) ?? []);
    setInvoices((inv as unknown as InvoiceData[]) ?? []);
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

  const active = status?.subscription_status === "active";
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
      <section className={`rounded-2xl border p-4 shadow-sm ${active ? "border-primary/40 bg-primary/5" : "border-amber-500/40 bg-amber-500/5"}`}>
        <div className="flex items-start gap-3">
          {active ? <ShieldCheck className="text-primary" size={20} /> : <AlertTriangle className="text-amber-600" size={20} />}
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {active ? `Plano ${status?.plan_name} ativo` : "Sem subscrição ativa"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {active
                ? `Válido até ${status?.expires_at ? new Date(status.expires_at).toLocaleDateString("pt-AO") : "—"} · ${
                    status?.max_lives_per_month ? `${status.max_lives_per_month} lives/mês` : "lives ilimitadas"
                  }`
                : status?.subscription_required
                  ? t("s_como_parceiro_de_servicos_precisa_de_um_plano_at") : t("s_como_parceiro_de_retalho_paga_apenas_10_de_comis")}
            </p>
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
              <span className="text-sm font-medium text-muted-foreground">
                {usage.unlimited ? " / ilimitadas" : ` / ${usage.limit ?? 0}`}
              </span>
            </p>
            <p className="text-[11px] text-muted-foreground">
              {usage.unlimited
                ? "O seu plano não tem limite mensal de lives."
                : `${usage.remaining ?? 0} live(s) disponível(is) até ao fim do mês.`}
            </p>
            {!usage.unlimited && usage.limit ? (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, Math.round((usage.used / usage.limit) * 100))}%` }}
                />
              </div>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">{t("s_sem_plano_ativo_nenhuma_live_disponivel")}</p>
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
              return (
                <div key={p.id} className={`flex flex-col rounded-2xl border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold">{p.name}</h3>
                    {p.code === "elite" && <Crown size={16} className="text-amber-500" />}
                  </div>
                  <p className="mt-2 text-xl font-extrabold">{kz(p.price_aoa)}</p>
                  <p className="text-[11px] text-muted-foreground">por {p.period_days} dias</p>
                  <ul className="mt-3 flex-1 space-y-1.5">
                    {(p.features ?? []).map((f) => (
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
                <Button size="sm" variant="outline" onClick={() => generateInvoicePdf(inv)}>
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