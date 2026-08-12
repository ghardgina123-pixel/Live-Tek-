import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Heart, Share2, Star, ShieldCheck, Truck, RotateCcw, MessageCircle, ShoppingCart } from "lucide-react";
import { findProduct, findStore } from "@/lib/data";
import { cartStore } from "@/lib/cart-store";
import { formatPrice, useCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { absoluteUrl, clampDescription, loadProductSeo, titleWithSite } from "@/lib/seo-meta";

export const Route = createFileRoute("/produto/$id")({
  loader: ({ params }) => loadProductSeo(params.id),
  head: ({ params, loaderData }) => {
    const url = absoluteUrl(`/produto/${params.id}`);
    const p = loaderData ?? null;
    const name = p?.name ?? "Detalhes do produto";
    const title = titleWithSite(name);
    const description = clampDescription(
      p
        ? `${p.name}${p.store ? ` na loja ${p.store.name}` : ""} por ${p.price_aoa.toLocaleString("pt-AO")} Kz. ${p.description ?? "Compre direto da live e receba em casa com a Live Teká."}`
        : "Veja detalhes, preço e disponibilidade deste produto e compre direto da live na Live Teká.",
    );
    const image = p?.image_url ?? null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "product" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
        ...(image
          ? [
              { property: "og:image", content: image },
              { name: "twitter:image", content: image },
            ]
          : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            "@id": url,
            url,
            name,
            ...(p?.description ? { description: p.description } : { description }),
            ...(image ? { image } : {}),
            ...(p?.store ? { brand: { "@type": "Organization", name: p.store.name } } : {}),
            ...(p
              ? {
                  offers: {
                    "@type": "Offer",
                    url,
                    price: p.price_aoa,
                    priceCurrency: "AOA",
                    availability: "https://schema.org/InStock",
                  },
                }
              : {}),
          }),
        },
      ],
    };
  },
  component: ProdutoPage,
});

function ProdutoPage() {
  const { id } = useParams({ from: "/produto/$id" });
  const p = findProduct(id);
  const nav = useNavigate();
  const currency = useCurrency();
  if (!p) return <div className="p-6">Produto não encontrado</div>;
  const store = findStore(p.storeId);

  if (typeof document !== "undefined") {
    document.title = `${p.name} — Live Teká`;
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-background pb-28">
      <div className="relative">
        <div className="flex h-80 items-center justify-center bg-accent text-9xl">{p.emoji}</div>
        <div className="absolute top-5 flex w-full items-center justify-between px-4">
          <button aria-label="Voltar" onClick={() => history.back()} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow"><ArrowLeft size={18} /></button>
          <div className="flex gap-2">
            <button aria-label="Favoritar produto" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow"><Heart size={18} /></button>
            <button aria-label="Partilhar produto" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 shadow"><Share2 size={18} /></button>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold text-primary">{formatPrice(p.price, currency)}</span>
          {p.oldPrice && <span className="text-sm text-muted-foreground line-through">{formatPrice(p.oldPrice, currency)}</span>}
          {p.oldPrice && (
            <span className="rounded-md bg-[var(--live)]/10 px-1.5 py-0.5 text-[10px] font-bold text-[var(--live)]">
              -{Math.round((1 - p.price / p.oldPrice) * 100)}%
            </span>
          )}
        </div>
        <h1 className="mt-2 text-lg font-semibold leading-snug">{p.name}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Star size={12} className="fill-yellow-400 text-yellow-400" /><b className="text-foreground">{p.rating}</b></span>
          <span>{p.sold} vendidos</span>
          <span>Frete grátis</span>
        </div>

        {store && (
          <Link to="/loja/$id" params={{ id: store.id }} className="mt-4 flex items-center gap-3 rounded-2xl border border-border p-3">
            <div className={`flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br ${store.cover} text-xl`}>{store.emoji}</div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{store.name}</p>
              <p className="text-[11px] text-muted-foreground">{store.followers} seguidores · ⭐ {store.rating}</p>
            </div>
            <span className="rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground">Visitar</span>
          </Link>
        )}

        <div className="mt-5 grid grid-cols-3 gap-2 text-[11px]">
          <div className="flex flex-col items-center gap-1 rounded-xl bg-muted p-3 text-center">
            <ShieldCheck size={18} className="text-primary" />
            Compra<br />protegida
          </div>
          <div className="flex flex-col items-center gap-1 rounded-xl bg-muted p-3 text-center">
            <Truck size={18} className="text-primary" />
            Entrega<br />em 3 dias
          </div>
          <div className="flex flex-col items-center gap-1 rounded-xl bg-muted p-3 text-center">
            <RotateCcw size={18} className="text-primary" />
            Troca<br />em 7 dias
          </div>
        </div>

        <h3 className="mt-6 text-sm font-bold">Descrição</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.description}</p>
      </div>

      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-background/95 p-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Link to="/chat" className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-foreground"><MessageCircle size={20} /></Link>
          <button
            onClick={() => { cartStore.add(p); toast.success("Adicionado ao carrinho"); }}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground">
            <ShoppingCart size={18} /> Adicionar
          </button>
          <button
            onClick={() => { cartStore.add(p); nav({ to: "/checkout" }); }}
            className="h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">
            Comprar agora
          </button>
        </div>
      </div>
    </div>
  );
}