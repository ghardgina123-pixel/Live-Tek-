import { useSyncExternalStore } from "react";

/**
 * Cobertura total de moedas.
 * O código é uma string ISO-4217 qualquer — os metadados (símbolo, locale, nome)
 * vêm da tabela `countries` e as taxas da tabela `exchange_rates` (base AOA).
 */
export type CurrencyCode = string;

export type Currency = {
  code: CurrencyCode;
  symbol: string;
  name: string;
  flag: string;
  /** 1 BRL = `rate` unidades desta moeda (usado por formatPrice). */
  rate: number;
  locale: string;
};

/** Metadados base para as moedas mais usadas na plataforma. */
const SEED: Record<string, Currency> = {
  BRL: { code: "BRL", symbol: "R$",  name: "Real brasileiro", flag: "🇧🇷", rate: 1,    locale: "pt-BR" },
  AOA: { code: "AOA", symbol: "Kz",  name: "Kwanza angolano", flag: "🇦🇴", rate: 175,  locale: "pt-AO" },
  USD: { code: "USD", symbol: "$",   name: "Dólar americano", flag: "🇺🇸", rate: 0.19, locale: "en-US" },
  EUR: { code: "EUR", symbol: "€",   name: "Euro",            flag: "🇪🇺", rate: 0.17, locale: "de-DE" },
};

/** Registo vivo de moedas (alimentado pela base de dados). */
export const CURRENCIES: Record<string, Currency> = { ...SEED };

/** Regista/actualiza metadados vindos da tabela `countries`. */
export function registerCurrency(meta: {
  code: string;
  symbol?: string | null;
  name?: string | null;
  flag?: string | null;
  locale?: string | null;
}) {
  const code = meta.code?.toUpperCase();
  if (!code) return;
  const prev = CURRENCIES[code];
  CURRENCIES[code] = {
    code,
    symbol: meta.symbol || prev?.symbol || code,
    name: meta.name || prev?.name || code,
    flag: meta.flag || prev?.flag || "🏳️",
    rate: prev?.rate ?? 0,
    locale: meta.locale || prev?.locale || "en-US",
  };
  listeners.forEach((l) => l());
}

/** Actualiza as taxas BRL -> moeda a partir das taxas AOA da base de dados. */
export function registerBrlRates(rates: Record<string, number>) {
  let changed = false;
  for (const [code, rate] of Object.entries(rates)) {
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const c = getCurrency(code);
    if (c.rate !== rate) { CURRENCIES[c.code] = { ...c, rate }; changed = true; }
  }
  if (changed) listeners.forEach((l) => l());
}

/** Devolve a moeda pedida, criando um registo genérico quando desconhecida. */
export function getCurrency(code: CurrencyCode): Currency {
  const key = (code || "AOA").toUpperCase();
  const found = CURRENCIES[key];
  if (found) return found;
  const generic: Currency = { code: key, symbol: key, name: key, flag: "🏳️", rate: 0, locale: "en-US" };
  CURRENCIES[key] = generic;
  return generic;
}

const STORAGE_KEY = "lm:currency";

let current: CurrencyCode = "AOA";
const listeners = new Set<() => void>();
let initialized = false;

function ensureInit() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) current = saved.toUpperCase();
  } catch { /* noop */ }
  listeners.forEach((l) => l());
}

export const currencyStore = {
  get: () => current,
  set(code: CurrencyCode) {
    const key = (code || "").toUpperCase();
    if (!key || key === current) return;
    getCurrency(key);
    current = key;
    try { localStorage.setItem(STORAGE_KEY, key); } catch { /* noop */ }
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
    () => `${currencyStore.get()}:${getCurrency(currencyStore.get()).rate}`,
    () => "AOA:175",
  );
  return getCurrency(code.split(":")[0]!);
}

/** Formata um valor já convertido, na moeda indicada. */
export function formatAmount(value: number, currency: Currency): string {
  if (currency.code === "AOA") {
    const n = Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${n} AOA`;
  }
  try {
    return new Intl.NumberFormat(currency.locale, {
      style: "currency",
      currency: currency.code,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    const n = value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return `${currency.symbol} ${n}`;
  }
}

/** Converte um montante em BRL e formata na moeda activa. */
export function formatPrice(amountBRL: number, currency?: Currency): string {
  const c = currency ?? getCurrency(current);
  const rate = c.rate > 0 ? c.rate : 1;
  return formatAmount(amountBRL * rate, c);
}
