import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, Store as StoreIcon } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import logoAsset from "@/assets/live-teka-logo.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Teká — A Plataforma de Venda em Tempo Real" },
      { name: "description", content: "Entre na Live Teká como cliente ou lojista: compre em lives, converse com a loja e receba em casa. Comece em segundos." },
      { property: "og:title", content: "Live Teká — A Plataforma de Venda em Tempo Real" },
      { property: "og:description", content: "Entre na Live Teká como cliente ou lojista: compre em lives, converse com a loja e receba em casa. Comece em segundos." },
      { property: "og:url", content: `${SITE_URL}/` },
    ],
    links: [
      { rel: "canonical", href: `${SITE_URL}/` },
      { rel: "preload", as: "image", href: logoAsset.url, fetchPriority: "high" },
    ],
  }),
  component: Splash,
});

function Splash() {
  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-between px-6 py-10 text-foreground"
      style={{ background: "var(--gradient-brand-soft)" }}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <div className="flex w-full flex-col items-center gap-5" aria-labelledby="splash-title splash-slogan">
          <div className="aspect-[306/240] w-[min(62vw,236px)] overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-soft)]">
            <img
              src={logoAsset.url}
              alt="Live Teká"
              width={306}
              height={300}
              className="block h-auto w-full"
              loading="eager"
              decoding="async"
              fetchPriority="high"
            />
          </div>
          <h1 id="splash-title" className="sr-only">
            Live Teká — Venda em Tempo Real
          </h1>
          <p
            id="splash-slogan"
            className="flex w-full flex-nowrap items-center justify-center gap-2 whitespace-nowrap text-center text-[clamp(0.72rem,3.4vw,0.9rem)] font-extrabold text-primary"
          >
            <span>COMPRE</span>
            <span aria-hidden="true" className="text-primary-glow">•</span>
            <span>CONVERSE</span>
            <span aria-hidden="true" className="text-primary-glow">•</span>
            <span>RECEBA</span>
          </p>
        </div>
      </div>

      <div className="w-full space-y-3">
        <Link
          to="/home"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-lg transition hover:bg-primary/90 active:scale-[0.98]"
        >
          <ShoppingBag size={18} /> Cliente, registrar-me
        </Link>
        <Link
          to="/cadastro"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-card text-sm font-bold text-primary transition hover:bg-primary/10 active:scale-[0.98]"
        >
          <StoreIcon size={18} /> Lojista, registrar-me
        </Link>
        <Link to="/login" className="block pt-2 text-center text-xs font-semibold text-primary">
          Já tenho conta · Entrar
        </Link>
      </div>
    </main>
  );
}
