import { createFileRoute, Link } from "@tanstack/react-router";
import { ShoppingBag, Store as StoreIcon } from "lucide-react";
import { SITE_URL } from "@/lib/site";
import logoAsset from "@/assets/live-market-logo.png.asset.json";

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
      { rel: "preload", as: "image", href: logoAsset.url, fetchPriority: "high" },
    ],
  }),
  component: Splash,
});

function Splash() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-between bg-white px-6 py-12 text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <img
          src={logoAsset.url}
          alt="Live Teká — Compre, Converse e Receba"
          width={512}
          height={512}
          className="mx-auto block h-auto max-h-[40vh] w-auto max-w-[80%] object-contain"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />
        <h1 className="sr-only">Live Teká — Compre · Converse · Receba.</h1>
        <p className="text-center text-sm font-bold tracking-[0.18em] text-foreground/95">
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
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-primary bg-primary/5 text-sm font-bold text-primary transition hover:bg-primary/10 active:scale-[0.98]"
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
