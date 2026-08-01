import { useSyncExternalStore } from "react";

export type CurrencyCode = "BRL" | "AOA" | "USD" | "EUR";

export type Currency = {
  code: CurrencyCode;
  symbol: string;
  name: string;
  flag: string;
  // Rate relative to BRL (1 BRL = rate units of this currency).
  // Indicative rates for demo purposes only.
  rate: number;
  locale: string;
};

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  BRL: { code: "BRL", symbol: "R$",  name: "Real brasileiro",   flag: "🇧🇷", rate: 1,      locale: "pt-BR" },
  AOA: { code: "AOA", symbol: "AOA", name: "Kwanza angolano",   flag: "🇦🇴", rate: 175,    locale: "pt-AO" },
  USD: { code: "USD", symbol: "$",   name: "Dólar americano",   flag: "🇺🇸", rate: 0.19,   locale: "en-US" },
  EUR: { code: "EUR", symbol: "€",   name: "Euro",              flag: "🇪🇺", rate: 0.17,   locale: "de-DE" },
};

// Map common country/locale codes to a default currency.
const COUNTRY_TO_CURRENCY: Record<string, CurrencyCode> = {
  BR: "BRL", PT: "EUR",
  AO: "AOA",
  US: "USD", CA: "USD", GB: "USD",
  DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", AT: "EUR", BE: "EUR",
};

const STORAGE_KEY = "lm:currency";

function detectCurrency(): CurrencyCode {
  // Live Teká opera exclusivamente em Angola — moeda fixa em Kwanza (AOA).
  return "AOA";
}

let current: CurrencyCode = "AOA";
const listeners = new Set<() => void>();
let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  current = detectCurrency();
  listeners.forEach((l) => l());
}

export const currencyStore = {
  get: () => current,
  set(code: CurrencyCode) {
    if (!CURRENCIES[code] || code === current) return;
    current = code;
    try { localStorage.setItem(STORAGE_KEY, code); } catch { /* noop */ }
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    ensureInit();
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};

export function useCurrency(): Currency {
  const code = useSyncExternalStore(
    currencyStore.subscribe,
    () => currencyStore.get(),
    () => "AOA" as CurrencyCode,
  );
  return CURRENCIES[code];
}

/** Convert a BRL-denominated amount and format in the active currency. */
export function formatPrice(amountBRL: number, currency?: Currency): string {
  const c = currency ?? CURRENCIES[current];
  const value = amountBRL * c.rate;
  // Deterministic formatting for AOA to avoid SSR/CSR Intl divergence (Kz vs AOA).
  if (c.code === "AOA") {
    const n = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${n} AOA`;
  }
  try {
    return new Intl.NumberFormat(c.locale, {
      style: "currency",
      currency: c.code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${c.symbol} ${value.toFixed(2)}`;
  }
}