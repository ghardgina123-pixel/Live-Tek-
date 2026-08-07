import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { CurrencySelector } from "@/components/CurrencySelector";
import { LanguageSelector } from "@/components/LanguageSelector";
import { RegionSelector } from "@/components/RegionSelector";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/idioma")({
  head: () => ({
    meta: [
      { title: "Idioma, moeda e região — Live Teká" },
      { name: "description", content: "Escolha entre 20 idiomas, a moeda e o país da sua conta Live Teká." },
      { property: "og:title", content: "Idioma, moeda e região — Live Teká" },
      { property: "og:description", content: "Escolha entre 20 idiomas, a moeda e o país da sua conta Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Idioma,
});

function Idioma() {
  const { t } = useT();
  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15" aria-label={t("back")}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-lg font-semibold">{t("region_settings")}</h1>
      </header>
      <div className="space-y-6 px-5 py-5">
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("language")}</h2>
          <LanguageSelector />
        </section>
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("currency")}</h2>
          <CurrencySelector variant="row" />
        </section>
        <section>
          <h2 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("country")}</h2>
          <RegionSelector />
        </section>
      </div>
    </AppShell>
  );
}
