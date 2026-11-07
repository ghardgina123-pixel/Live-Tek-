import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck, UserPlus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { ManagementHeader } from "@/components/ManagementHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brandMeta } from "@/lib/brand-meta";
import { managementOverviewOptions } from "@/lib/admin-management.queries";

export const Route = createFileRoute("/_authenticated/admin/equipa")({
  head: () => ({ meta: brandMeta([{ title: "Gestão de Equipa — Live Teká" }, { name: "description", content: "Equipa administrativa e papéis existentes da Live Teká." }]) }),
  loader: ({ context }) => context.queryClient.ensureQueryData(managementOverviewOptions()),
  component: TeamManagement,
  errorComponent: PanelErrorBoundary,
});

function TeamManagement() {
  const { data, refetch, isFetching } = useSuspenseQuery(managementOverviewOptions());
  return <AppShell>
    <ManagementHeader title="Gestão de Equipa" refresh={() => { void refetch(); }} refreshing={isFetching} />
    <div className="space-y-6 px-5 py-5">
      <section>
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-semibold">Administradores existentes</h2><Badge variant="secondary">{data.administrators.length}</Badge></div>
        <div className="divide-y border-y border-border">
          {data.administrators.map((member) => <article key={member.user_id} className="flex items-start gap-3 py-4">
            <ShieldCheck size={20} className="mt-1 shrink-0 text-primary" />
            <div className="min-w-0 flex-1"><h3 className="break-words font-medium">{member.name ?? "Administrador sem nome"}</h3>
              <p className="break-all text-xs text-muted-foreground">{member.user_id}</p>
              <p className="mt-1 text-xs text-muted-foreground">{new Date(member.created_at).toLocaleDateString("pt-AO")}</p>
            </div><Badge variant="outline">{member.user_id === data.currentUserId ? "Você" : "Admin"}</Badge>
          </article>)}
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="font-semibold">Permissões atuais</h2>
        <dl className="divide-y border-y border-border text-sm">
          <div className="flex justify-between gap-3 py-3"><dt>Gestão administrativa</dt><dd className="font-medium">Administrador</dd></div>
          <div className="flex justify-between gap-3 py-3"><dt>Loja e vendas próprias</dt><dd className="font-medium">Lojista</dd></div>
          <div className="flex justify-between gap-3 py-3"><dt>Compras próprias</dt><dd className="font-medium">Cliente</dd></div>
        </dl>
        <p className="text-sm text-muted-foreground">Permissões granulares da equipa ainda não ativadas.</p>
      </section>
      <section className="space-y-3 border-t border-border pt-5">
        <h2 className="font-semibold">Convites por token</h2>
        <Badge variant="outline">Aguarda aprovação de segurança</Badge>
        <Button disabled className="w-full"><UserPlus size={16} /> Convidar membro</Button>
      </section>
    </div>
  </AppShell>;
}