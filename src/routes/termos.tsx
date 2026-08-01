import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/termos")({
  head: () => ({ meta: [{ title: "Termos e privacidade — Live Teká" }] }),
  component: Termos,
});

function Termos() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Termos e privacidade</h1>
      </header>
      <article className="prose prose-sm max-w-none px-5 py-5 text-sm leading-relaxed text-foreground">
        <h2 className="text-base font-bold">Termos de uso</h2>
        <p>Ao usar a Live Teká, você concorda em respeitar as regras de convivência, não publicar conteúdo ilegal e cumprir as obrigações fiscais aplicáveis.</p>
        <h2 className="mt-4 text-base font-bold">Privacidade</h2>
        <p>Coletamos apenas os dados necessários para operar a plataforma: nome, contato, endereço e histórico de compras. Não vendemos dados a terceiros.</p>
        <h2 className="mt-4 text-base font-bold">Lojistas</h2>
        <p>O lojista é responsável pela veracidade das informações da loja, pelos produtos anunciados e pela entrega ao cliente.</p>
        <h2 className="mt-4 text-base font-bold">Pagamentos</h2>
        <p>Pagamentos manuais (Express, e-Kwanza, Unitel Money, Afrimoney, Kwik, Multicaixa Ref) exigem o envio de comprovativo. A confirmação ocorre após validação pelo lojista ou pela administração.</p>
      </article>
    </AppShell>
  );
}