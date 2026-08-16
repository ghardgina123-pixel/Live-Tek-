import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Share2, Heart, BadgeCheck, Radio, MessageCircle, Loader2 } from "lucide-react";
import { fetchStore, fetchStoreProducts, toCartProduct, type CatalogProduct, type CatalogStore } from "@/lib/catalog";
import { formatPrice, useCurrency } from "@/lib/currency";
import { absoluteUrl, clampDescription, loadStoreSeo, titleWithSite } from "@/lib/seo-meta";

export const Route = createFileRoute("/loja/$id")({
  loader: ({ params }) => loadStoreSeo(params.id),
  head: ({ params, loaderData }) => {
    const url = absoluteUrl(`/loja/${params.id}`);
    const s = loaderData ?? null;
    const name = s?.name ?? "Loja";
    const title = titleWithSite(name);
    const description = clampDescription(
      s?.description?.trim()
        ? `${s.name}: ${s.description}`
        : `Conheça a loja ${name} na Live Teká: produtos, lives e conversa direta com o vendedor.`,
    );
    const image = s?.cover_url ?? s?.logo_url ?? null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
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
            "@type": "Store",
            "@id": url,
            url,
            name,
            description,
            ...(image ? { image } : {}),
            ...(s?.phone ? { telephone: s.phone } : {}),
            ...(s?.category ? { additionalType: s.category } : {}),
            address: { "@type": "PostalAddress", addressCountry: "AO" },
          }),
        },
      ],
    };
  },
  component: LojaPage,
});

function LojaPage() {
  const { id } = useParams({ from: "/loja/$id" });
  const currency = useCurrency();
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<CatalogStore | null>(null);
  const [items, setItems] = useState<CatalogProduct[]>([]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    fetchStore(id).then(async (s) => {
      if (cancel) return;
      setStore(s);
      setItems(s ? await fetchStoreProducts(s.id) : []);
      if (!cancel) setLoading(false);
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
  if (!store) return <div className="p-6">Loja não encontrada</div>;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-background pb-24">
      <div className="relative">
        {store.cover_url ? (
          <img src={store.cover_url} alt={store.name} className="h-56 w-full object-cover" />
        ) : (
          <div className="h-56 w-full bg-accent" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />
        <div className="absolute top-5 flex w-full items-center justify-between px-4 text-white">
          <Link to="/lojas" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><ArrowLeft size={18} /></Link>
          <div className="flex gap-2">
            <button aria-label="Seguir loja" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><Heart size={18} /></button>
            <button aria-label="Partilhar loja" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><Share2 size={18} /></button>
          </div>
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-bold">{store.name}</h1>
              {store.status === "active" && <BadgeCheck size={18} className="text-primary" />}
            </div>
            <p className="text-xs text-muted-foreground">
              {store.partner_type === "service" ? "Prestador de serviços" : "Loja"}
              {store.category ? ` · ${store.category}` : ""}
            </p>
          </div>
        </div>
        {store.description && <p className="mt-3 text-sm text-foreground">{store.description}</p>}
        {store.status !== "active" && (
          <p className="mt-3 rounded-xl bg-muted p-3 text-xs text-muted-foreground">
            Este negócio ainda está em análise pela gestão. As compras ficam disponíveis após a aprovação.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link to="/live/$id" params={{ id: store.id }} className="flex items-center justify-center gap-1.5 rounded-xl bg-secondary py-2.5 text-xs font-semibold text-secondary-foreground">
            <Radio size={14} /> Entrar na live
          </Link>
          <Link to="/chat" className="flex items-center justify-center gap-1.5 rounded-xl bg-muted py-2.5 text-xs font-semibold text-foreground">
            <MessageCircle size={14} /> Conversar
          </Link>
        </div>
      </div>

      <div className="px-5 pt-6">
        <div className="flex border-b border-border text-sm">
          <h2 className="border-b-2 border-primary pb-2 pr-4 text-sm font-semibold text-foreground">Produtos</h2>
        </div>

        {items.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            Esta loja ainda não tem produtos aprovados.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-3">
            {items.map((p) => (
              <Link key={p.id} to="/produto/$id" params={{ id: p.id }} className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-soft)]">
                {p.image_url ? (
                  <img src={p.image_url} alt={p.name} className="h-32 w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-32 items-center justify-center bg-accent text-5xl">🛍️</div>
                )}
                <div className="p-2.5">
                  <p className="line-clamp-2 text-xs font-medium">{p.name}</p>
                  <p className="mt-1 text-sm font-bold text-primary">{formatPrice(toCartProduct(p).price, currency)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}