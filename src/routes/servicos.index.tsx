import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Search, MapPin, Phone, Loader2, BadgeCheck } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { SERVICE_CATEGORIES, serviceCategoryEmoji, serviceCategoryLabel } from "@/lib/services";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

type ServiceRow = {
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
};

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  cat: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/servicos/")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Serviços — Live Teká" },
      { name: "description", content: "Encontre salões, barbearias, hotéis, farmácias, restaurantes e outros prestadores de serviço na Live Teká." },
      { property: "og:title", content: "Serviços — Live Teká" },
      { property: "og:description", content: "Pesquise e contacte prestadores de serviço perto de si na Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:url", content: "https://www.livemarketplece.live/servicos" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/servicos" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Serviços na Live Teká",
          description:
            "Encontre salões, barbearias, hotéis, farmácias, restaurantes e outros prestadores de serviço na Live Teká.",
          url: "https://www.livemarketplece.live/servicos",
        }),
      },
    ],
  }),
  component: ServicosPage,
});

function ServicosPage() {
  const search = Route.useSearch();
  const [q, setQ] = useState(search.q ?? "");
  const [cat, setCat] = useState(search.cat ?? "");
  const [rows, setRows] = useState<ServiceRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("stores")
        .select("id, name, description, service_category, logo_url, cover_url, opening_hours, phone, whatsapp, service_tags")
        .eq("status", "active")
        .eq("partner_type", "service")
        .eq("is_suspended", false)
        .order("created_at", { ascending: false })
        .limit(200);
      if (!cancelled) setRows((data as ServiceRow[]) ?? []);
    })();
    return () => { cancelled = true; };
  }, []);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter((s) => {
      if (cat && s.service_category !== cat) return false;
      if (!needle) return true;
      const hay = [s.name, s.description ?? "", serviceCategoryLabel(s.service_category), ...(s.service_tags ?? [])]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [rows, q, cat]);

  return (
    <AppShell>
      <header className="sticky top-0 z-30 bg-background/95 px-5 pt-6 pb-3 backdrop-blur-xl">
        <h1 className="text-2xl font-bold">Serviços</h1>
        <p className="text-xs text-muted-foreground">Salões, hotéis, farmácias, restaurantes e muito mais.</p>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Pesquisar serviço, categoria ou nome…"
            className="h-11 rounded-xl bg-muted pl-10"
          />
        </div>
        <div className="-mx-5 mt-3 flex gap-2 overflow-x-auto px-5 pb-1">
          <button
            onClick={() => setCat("")}
            className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-semibold transition ${cat === "" ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
          >
            Todos
          </button>
          {SERVICE_CATEGORIES.map((c) => (
            <button
              key={c.value}
              onClick={() => setCat(cat === c.value ? "" : c.value)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${cat === c.value ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {c.emoji} {c.label}
            </button>
          ))}
        </div>
      </header>

      {rows === null ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="animate-spin text-primary" /></div>
      ) : (
        <ul className="space-y-3 px-5 pt-2">
          {list.length === 0 && (
            <li className="rounded-2xl bg-muted/40 p-6 text-center text-xs text-muted-foreground">
              Nenhum prestador de serviço encontrado.{" "}
              <Link to="/lojista" className="font-semibold text-primary">Registe o seu negócio</Link>.
            </li>
          )}
          {list.map((s) => (
            <li key={s.id}>
              <Link to="/servicos/$id" params={{ id: s.id }} className="flex gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
                {s.logo_url ? (
                  <img src={s.logo_url} alt={s.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-accent text-4xl">
                    {serviceCategoryEmoji(s.service_category)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="truncate font-semibold">{s.name}</p>
                    <BadgeCheck size={14} className="shrink-0 text-primary" />
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {s.description ?? serviceCategoryLabel(s.service_category)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">
                      {serviceCategoryLabel(s.service_category)}
                    </span>
                    {s.opening_hours && <span className="truncate">🕒 {s.opening_hours}</span>}
                    {(s.whatsapp || s.phone) && <span className="flex items-center gap-1"><Phone size={11} /> {s.whatsapp ?? s.phone}</span>}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="px-5 pb-8 pt-5 text-center text-[11px] text-muted-foreground">
        <MapPin size={12} className="mr-1 inline" /> Presta serviços?{" "}
        <Link to="/lojista" className="font-semibold text-primary">Registe o seu estabelecimento</Link>.
      </p>
    </AppShell>
  );
}
