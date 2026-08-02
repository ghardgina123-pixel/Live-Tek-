import { useEffect, useState } from "react";
import { Check, Globe, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { regionStore, useRegion } from "@/lib/region";
import { LANGUAGE_NAMES, useT, type Lang } from "@/lib/i18n";

type Row = {
  id: string;
  code: string;
  name: string;
  language_code: string;
  currency_code: string | null;
  currency_symbol: string | null;
};

/**
 * Seletor de país que actualiza automaticamente idioma, moeda, métodos de
 * pagamento, divisões administrativas e centro do mapa (sem refresh).
 */
export function RegionSelector({ onChanged }: { onChanged?: (countryId: string) => void }) {
  const region = useRegion();
  const { t } = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase
      .from("countries")
      .select("id, code, name, language_code, currency_code, currency_symbol")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);

  const list = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));

  const pick = async (row: Row) => {
    setBusy(true);
    await regionStore.setCountry(row.id);
    const { data: auth } = await supabase.auth.getUser();
    if (auth.user) {
      await supabase
        .from("profiles")
        .update({ country_id: row.id, country_code: row.code })
        .eq("id", auth.user.id);
    }
    onChanged?.(row.id);
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border bg-card p-3">
        <div className="flex items-center gap-3">
          <Globe size={18} className="text-primary" />
          <div className="flex-1">
            <p className="text-sm font-semibold">{region.name}</p>
            <p className="text-xs text-muted-foreground">
              {LANGUAGE_NAMES[(region.language_code as Lang)] ?? region.language_code} ·{" "}
              {region.currency_code} ({region.currency_symbol}) · {region.phone_prefix ?? "—"}
            </p>
          </div>
          {busy && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">{t("region_hint")}</p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("select")}
        aria-label={t("country")}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      />

      <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
        {list.map((r) => {
          const active = r.code === region.code;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left text-sm transition ${active ? "border-primary bg-accent" : "border-border"}`}
              >
                <span className="flex-1">{r.name}</span>
                <span className="text-xs text-muted-foreground">{r.currency_code ?? ""}</span>
                {active && <Check size={14} className="text-primary" strokeWidth={3} />}
              </button>
            </li>
          );
        })}
        {list.length === 0 && (
          <li className="p-3 text-xs text-muted-foreground">—</li>
        )}
      </ul>
    </div>
  );
}
