import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Home as HomeIcon, MapPin, BedDouble, Bath, Maximize2, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/imoveis")({
  head: () => ({
    meta: [
      { title: "Imóveis — Live Teká" },
      { name: "description", content: "Casas, apartamentos e terrenos para venda e arrendamento em Angola." },
      { property: "og:title", content: "Imóveis — Live Teká" },
      { property: "og:description", content: "Encontre casas, apartamentos e terrenos para venda ou arrendamento." },
      { property: "og:url", content: "https://www.livemarketplece.live/imoveis" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/imoveis" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Imóveis — Live Teká",
        url: "https://www.livemarketplece.live/imoveis",
      }),
    }],
  }),
  component: ImoveisListPage,
});

type Property = {
  id: string; title: string; description: string | null;
  property_type: string; listing_type: "venda" | "arrendamento";
  price_aoa: number; rent_period: string | null;
  bedrooms: number | null; bathrooms: number | null; area_m2: number | null;
  district: string | null; cover_url: string | null; status: string;
  agency_id: string;
  real_estate_agencies: { name: string } | null;
};

const TIPOS = ["todos", "venda", "arrendamento"] as const;

function ImoveisListPage() {
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>("todos");

  useEffect(() => {
    (async () => {
      setLoading(true);
      let q = (supabase as any)
        .from("properties")
        .select("id,title,description,property_type,listing_type,price_aoa,rent_period,bedrooms,bathrooms,area_m2,district,cover_url,status,agency_id,real_estate_agencies(name)")
        .in("status", ["approved", "sold", "rented"])
        .order("created_at", { ascending: false });
      if (tipo !== "todos") q = q.eq("listing_type", tipo);
      const { data } = await q;
      setItems((data as Property[]) ?? []);
      setLoading(false);
    })();
  }, [tipo]);

  return (
    <AppShell>
      <header className="px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <div className="flex items-center gap-3">
          <Link to="/home" aria-label="Voltar" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
          <div className="flex-1">
            <h1 className="text-lg font-semibold">Imóveis</h1>
            <p className="text-xs text-white/80">Casas, apartamentos, terrenos e mais</p>
          </div>
          <HomeIcon size={20} />
        </div>
        <div className="mt-4 flex gap-2">
          {TIPOS.map((t) => (
            <button key={t} onClick={() => setTipo(t)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ${tipo === t ? "bg-white text-foreground" : "bg-white/15 text-white"}`}>{t}</button>
          ))}
        </div>
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <div className="px-5 py-16 text-center text-sm text-muted-foreground">
          Nenhum imóvel disponível {tipo !== "todos" ? `para ${tipo}` : ""} no momento.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 px-5 py-5">
          {items.map((p) => (
            <Link key={p.id} to="/imoveis/$id" params={{ id: p.id }}
              className="overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-soft)]">
              <div className="relative h-44 w-full bg-accent">
                {p.cover_url ? (
                  <img src={p.cover_url} alt={p.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-5xl">🏠</div>
                )}
                <span className="absolute left-2 top-2 rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
                  {p.listing_type === "venda" ? "Venda" : "Arrendamento"}
                </span>
                {(p.status === "sold" || p.status === "rented") && (
                  <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-0.5 text-[10px] font-bold uppercase text-white">
                    {p.status === "sold" ? "Vendido" : "Arrendado"}
                  </span>
                )}
              </div>
              <div className="p-3">
                <p className="text-xs text-muted-foreground capitalize">{p.property_type}</p>
                <h2 className="line-clamp-1 text-sm font-bold">{p.title}</h2>
                {p.district && (
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <MapPin size={11} /> {p.district}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                  {p.bedrooms != null && <span className="flex items-center gap-1"><BedDouble size={12} /> {p.bedrooms}</span>}
                  {p.bathrooms != null && <span className="flex items-center gap-1"><Bath size={12} /> {p.bathrooms}</span>}
                  {p.area_m2 != null && <span className="flex items-center gap-1"><Maximize2 size={12} /> {p.area_m2}m²</span>}
                </div>
                <p className="mt-2 text-base font-bold text-primary">
                  {Number(p.price_aoa).toLocaleString("pt-AO")} Kz
                  {p.listing_type === "arrendamento" && <span className="text-xs font-normal text-muted-foreground"> /{p.rent_period ?? "mês"}</span>}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}