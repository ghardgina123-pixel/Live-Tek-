import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Mail, MessageCircle, Phone } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/ajuda")({
  head: () => ({
    meta: [
      { title: "Ajuda e suporte — Live Teká" },
      { name: "description", content: "Fale com a equipa da Live Teká por email, WhatsApp ou telefone e veja respostas para as perguntas mais frequentes." },
      { property: "og:title", content: "Ajuda e suporte — Live Teká" },
      { property: "og:description", content: "Fale com a equipa da Live Teká por email, WhatsApp ou telefone." },
      { property: "og:url", content: "https://www.livemarketplece.live/ajuda" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/ajuda" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: [
          { "@type": "Question", name: "Como faço para vender?", acceptedAnswer: { "@type": "Answer", text: "Acesse Configurações → Quero vender / Registrar loja para abrir a sua loja na Live Teká." } },
          { "@type": "Question", name: "Como pago?", acceptedAnswer: { "@type": "Answer", text: "No checkout pode escolher Express, e-Kwanza, Unitel Money, Afrimoney, Kwik ou Multicaixa Referência." } },
          { "@type": "Question", name: "Como acompanho o meu pedido?", acceptedAnswer: { "@type": "Answer", text: "Acompanhe o estado das suas compras em Perfil → Minhas compras." } },
        ],
      }),
    }],
  }),
  component: Ajuda,
});

function Ajuda() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" aria-label="Voltar" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Ajuda e suporte</h1>
      </header>
      <div className="space-y-3 px-5 py-5">
        <a href="mailto:livemarketcomercioaovivo@gmail.com" className="flex items-center gap-3 rounded-xl border border-border p-3">
          <Mail size={18} className="text-primary" />
          <div><p className="text-sm font-semibold">Email</p><p className="text-xs text-muted-foreground">livemarketcomercioaovivo@gmail.com</p></div>
        </a>
        <a href="https://wa.me/244927046161" className="flex items-center gap-3 rounded-xl border border-border p-3">
          <MessageCircle size={18} className="text-primary" />
          <div><p className="text-sm font-semibold">WhatsApp</p><p className="text-xs text-muted-foreground">+244 927 046 161</p></div>
        </a>
        <a href="tel:+244927046161" className="flex items-center gap-3 rounded-xl border border-border p-3">
          <Phone size={18} className="text-primary" />
          <div><p className="text-sm font-semibold">Telefone</p><p className="text-xs text-muted-foreground">+244 927 046 161</p></div>
        </a>
        <Link to="/como-vender" className="flex items-center gap-3 rounded-xl border border-border p-3">
          <MessageCircle size={18} className="text-primary" />
          <div><p className="text-sm font-semibold">Como vender no Live Teká</p><p className="text-xs text-muted-foreground">Lojas, serviços, comissões, pagamentos e afiliados</p></div>
        </Link>
        <section className="rounded-2xl border border-border p-4">
          <h2 className="mb-2 text-sm font-bold">Perguntas frequentes</h2>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li>• Como faço para vender? Acesse Configurações → Quero vender.</li>
            <li>• Como pago? No checkout, escolha entre Express, e-Kwanza, Unitel Money, Afrimoney, Kwik ou Multicaixa Ref.</li>
            <li>• Como acompanho meu pedido? Em Minhas compras.</li>
          </ul>
        </section>
      </div>
    </AppShell>
  );
}