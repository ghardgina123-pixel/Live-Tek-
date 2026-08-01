import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Heart } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated/favoritos")({
  head: () => ({ meta: [{ title: "Favoritos — Live Teká" }] }),
  component: Favoritos,
});

function Favoritos() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Favoritos</h1>
      </header>
      <div className="px-5 py-10 text-center">
        <Heart className="mx-auto text-muted-foreground" size={32} />
        <p className="mt-3 text-sm text-muted-foreground">Você ainda não favoritou nenhum produto.</p>
        <Link to="/home" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Explorar produtos</Link>
      </div>
    </AppShell>
  );
}