import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { currencyStore, getCurrency, registerCurrency, useCurrency } from "@/lib/currency";

export function CurrencySelector({ variant = "pill" }: { variant?: "pill" | "row" }) {
  const current = useCurrency();
  const [open, setOpen] = useState(false);
  const [codes, setCodes] = useState<string[]>([current.code]);
  const [q, setQ] = useState("");

  // Cobertura total: as moedas disponíveis vêm da tabela de câmbio,
  // com símbolo/locale/nome vindos da tabela de países.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [{ data: rates }, { data: countries }] = await Promise.all([
        supabase.from("exchange_rates").select("to_currency").eq("from_currency", "AOA"),
        supabase.from("countries").select("name, currency_code, currency_symbol, locale").not("currency_code", "is", null),
      ]);
      for (const c of countries ?? []) {
        if (!c.currency_code) continue;
        registerCurrency({
          code: c.currency_code,
          symbol: c.currency_symbol,
          name: c.currency_code,
          locale: c.locale,
        });
      }
      const list = Array.from(new Set((rates ?? []).map((r) => r.to_currency.toUpperCase()))).sort();
      if (alive && list.length) setCodes(list);
    })();
    return () => { alive = false; };
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toUpperCase();
    return term ? codes.filter((c) => c.includes(term)) : codes;
  }, [codes, q]);

  const trigger =
    variant === "pill" ? (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-full bg-black/40 px-3 py-1.5 text-[11px] font-semibold text-white"
      >
        <span className="text-sm leading-none">{current.flag}</span>
        {current.code}
        <ChevronDown size={12} />
      </button>
    ) : (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between rounded-2xl border border-border bg-card p-3 text-left"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{current.flag}</span>
          <div>
            <p className="text-sm font-semibold">Moeda</p>
            <p className="text-xs text-muted-foreground">{current.name} ({current.code})</p>
          </div>
        </div>
        <ChevronDown size={16} className="text-muted-foreground" />
      </button>
    );

  return (
    <>
      {trigger}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setOpen(false)}
        >
          <div
            className="mx-auto w-full max-w-[480px] rounded-t-3xl bg-background p-5 pb-8 text-foreground"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted" />
            <h3 className="text-base font-bold">Selecione sua moeda</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Os preços serão convertidos automaticamente.
            </p>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Procurar moeda (ex.: EUR)"
              aria-label="Procurar moeda"
              className="mt-3 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
            <ul className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto pr-1">
              {filtered.map((code) => {
                const c = getCurrency(code);
                const active = code === current.code;
                return (
                  <li key={code}>
                    <button
                      onClick={() => { currencyStore.set(code); setOpen(false); }}
                      className={`flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition ${active ? "border-primary bg-accent" : "border-border"}`}
                    >
                      <span className="text-2xl">{c.flag}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold">{c.name}</p>
                        <p className="text-xs text-muted-foreground">{c.code} · {c.symbol}</p>
                      </div>
                      {active && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check size={14} strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}