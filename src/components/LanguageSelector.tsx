import { useMemo, useState } from "react";
import { Check, Languages, Search } from "lucide-react";
import { LANGUAGES, useT } from "@/lib/i18n";

/**
 * Seletor de idioma real: aplica a tradução imediatamente (sem reiniciar),
 * grava localmente e no perfil do utilizador.
 */
export function LanguageSelector({ onChanged }: { onChanged?: (code: string) => void }) {
  const { t, lang, setLang, languageName } = useT();
  const [q, setQ] = useState("");

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return LANGUAGES;
    return LANGUAGES.filter(
      (l) => l.native.toLowerCase().includes(term) || l.label.toLowerCase().includes(term) || l.code.toLowerCase().includes(term),
    );
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3">
        <Languages size={18} className="text-primary" />
        <div>
          <p className="text-sm font-semibold">{languageName}</p>
          <p className="text-xs text-muted-foreground">{t("language")} · {lang}</p>
        </div>
      </div>

      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("search_placeholder")}
          aria-label={t("search")}
          className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
        />
      </div>

      <ul className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
        {list.map((l) => {
          const active = l.code === lang;
          return (
            <li key={l.code}>
              <button
                type="button"
                onClick={() => { void setLang(l.code); onChanged?.(l.code); }}
                aria-current={active ? "true" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition active:scale-[0.99] ${active ? "border-primary bg-accent" : "border-border"}`}
              >
                <span className="text-lg leading-none">{l.flag}</span>
                <span className="flex-1">
                  <span className="block font-medium">{l.native}</span>
                  <span className="block text-xs text-muted-foreground">{l.locale}</span>
                </span>
                {active && <Check size={16} className="text-primary" strokeWidth={3} />}
              </button>
            </li>
          );
        })}
        {list.length === 0 && <li className="p-3 text-xs text-muted-foreground">{t("no_results")}</li>}
      </ul>
    </div>
  );
}
