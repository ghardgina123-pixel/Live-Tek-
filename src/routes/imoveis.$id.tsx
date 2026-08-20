import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MapPin, BedDouble, Bath, Maximize2, Car, Phone, MessageCircle, Calendar, Loader2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { StorageImage } from "@/lib/storage";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { z } from "zod";
import { absoluteUrl, clampDescription, loadPropertySeo, titleWithSite } from "@/lib/seo-meta";

export const Route = createFileRoute("/imoveis/$id")({
  loader: ({ params }) => loadPropertySeo(params.id),
  head: ({ params, loaderData }) => {
    const url = absoluteUrl(`/imoveis/${params.id}`);
    const p = loaderData ?? null;
    const name = p?.title ?? "Detalhes do imóvel";
    const title = titleWithSite(name);
    const description = clampDescription(
      p
        ? `${p.property_type} para ${p.listing_type}${p.district ? ` em ${p.district}` : ""} por ${p.price_aoa.toLocaleString("pt-AO")} Kz. ${p.description ?? "Veja fotos, localização e marque visita na Live Teká."}`
        : "Veja fotos, preço, localização e marque visita a este imóvel na Live Teká.",
    );
    const image = p?.cover_url ?? null;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "article" },
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
            "@type": "RealEstateListing",
            "@id": url,
            url,
            name,
            description,
            ...(image ? { image } : {}),
            ...(p
              ? {
                  offers: { "@type": "Offer", url, price: p.price_aoa, priceCurrency: "AOA" },
                  ...(p.district
                    ? { address: { "@type": "PostalAddress", addressLocality: p.district, addressCountry: "AO" } }
                    : { address: { "@type": "PostalAddress", addressCountry: "AO" } }),
                  ...(p.bedrooms ? { numberOfRooms: p.bedrooms } : {}),
                  ...(p.area_m2
                    ? { floorSize: { "@type": "QuantitativeValue", value: p.area_m2, unitCode: "MTK" } }
                    : {}),
                }
              : {}),
          }),
        },
      ],
    };
  },
  component: ImovelDetailPage,
});

type Property = {
  id: string; title: string; description: string | null;
  property_type: string; listing_type: "venda" | "arrendamento";
  price_aoa: number; rent_period: string | null;
  bedrooms: number | null; bathrooms: number | null; area_m2: number | null;
  parking_spots: number | null; furnished: boolean;
  district: string | null; street: string | null;
  lat: number | null; lng: number | null;
  cover_url: string | null; status: string; agency_id: string;
  real_estate_agencies: { name: string; phone: string; email: string | null } | null;
};
type Image = { id: string; image_url: string };

const visitSchema = z.object({
  contact_phone: z.string().trim().min(7).max(20),
  preferred_date: z.string().min(1, "Data obrigatória"),
  preferred_time: z.string().max(20).optional().or(z.literal("")),
  message: z.string().max(500).optional().or(z.literal("")),
});

