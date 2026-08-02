import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CurrencySelector } from "@/components/CurrencySelector";
import { RegionSelector } from "@/components/RegionSelector";
import { useRegion } from "@/lib/region";
import { LANGUAGE_NAMES, useT, type Lang } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/idioma")({
  head: () => ({ meta: [{ title: "Idioma e moeda — Live Teká" }] }),
  component: Idioma,
});

function Idioma() {
  const region = useRegion();
  const { t } = useT();
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">{t("region_settings")}</h1>
      </header>
      <div className="space-y-5 px-5 py-5">
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("country")}</h2>
          <RegionSelector />
        </section>
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("currency")}</h2>
          <CurrencySelector variant="row" />
        </section>
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("language")}</h2>
          <div className="rounded-xl border border-border p-3 text-sm">
            <p className="font-medium">
              {LANGUAGE_NAMES[(region.language_code as Lang)] ?? region.language_code} ({region.locale})
            </p>
            <p className="text-xs text-muted-foreground">{t("region_hint")}</p>
          </div>
        </section>
      </div>
    </AppShell>
  );
}