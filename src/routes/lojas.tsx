import { createFileRoute, Link } from "@tanstack/react-router";
import { Search, Radio, BadgeCheck } from "lucide-react";
import { AppShell, StoreCover } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

type StoreRow = {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  logo_url: string | null;
  cover_url: string | null;
  is_live: boolean;
};

const searchSchema = z.object({
  q: fallback(z.string(), "").default(""),
});

export const Route = createFileRoute("/lojas")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Lojas — Live Teká" },
      { name: "description", content: "Explore todas as lojas ativas da Live Teká em Angola, com lives ao vivo, produtos e avaliações." },
      { property: "og:title", content: "Lojas — Live Teká" },
      { property: "og:description", content: "Explore todas as lojas ativas da Live Teká em Angola." },
      { property: "og:url", content: "https://www.livemarketplece.live/lojas" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/lojas" }],
    scripts: [{
      type: "application/ld+json",
      children: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Lojas — Live Teká",
        url: "https://www.livemarketplece.live/lojas",
      }),
    }],
  }),
  component: Lojas,
});

function Lojas() {
  const initial = Route.useSearch().q ?? "";
  const [q, setQ] = useState(initial);
  const [filter, setFilter] = useState<"all" | "live">("all");
  const [rows, setRows] = useState<StoreRow[]>([]);

  useEffect(() => {
    (async () => {
      const { data: storesData } = await supabase
        .from("stores")
        .select("id, name, description, category, logo_url, cover_url")
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(100);
      const ids = (storesData ?? []).map((s) => s.id);
      let liveSet = new Set<string>();
      if (ids.length) {
        const { data: livesData } = await supabase
          .from("lives")
          .select("store_id, status")
          .in("store_id", ids)
          .eq("status", "live");
        liveSet = new Set((livesData ?? []).map((l) => l.store_id));
      }
      setRows(
        (storesData ?? []).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          category: s.category,
          logo_url: s.logo_url,
          cover_url: s.cover_url,
          is_live: liveSet.has(s.id),
        })),
      );
    })();
  }, []);

  const needle = q.trim().toLowerCase();
  const list = rows.filter((s) => {
    if (filter === "live" && !s.is_live) return false;
    if (!needle) return true;
    return (
      s.name.toLowerCase().includes(needle) ||
      (s.category ?? "").toLowerCase().includes(needle) ||
      (s.description ?? "").toLowerCase().includes(needle)
    );
  });

  const gradients = ["from-emerald-400 to-teal-600", "from-blue-500 to-indigo-700", "from-pink-400 to-rose-600", "from-amber-400 to-orange-600"];
  const emojis = ["🛍️", "✨", "🔥", "🎁"];

  return (
    <AppShell>
      <header className="sticky top-0 z-30 bg-background/95 px-5 pt-6 pb-3 backdrop-blur-xl">
        <h1 className="text-2xl font-bold">Lojas</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar lojas e categorias…" className="h-11 rounded-xl bg-muted pl-10" />
        </div>
        <div className="mt-3 flex gap-2">
          {(["all", "live"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${filter === f ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
              {f === "all" ? "Todas" : "🔴 Ao vivo"}
            </button>
          ))}
        </div>
      </header>

      <ul className="space-y-3 px-5 pt-2">
        {list.length === 0 && (
          <li className="rounded-2xl bg-muted/40 p-6 text-center text-xs text-muted-foreground">
            {rows.length === 0 ? "A carregar lojas…" : "Nenhuma loja encontrada."}
          </li>
        )}
        {list.map((s, i) => (
          <li key={s.id}>
            <Link to="/loja/$id" params={{ id: s.id }} className="flex gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
              {s.logo_url ? (
                <img src={s.logo_url} alt={s.name} className="h-20 w-20 shrink-0 rounded-xl object-cover" loading="lazy" />
              ) : (
                <StoreCover gradient={gradients[i % gradients.length]} emoji={emojis[i % emojis.length]} className="h-20 w-20 shrink-0 rounded-xl" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-semibold">{s.name}</p>
                  <BadgeCheck size={14} className="shrink-0 text-primary" />
                  {s.is_live && (
                    <span className="ml-auto flex items-center gap-1 rounded-md bg-[var(--live)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                      <Radio size={9} /> live
                    </span>
                  )}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{s.description ?? s.category ?? "Loja ativa na Live Teká"}</p>
                {s.category && (
                  <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="rounded-full bg-accent px-2 py-0.5 text-accent-foreground">{s.category}</span>
                  </div>
                )}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}