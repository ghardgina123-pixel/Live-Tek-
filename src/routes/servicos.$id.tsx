import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BadgeCheck, Clock, Loader2, MapPin, MessageCircle, Phone, Share2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { serviceCategoryEmoji, serviceCategoryLabel } from "@/lib/services";
import { toast } from "sonner";
import { absoluteUrl, clampDescription, loadStoreSeo, titleWithSite } from "@/lib/seo-meta";
import { serviceCategoryLabel as seoCategoryLabel } from "@/lib/services";

type ServiceDetail = {
  id: string;
  name: string;
  description: string | null;
  service_category: string | null;
  logo_url: string | null;
  cover_url: string | null;
  opening_hours: string | null;
  phone: string | null;
  whatsapp: string | null;
  service_tags: string[] | null;
  lat: number | null;
  lng: number | null;
};

export const Route = createFileRoute("/servicos/$id")({
  loader: ({ params }) => loadStoreSeo(params.id),
  head: ({ params, loaderData }) => {
    const url = absoluteUrl(`/servicos/${params.id}`);
    const s = loaderData ?? null;
    const category = s?.service_category ? seoCategoryLabel(s.service_category) : null;
    const name = s?.name ?? "Prestador de serviço";
    const title = titleWithSite(category ? `${name} · ${category}` : name);
    const description = clampDescription(
      s?.description?.trim()
        ? `${name}: ${s.description}`
        : `${name}${category ? ` — ${category}` : ""}. Veja horários, contactos e serviços oferecidos na Live Teká.`,
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
            "@type": "LocalBusiness",
            "@id": url,
            url,
            name,
            description,
            ...(image ? { image } : {}),
            ...(category ? { category } : {}),
            ...(s?.phone ? { telephone: s.phone } : {}),
            address: { "@type": "PostalAddress", addressCountry: "AO" },
          }),
        },
      ],
    };
  },
  component: ServiceDetailPage,
});

function ServiceDetailPage() {
  const { id } = useParams({ from: "/servicos/$id" });
  const [row, setRow] = useState<ServiceDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("stores")
        .select("id, name, description, service_category, logo_url, cover_url, opening_hours, phone, whatsapp, service_tags, lat, lng")
        .eq("id", id)
        .eq("status", "active")
        .eq("is_suspended", false)
        .maybeSingle();
      if (cancelled) return;
      setRow((data as ServiceDetail) ?? null);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="flex min-h-dvh items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>;
  }
  if (!row) {
    return (
      <div className="mx-auto w-full max-w-[480px] p-8 text-center">
        <p className="text-sm text-muted-foreground">Serviço não encontrado ou ainda em aprovação.</p>
        <Link to="/servicos" className="mt-4 inline-block text-sm font-semibold text-primary">Voltar aos serviços</Link>
      </div>
    );
  }

  const tel = row.whatsapp || row.phone;
  const share = async () => {
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) await navigator.share({ title: row.name, url });
      else { await navigator.clipboard.writeText(url); toast.success("Link copiado"); }
    } catch { /* cancelado */ }
  };

  return (
    <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-background pb-24">
      <div className="relative h-52 w-full overflow-hidden">
        {row.cover_url ? (
          <img loading="lazy" decoding="async" src={row.cover_url} alt={`Imagem de ${row.name}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-accent text-7xl">
            {serviceCategoryEmoji(row.service_category)}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/40" />
        <div className="absolute top-5 flex w-full items-center justify-between px-4 text-white">
          <Link to="/servicos" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <ArrowLeft size={18} />
          </Link>
          <button onClick={share} aria-label="Partilhar" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur">
            <Share2 size={18} />
          </button>
        </div>
      </div>

      <div className="px-5 pt-5">
        <div className="flex items-center gap-1.5">
          <h1 className="text-xl font-bold">{row.name}</h1>
          <BadgeCheck size={18} className="text-primary" />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {serviceCategoryEmoji(row.service_category)} {serviceCategoryLabel(row.service_category)}
        </p>
        {row.description && <p className="mt-3 text-sm text-foreground">{row.description}</p>}

        <div className="mt-4 space-y-2 rounded-2xl bg-card p-4 text-sm shadow-[var(--shadow-soft)]">
          {row.opening_hours && (
            <p className="flex items-center gap-2"><Clock size={15} className="text-primary" /> {row.opening_hours}</p>
          )}
          {tel && <p className="flex items-center gap-2"><Phone size={15} className="text-primary" /> {tel}</p>}
          {row.lat != null && row.lng != null && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${row.lat},${row.lng}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 font-semibold text-primary"
            >
              <MapPin size={15} /> Ver no mapa
            </a>
          )}
          {!row.opening_hours && !tel && <p className="text-xs text-muted-foreground">Sem contactos publicados.</p>}
        </div>

        {row.service_tags && row.service_tags.length > 0 && (
          <div className="mt-4">
            <h2 className="text-xs font-bold uppercase text-muted-foreground">Serviços oferecidos</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {row.service_tags.map((tag) => (
                <span key={tag} className="rounded-full bg-accent px-3 py-1 text-xs text-accent-foreground">{tag}</span>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          {tel ? (
            <a href={`tel:${tel.replace(/\s/g, "")}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-xs font-semibold text-primary-foreground">
              <Phone size={14} /> Ligar
            </a>
          ) : (
            <span className="flex items-center justify-center rounded-xl bg-muted py-3 text-xs text-muted-foreground">Sem telefone</span>
          )}
          {row.whatsapp ? (
            <a
              href={`https://wa.me/${row.whatsapp.replace(/[^0-9]/g, "")}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl bg-secondary py-3 text-xs font-semibold text-secondary-foreground"
            >
              <MessageCircle size={14} /> WhatsApp
            </a>
          ) : (
            <Link to="/chat" className="flex items-center justify-center gap-1.5 rounded-xl bg-muted py-3 text-xs font-semibold text-foreground">
              <MessageCircle size={14} /> Conversar
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
