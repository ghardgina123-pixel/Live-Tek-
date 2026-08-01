import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { ArrowLeft } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import livesAtraem from "@/assets/marketing/lives-atraem.png.asset.json";
import oneTapPay from "@/assets/marketing/one-tap-pay.png.asset.json";
import pulso from "@/assets/marketing/pulso.png.asset.json";
import nexusFlash from "@/assets/marketing/nexus-flash.png.asset.json";
import confianca from "@/assets/marketing/confianca.png.asset.json";
import escalaLocal from "@/assets/marketing/escala-local.png.asset.json";

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: "Sobre o Live Teká — Compre, Converse e Receba em Angola" },
      { name: "description", content: "Conheça o Live Teká: o marketplace angolano onde lives atraem, o pagamento é num toque e a entrega é em tempo real." },
      { property: "og:title", content: "Sobre o Live Teká" },
      { property: "og:description", content: "O marketplace angolano em tempo real." },
      { property: "og:image", content: livesAtraem.url },
      { property: "og:url", content: `${SITE_URL}/sobre` },
    ],
    links: [{ rel: "canonical", href: `${SITE_URL}/sobre` }],
  }),
  component: Sobre,
});

const SECTIONS = [
  { img: livesAtraem,  title: "Lives que atraem",            desc: "Transmissões ao vivo conectam vendedores e compradores em tempo real, com o calor do mercado angolano." },
  { img: oneTapPay,    title: "Pagamento num toque",         desc: "Pague em Kwanza (AOA) com Multicaixa Express, Unitel Money, AfriMoney, eKwanza, Kwik ou cartão — tudo num clique." },
  { img: pulso,        title: "Pulso em tempo real",         desc: "Acompanhe estoque, pedidos e mensagens dos clientes ao vivo, sem atrasos." },
  { img: nexusFlash,   title: "Nexus Flash",                 desc: "Entregas rápidas com a nossa rede de transportadores parceiros em Luanda e arredores." },
  { img: confianca,    title: "Confiança inabalável",        desc: "Lojas verificadas, pagamentos retidos até a entrega e suporte humano sempre disponível." },
  { img: escalaLocal,  title: "Escala adaptada localmente",  desc: "Plataforma feita para Angola: idioma, moeda, províncias e formas de pagamento que você já usa." },
];

function Sobre() {
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/home" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15" aria-label="Voltar"><ArrowLeft size={18} /></Link>
        <div>
          <h1 className="text-lg font-semibold">Sobre o Live Teká</h1>
          <p className="text-xs text-white/80">Compre · Converse · Receba — em Angola</p>
        </div>
      </header>
      <main className="space-y-6 px-5 py-6">
        {SECTIONS.map((s) => (
          <section key={s.title} className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <img src={s.img.url} alt={s.title} className="aspect-[4/3] w-full object-cover" loading="lazy" />
            <div className="p-4">
              <h2 className="text-base font-bold text-foreground">{s.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{s.desc}</p>
            </div>
          </section>
        ))}
        <footer className="rounded-2xl bg-muted/40 p-4 text-center text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">www.livemarketplece.live</p>
          <p className="mt-1">Apoio ao cliente: +244 927 046 161</p>
        </footer>
      </main>
    </AppShell>
  );
}