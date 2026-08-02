import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, Store as StoreIcon } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import bannerAsset from "@/assets/live-teka-banner.png.asset.json";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Live Teká — Bem-vindo · Compre, Converse, Receba" },
      { name: "description", content: "Bem-vindo à Live Teká: o marketplace ao vivo de Angola. Entre como cliente ou lojista e comece em segundos." },
      { property: "og:title", content: "Live Teká — Bem-vindo · Compre, Converse, Receba" },
      { property: "og:description", content: "Bem-vindo à Live Teká: o marketplace ao vivo de Angola. Entre como cliente ou lojista e comece em segundos." },
      { property: "og:url", content: `${SITE_URL}/` },
    ],
    links: [
      { rel: "canonical", href: `${SITE_URL}/` },
      { rel: "preload", as: "image", href: bannerAsset.url, fetchPriority: "high" },
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
      <div className="flex flex-1 flex-col items-center justify-center gap-5">
        <img
          src={bannerAsset.url}
          alt="Live Teká — A plataforma de vendas em tempo real"
          width={1329}
          height={784}
          className="mx-auto block h-auto w-full rounded-2xl object-contain shadow-[var(--shadow-soft)]"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <h1 className="sr-only">Live Teká — Compre · Converse · Receba.</h1>
        <p className="text-center text-sm font-bold tracking-[0.18em] text-primary">
          COMPRE <span className="text-primary-glow">•</span> CONVERSE{" "}
          <span className="text-primary-glow">•</span> RECEBA
        </p>
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
