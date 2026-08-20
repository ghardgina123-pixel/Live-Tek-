import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Heart, Share2, ShieldCheck, Truck, RotateCcw, MessageCircle, ShoppingCart, Loader2 } from "lucide-react";
import { cartStore } from "@/lib/cart-store";
import { formatPrice, useCurrency } from "@/lib/currency";
import { toast } from "sonner";
import {
  fetchProduct,
  fetchStore,
  isPurchasable,
  toCartProduct,
  type CatalogProduct,
  type CatalogStore,
} from "@/lib/catalog";
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
  const nav = useNavigate();
  const currency = useCurrency();
  const [loading, setLoading] = useState(true);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [store, setStore] = useState<CatalogStore | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchProduct(id).then(async (p) => {
      if (cancel) return;
      setProduct(p);
      const s = p ? await fetchStore(p.store_id) : null;
      if (cancel) return;
      setStore(s);
      setLoading(false);
    });
    return () => { cancel = true; };
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }
  if (!product) return <div className="p-6">Produto não encontrado</div>;

  const p = product;
  const canBuy = isPurchasable(p, store);
  const cartItem = toCartProduct(p);
  const buy = (checkout: boolean) => {
    if (!canBuy) {
      toast.error(
        store?.status !== "active"
          ? "Esta loja ainda não está aprovada para vender."
          : Number(p.stock) <= 0
            ? "Produto sem stock disponível."
            : "Produto ainda não aprovado para venda.",
      );
      return;
    }
    cartStore.add(cartItem);
    if (checkout) nav({ to: "/checkout" });
    else toast.success("Adicionado ao carrinho");
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-background pb-28">
      <div className="relative">
        {p.image_url ? (
          <StorageImage bucket="product-images" path={p.image_url} alt={p.name} className="h-80 w-full object-cover" />
        ) : (
          <div className="flex h-80 items-center justify-center bg-accent text-9xl">🛍️</div>
        )}
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
          <span className="text-3xl font-bold text-primary">{formatPrice(cartItem.price, currency)}</span>
        </div>
        <h1 className="mt-2 text-lg font-semibold leading-snug">{p.name}</h1>
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          <span>{Number(p.stock) > 0 ? `${p.stock} em stock` : "Sem stock"}</span>
          {!canBuy && <span className="font-semibold text-destructive">Indisponível para compra</span>}
        </div>

        {store && (
          <Link to="/loja/$id" params={{ id: store.id }} className="mt-4 flex items-center gap-3 rounded-2xl border border-border p-3">
            <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl bg-accent text-xl">
              {store.logo_url ? <StorageImage bucket="store-assets" path={store.logo_url} alt={store.name} className="h-full w-full object-cover" /> : "🏬"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{store.name}</p>
              <p className="text-[11px] text-muted-foreground">{store.category ?? "Loja"}</p>
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

        <h2 className="mt-6 text-sm font-bold">Descrição</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{p.description ?? "Sem descrição."}</p>
      </div>

      <div className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-background/95 p-3 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Link to="/chat" className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-foreground"><MessageCircle size={20} /></Link>
          <button
            onClick={() => buy(false)}
            disabled={!canBuy}
            className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold text-secondary-foreground disabled:opacity-50">
            <ShoppingCart size={18} /> Adicionar
          </button>
          <button
            onClick={() => buy(true)}
            disabled={!canBuy}
            className="h-12 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50">
            Comprar
          </button>
        </div>
      </div>
    </div>
  );
}