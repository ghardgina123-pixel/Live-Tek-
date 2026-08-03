import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { currencyStore, registerCurrency } from "@/lib/currency";

export type Region = {
  id: string | null;
  code: string;
  name: string;
  language_code: string;
  locale: string;
  currency_code: string;
  currency_symbol: string;
  phone_prefix: string | null;
  center_lat: number;
  center_lng: number;
  default_zoom: number;
};

export const DEFAULT_REGION: Region = {
  id: null,
  code: "AO",
  name: "Angola",
  language_code: "pt",
  locale: "pt-AO",
  currency_code: "AOA",
  currency_symbol: "Kz",
  phone_prefix: "+244",
  center_lat: -11.2027,
  center_lng: 17.8739,
  default_zoom: 6,
};

const STORAGE_KEY = "lm:region";
const SELECT =
  "id, code, name, language_code, locale, currency_code, currency_symbol, phone_prefix, center_lat, center_lng, default_zoom";

let current: Region = DEFAULT_REGION;
const listeners = new Set<() => void>();
let hydrated = false;

function normalize(row: Record<string, unknown>): Region {
  return {
    id: (row.id as string) ?? null,
    code: (row.code as string) ?? DEFAULT_REGION.code,
    name: (row.name as string) ?? DEFAULT_REGION.name,
    language_code: (row.language_code as string) || "pt",
    locale: (row.locale as string) || "pt-PT",
    currency_code: (row.currency_code as string) || "AOA",
    currency_symbol: (row.currency_symbol as string) || (row.currency_code as string) || "AOA",
    phone_prefix: (row.phone_prefix as string) ?? null,
    center_lat: row.center_lat != null ? Number(row.center_lat) : DEFAULT_REGION.center_lat,
    center_lng: row.center_lng != null ? Number(row.center_lng) : DEFAULT_REGION.center_lng,
    default_zoom: row.default_zoom != null ? Number(row.default_zoom) : 6,
  };
}

function emit(next: Region) {
  current = next;
  // Moeda acompanha automaticamente o país (cobertura total de moedas).
  if (next.currency_code) {
    registerCurrency({
      code: next.currency_code,
      symbol: next.currency_symbol,
      name: next.currency_code,
      locale: next.locale,
    });
    currencyStore.set(next.currency_code);
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* noop */ }
  listeners.forEach((l) => l());
}

async function fetchBy(column: "id" | "code", value: string): Promise<Region | null> {
  const { data } = await supabase.from("countries").select(SELECT).eq(column, value).maybeSingle();
  return data ? normalize(data as Record<string, unknown>) : null;
}

export const regionStore = {
  get: () => current,
  subscribe(l: () => void) {
    hydrate();
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
  /** Define o país activo (por id ou código ISO) e propaga idioma/moeda/mapa. */
  async setCountry(idOrCode: string) {
    if (!idOrCode) return;
    const column = idOrCode.length > 4 ? "id" : "code";
    const region = await fetchBy(column, idOrCode);
    if (region) emit(region);
  },
  setRegion(region: Region) { emit(region); },
};

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      current = { ...DEFAULT_REGION, ...(JSON.parse(raw) as Region) };
      listeners.forEach((l) => l());
    }
  } catch { /* noop */ }
  // Actualiza a partir da base de dados (fonte de verdade).
  fetchBy("code", current.code).then((r) => { if (r) emit(r); }).catch(() => {});
}

export function useRegion(): Region {
  const region = useSyncExternalStore(
    regionStore.subscribe,
    () => regionStore.get(),
    () => DEFAULT_REGION,
  );
  useEffect(() => { hydrate(); }, []);
  return region;
}

/** Centro/zoom do mapa para o país activo. */
export function useMapDefaults() {
  const r = useRegion();
  return { center: { lat: r.center_lat, lng: r.center_lng }, zoom: r.default_zoom };
}
