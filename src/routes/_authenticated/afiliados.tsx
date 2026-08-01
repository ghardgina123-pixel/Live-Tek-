import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Users, Share2, Gift } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/afiliados")({
  head: () => ({ meta: [{ title: "Afiliados — Live Teká" }] }),
  component: Afiliados,
});

function Afiliados() {
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
        <div className="mt-6 space-y-3">
          <Item icon={<Share2 size={18} />} title="Seu link único" desc="Compartilhe nas redes e em grupos." />
          <Item icon={<Gift size={18} />} title="Comissão recorrente" desc="Ganhe a cada compra dos indicados." />
        </div>
        <div className="mt-6 rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="text-sm font-semibold">Programa em breve</p>
          <p className="mt-1 text-xs text-muted-foreground">Estamos preparando os detalhes do programa. Em breve você poderá gerar o seu link.</p>
        </div>
      </div>
    </AppShell>
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