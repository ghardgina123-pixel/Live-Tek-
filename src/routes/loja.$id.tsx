import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft, Share2, Heart, BadgeCheck, Star, Radio, MessageCircle } from "lucide-react";
import { StoreCover } from "@/components/AppShell";
import { findStore, productsByStore } from "@/lib/data";
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
  const store = findStore(id);
  const items = productsByStore(id);
  const currency = useCurrency();
  if (!store) return <div className="p-6">Loja não encontrada</div>;

  if (typeof document !== "undefined") {
    document.title = `${store.name} — Live Teká`;
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-background pb-24">
      <div className="relative">
        <StoreCover gradient={store.cover} emoji={store.emoji} className="h-56 w-full" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/40" />
        <div className="absolute top-5 flex w-full items-center justify-between px-4 text-white">
          <Link to="/lojas" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><ArrowLeft size={18} /></Link>
          <div className="flex gap-2">
            <button aria-label="Seguir loja" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><Heart size={18} /></button>
            <button aria-label="Partilhar loja" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/30 backdrop-blur"><Share2 size={18} /></button>
          </div>
        </div>
        {store.live && (
          <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full bg-[var(--live)] px-3 py-1.5 text-[11px] font-bold uppercase text-white shadow-lg">
            <Radio size={12} /> ao vivo · {store.viewers?.toLocaleString("pt-BR")} assistindo
          </div>
        )}
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl font-bold">{store.name}</h1>
              <BadgeCheck size={18} className="text-primary" />
            </div>
            <p className="text-xs text-muted-foreground">{store.handle} · {store.category}</p>
          </div>
          <button className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">Seguir</button>
        </div>
        <div className="mt-3 flex gap-4 text-xs">
          <div><span className="font-bold text-foreground">{store.followers}</span> <span className="text-muted-foreground">seguidores</span></div>
          <div className="flex items-center gap-1"><Star size={12} className="fill-yellow-400 text-yellow-400" /><span className="font-bold">{store.rating}</span><span className="text-muted-foreground">(2.3k avaliações)</span></div>
        </div>
        <p className="mt-3 text-sm text-foreground">{store.tagline}. Qualidade garantida, entrega rápida e atendimento ao vivo todos os dias.</p>

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
          <div className="border-b-2 border-primary pb-2 pr-4 font-semibold text-foreground">Produtos</div>
          <div className="pb-2 pr-4 text-muted-foreground">Sobre</div>
          <div className="pb-2 text-muted-foreground">Avaliações</div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          {items.map((p) => (
            <Link key={p.id} to="/produto/$id" params={{ id: p.id }} className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-soft)]">
              <div className="flex h-32 items-center justify-center bg-accent text-5xl">{p.emoji}</div>
              <div className="p-2.5">
                <p className="line-clamp-2 text-xs font-medium">{p.name}</p>
                <p className="mt-1 text-sm font-bold text-primary">{formatPrice(p.price, currency)}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}