function ImovelDetailPage() {
  const { id } = Route.useParams();
  const { user } = useAuth();
  const [p, setP] = useState<Property | null>(null);
  const [images, setImages] = useState<Image[]>([]);
  const [loading, setLoading] = useState(true);
  const [openVisit, setOpenVisit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ contact_phone: "", preferred_date: "", preferred_time: "", message: "" });

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await (supabase as any)
        .from("properties")
        .select("*, real_estate_agencies(name, phone, email)")
        .eq("id", id)
        .maybeSingle();
      setP(data as Property);
      const { data: imgs } = await (supabase as any).from("property_images").select("*").eq("property_id", id).order("sort_order");
      setImages((imgs as Image[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  const submitVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error("Faça login para marcar visita");
    const parsed = visitSchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    setBusy(true);
    const { error } = await (supabase as any).from("property_visit_requests").insert({
      property_id: id, customer_id: user.id,
      contact_phone: form.contact_phone, preferred_date: form.preferred_date,
      preferred_time: form.preferred_time || null, message: form.message || null,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Pedido de visita enviado!");
    setOpenVisit(false);
    setForm({ contact_phone: "", preferred_date: "", preferred_time: "", message: "" });
  };

  if (loading) {
    return <AppShell><div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div></AppShell>;
  }
  if (!p) {
    return <AppShell><div className="px-5 py-16 text-center text-sm text-muted-foreground">Imóvel não encontrado.</div></AppShell>;
  }

  if (typeof document !== "undefined") {
    document.title = `${p.title} — Live Teká`;
  }

  const whatsapp = p.real_estate_agencies?.phone
    ? `https://wa.me/${p.real_estate_agencies.phone.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá, tenho interesse no imóvel: ${p.title}`)}`
    : null;

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/imoveis" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="flex-1 truncate text-lg font-semibold">{p.title}</h1>
      </header>

      <div className="relative h-64 w-full bg-accent">
        {p.cover_url ? (
          <StorageImage bucket="property-images" path={p.cover_url} alt={p.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-7xl">🏠</div>
        )}
      </div>
      {images.length > 0 && (
        <div className="flex gap-2 overflow-x-auto px-5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {images.map((i) => (
            <StorageImage key={i.id} bucket="property-images" path={i.image_url} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}

      <div className="px-5 py-4 space-y-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-bold uppercase text-primary-foreground">
              {p.listing_type === "venda" ? "Venda" : "Arrendamento"}
            </span>
            <span className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-bold uppercase capitalize text-accent-foreground">{p.property_type}</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-primary">
            {Number(p.price_aoa).toLocaleString("pt-AO")} Kz
            {p.listing_type === "arrendamento" && <span className="text-sm font-normal text-muted-foreground"> /{p.rent_period ?? "mês"}</span>}
          </p>
          {(p.district || p.street) && (
            <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
              <MapPin size={14} /> {[p.street, p.district].filter(Boolean).join(", ")}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-4 rounded-xl border border-border p-3 text-xs">
          {p.bedrooms != null && <span className="flex items-center gap-1"><BedDouble size={14} /> {p.bedrooms} quartos</span>}
          {p.bathrooms != null && <span className="flex items-center gap-1"><Bath size={14} /> {p.bathrooms} WC</span>}
          {p.area_m2 != null && <span className="flex items-center gap-1"><Maximize2 size={14} /> {p.area_m2} m²</span>}
          {p.parking_spots != null && <span className="flex items-center gap-1"><Car size={14} /> {p.parking_spots} garagem</span>}
          {p.furnished && <span className="rounded-full bg-accent px-2 py-0.5">Mobilado</span>}
        </div>

        {p.description && (
          <div>
            <h3 className="mb-1 text-xs font-bold uppercase text-muted-foreground">Descrição</h3>
            <p className="whitespace-pre-line text-sm text-foreground">{p.description}</p>
          </div>
        )}

        {p.real_estate_agencies && (
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted-foreground">Anunciado por</p>
            <p className="text-sm font-bold">{p.real_estate_agencies.name}</p>
            <p className="text-xs text-muted-foreground">{p.real_estate_agencies.phone}</p>
          </div>
        )}

        {p.lat != null && p.lng != null && (
          <iframe
            title="Mapa"
            className="h-56 w-full rounded-xl border border-border"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.lng - 0.01},${p.lat - 0.01},${p.lng + 0.01},${p.lat + 0.01}&layer=mapnik&marker=${p.lat},${p.lng}`}
          />
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => setOpenVisit((v) => !v)} className="w-full"><Calendar size={16} /> Marcar visita</Button>
          {whatsapp ? (
            <a href={whatsapp} target="_blank" rel="noopener noreferrer"
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-green-600 text-sm font-semibold text-white">
              <MessageCircle size={16} /> WhatsApp
            </a>
          ) : (
            <Button variant="outline" disabled><Phone size={16} /> Sem contacto</Button>
          )}
        </div>

        {openVisit && (
          <form onSubmit={submitVisit} className="space-y-3 rounded-xl border border-border p-4">
            <h3 className="text-sm font-bold">Marcar visita</h3>
            {!user && <p className="text-xs text-destructive">Faça <Link to="/login" className="underline">login</Link> para enviar.</p>}
            <div className="space-y-1.5">
              <Label className="text-xs">Seu telefone *</Label>
              <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="+244 …" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Data preferida *</Label>
                <Input type="date" value={form.preferred_date} onChange={(e) => setForm({ ...form, preferred_date: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Hora</Label>
                <Input type="time" value={form.preferred_time} onChange={(e) => setForm({ ...form, preferred_time: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mensagem</Label>
              <Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} placeholder="Conte ao proprietário o que pretende visitar." />
            </div>
            <Button type="submit" disabled={busy || !user} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : "Enviar pedido"}
            </Button>
          </form>
        )}
      </div>
    </AppShell>
  );
}