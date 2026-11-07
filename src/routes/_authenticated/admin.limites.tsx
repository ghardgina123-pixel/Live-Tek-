import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { History, LockKeyhole } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { ManagementHeader } from "@/components/ManagementHeader";
import { Badge } from "@/components/ui/badge";
import { brandMeta } from "@/lib/brand-meta";
import { managementOverviewOptions } from "@/lib/admin-management.queries";

export const Route = createFileRoute("/_authenticated/admin/limites")({
  head: () => ({ meta: brandMeta([{ title: "Gestão de Limites Financeiros — Live Teká" }, { name: "description", content: "Limites de levantamento e histórico administrativo da Live Teká." }]) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(managementOverviewOptions()),
  component: LimitsManagement,
  errorComponent: PanelErrorBoundary,
});

const money = (value: number | null, currency: string) => value === null ? "Não configurado" : new Intl.NumberFormat("pt-AO", { style: "currency", currency }).format(value);
function LimitsManagement() {
  const { data, refetch, isFetching } = useSuspenseQuery(managementOverviewOptions());
  return <AppShell>
    <ManagementHeader title="Gestão de Limites Financeiros" refresh={() => { void refetch(); }} refreshing={isFetching} />
    <div className="space-y-6 px-5 py-5">
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Configuração atual</h2><Badge variant="secondary">Só consulta</Badge></div>
        {data.limits.length === 0 && <p className="text-sm text-destructive">Não há limites configurados.</p>}
        {data.limits.map((limit) => <article key={limit.currency} className="space-y-3 rounded-lg border border-border bg-card p-4">
          <h3 className="font-semibold">{limit.currency === "AOA" ? "Angola" : limit.currency} · {limit.currency}</h3>
          <dl className="space-y-3 text-sm">
            <div><dt className="text-muted-foreground">Mínimo por levantamento</dt><dd className="text-xl font-semibold">{money(limit.min_amount, limit.currency)}</dd></div>
            <div><dt className="text-muted-foreground">Máximo diário configurado</dt><dd className="text-xl font-semibold">{money(limit.max_daily_amount, limit.currency)}</dd></div>
            <div><dt className="text-muted-foreground">Fuso horário</dt><dd>{limit.timezone}</dd></div>
          </dl>
        </article>)}
        <p className="flex items-start gap-2 text-sm text-muted-foreground"><LockKeyhole size={16} className="mt-1 shrink-0" /> Alterações aguardam aprovação de segurança; valores atuais preservados.</p>
      </section>
      <section className="space-y-3 border-t border-border pt-5">
        <h2 className="flex items-center gap-2 font-semibold"><History size={18} /> Histórico de limites</h2>
        <p className="text-xs text-muted-foreground">Últimos 100 registos</p>
        {data.history.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma alteração de limites registada.</p> : <div className="divide-y border-y border-border">
          {data.history.map((entry) => <article key={entry.id} className="space-y-2 py-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{entry.action}</strong><Badge variant="outline">{entry.result}</Badge></div>
            <p>{new Date(entry.created_at).toLocaleString("pt-AO", { timeZone: "Africa/Luanda" })}</p>
            <p className="break-all text-xs text-muted-foreground">Responsável: {entry.actor_id ?? "Não registado"}</p>
            <details><summary className="cursor-pointer font-medium">Antes e depois</summary><pre className="mt-2 whitespace-pre-wrap break-all text-xs">{entry.previous_state ?? "Desconhecido"}{"\n→\n"}{entry.new_state ?? "Desconhecido"}</pre></details>
          </article>)}
        </div>}
      </section>
    </div>
  </AppShell>;
}