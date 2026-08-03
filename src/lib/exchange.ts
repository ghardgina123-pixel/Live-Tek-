import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CURRENCIES, formatAmount, getCurrency, registerBrlRates, type CurrencyCode } from "@/lib/currency";

// Conversão com base em AOA. Todos os preços são guardados em AOA
// (`products.price_aoa`) e convertidos com as taxas da tabela `exchange_rates`,
// que cobre todas as moedas suportadas pela plataforma.

export type RateMap = Record<string, number>;

let cache: { at: number; rates: RateMap } | null = null;
const TTL_MS = 5 * 60 * 1000; // 5 minutos
const listeners = new Set<(r: RateMap) => void>();

async function fetchRates(): Promise<RateMap> {
  const { data, error } = await supabase
    .from("exchange_rates")
    .select("from_currency, to_currency, rate")
    .eq("from_currency", "AOA");
  if (error) throw error;
  const map: RateMap = { AOA: 1 };
  for (const row of data ?? []) {
    map[row.to_currency.toUpperCase()] = Number(row.rate);
  }
  // Propaga as taxas para o registo de moedas (base BRL, usado por formatPrice).
  const aoaPerBrl = map.BRL && map.BRL > 0 ? 1 / map.BRL : 0;
  if (aoaPerBrl > 0) {
    const brl: RateMap = {};
    for (const [code, aoaRate] of Object.entries(map)) brl[code] = aoaRate * aoaPerBrl;
    registerBrlRates(brl);
  }
  return map;
}

export async function getRates(force = false): Promise<RateMap> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  const rates = await fetchRates();
  cache = { at: Date.now(), rates };
  listeners.forEach((l) => l(rates));
  return rates;
}

/** Converte um preço em AOA para a moeda alvo. */
export function convertFromAOA(priceAoa: number, target: CurrencyCode, rates?: RateMap): number {
  const code = (target || "AOA").toUpperCase();
  if (code === "AOA") return priceAoa;
  const dbRate = (rates ?? cache?.rates)?.[code];
  if (typeof dbRate === "number" && dbRate > 0) return priceAoa * dbRate;
  // Fallback: usa a taxa relativa ao BRL guardada no registo de moedas.
  const aoaPerBrl = CURRENCIES.AOA?.rate ?? 0;
  const targetPerBrl = getCurrency(code).rate;
  if (!aoaPerBrl || !targetPerBrl) return priceAoa;
  return (priceAoa / aoaPerBrl) * targetPerBrl;
}

/** Formata um número na moeda indicada, sem reconverter. */
export function formatInCurrency(value: number, target: CurrencyCode): string {
  return formatAmount(value, getCurrency(target));
}

/** Converte + formata num só passo. */
export function formatPriceAoa(priceAoa: number, target: CurrencyCode, rates?: RateMap): string {
  return formatInCurrency(convertFromAOA(priceAoa, target, rates), target);
}

/** Hook React: taxas de câmbio vivas (AOA -> *). */
export function useExchangeRates(): RateMap {
  const [rates, setRates] = useState<RateMap>(() => cache?.rates ?? { AOA: 1 });
  useEffect(() => {
    let alive = true;
    getRates().then((r) => { if (alive) setRates(r); }).catch(() => {});
    const l = (r: RateMap) => setRates(r);
    listeners.add(l);
    return () => { alive = false; listeners.delete(l); };
  }, []);
  return rates;
}
