import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CurrencySelector } from "@/components/CurrencySelector";

export const Route = createFileRoute("/_authenticated/idioma")({
  head: () => ({ meta: [{ title: "Idioma e moeda — Live Teká" }] }),
  component: Idioma,
});

function Idioma() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Idioma, região e moeda</h1>
      </header>
      <div className="space-y-5 px-5 py-5">
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Moeda</h2>
          <CurrencySelector variant="row" />
        </section>
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">Idioma</h2>
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="font-medium">Português (Angola)</p>
            <p className="text-xs text-muted-foreground">Mais idiomas em breve.</p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}