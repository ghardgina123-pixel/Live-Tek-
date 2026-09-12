import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { limitByKey } from "@/lib/rate-limit.server";

/** Resultado do cálculo oficial (server-side) da taxa de entrega. */
export type DeliveryFeeQuote = {
  available: boolean;
  fee_aoa: number | null;
  currency: string;
  source: "municipality" | "tariff";
  tariff_id: string | null;
  tariff_name: string | null;
  distance_m: number | null;
  distance_source: string | null;
  total_weight_kg: number | null;
  total_volume_cm3: number | null;
  items_count: number;
  logistics_incomplete: boolean;
  load_class: string | null;
  unavailable_reason: string | null;
  computed_at: string | null;
};

export type TariffRule = {
  id?: string;
  load_class: string | null;
  capacity: string | null;
  multiplier: number;
  min_fee_aoa: number | null;
};

export type Tariff = {
  id: string;
  name: string;
  currency: string;
  base_fee_aoa: number;
  price_per_km_aoa: number;
  min_fee_aoa: number;
  per_kg_fee_aoa: number;
  included_weight_kg: number;
  per_m3_fee_aoa: number;
  is_active: boolean;
  notes: string | null;
  activated_at: string | null;
  deactivated_at: string | null;
  created_at: string;
  updated_at: string;
  rules: TariffRule[];
};

export type TariffEvent = {
  id: string;
  tariff_id: string | null;
  action: string;
  details: unknown;
  created_at: string;
};

/** Motivos de indisponibilidade traduzidos para o utilizador. */
export const QUOTE_REASON_LABEL: Record<string, string> = {
  sem_distancia_de_rota_real:
    "Taxa não calculada — o tarifário activo depende de distância real de rota, que ainda não está disponível.",
  dados_logisticos_incompletos:
    "Taxa não calculada — faltam peso e/ou dimensões reais de um ou mais produtos.",
};

/**
 * Devolve a taxa de entrega calculada exclusivamente pela base de dados.
 * O frontend nunca envia preço, distância, peso, volume ou multiplicador:
 * apenas identifica a loja, o endereço e os artigos.
 */
export const quoteDeliveryFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId: string; addressId: string; items: { productId: string; quantity: number }[] }) => {
    if (!input?.storeId || !input?.addressId) throw new Error("invalid_input");
    if (!Array.isArray(input.items) || input.items.length === 0) throw new Error("invalid_input");
    for (const it of input.items) {
      if (!it?.productId || !Number.isInteger(it.quantity) || it.quantity <= 0) throw new Error("invalid_input");
    }
    return { storeId: input.storeId, addressId: input.addressId, items: input.items };
  })
  .handler(async ({ data, context }): Promise<DeliveryFeeQuote> => {
    const { supabase, userId } = context;
    const limited = await limitByKey(`delivery_quote:${userId}`, 60, 5, 5);
    if (limited.blocked) throw new Error("rate_limited");

    const { data: quote, error } = await supabase.rpc("delivery_fee_quote", {
      _store_id: data.storeId,
      _address_id: data.addressId,
      _items: data.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
    });
    if (error) throw new Error(error.message);
    return quote as unknown as DeliveryFeeQuote;
  });

/** Lista tarifas e histórico (apenas administração; validado na base de dados). */
export const listDeliveryTariffs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ tariffs: Tariff[]; events: TariffEvent[] }> => {
    const { data, error } = await context.supabase.rpc("admin_delivery_tariffs");
    if (error) throw new Error(error.message);
    const out = (data ?? { tariffs: [], events: [] }) as unknown as { tariffs: Tariff[]; events: TariffEvent[] };
    return { tariffs: out.tariffs ?? [], events: out.events ?? [] };
  });

export const saveDeliveryTariff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string | null; payload: Record<string, unknown>; rules: TariffRule[] }) => {
    const name = String((input?.payload?.["name"] as string) ?? "").trim();
    if (!name) throw new Error("invalid_name");
    const numeric = [
      "base_fee_aoa",
      "price_per_km_aoa",
      "min_fee_aoa",
      "per_kg_fee_aoa",
      "included_weight_kg",
      "per_m3_fee_aoa",
    ];
    for (const k of numeric) {
      const v = Number(input.payload[k] ?? 0);
      if (!Number.isFinite(v) || v < 0) throw new Error(`invalid_${k}`);
    }
    for (const r of input.rules ?? []) {
      if (!Number.isFinite(Number(r.multiplier)) || Number(r.multiplier) <= 0) throw new Error("invalid_multiplier");
    }
    return { id: input.id ?? null, payload: input.payload, rules: input.rules ?? [] };
  })
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { data: id, error } = await context.supabase.rpc("admin_save_delivery_tariff", {
      _id: data.id,
      _payload: data.payload as never,
      _rules: data.rules as never,
    });
    if (error) throw new Error(error.message);
    return { id: id as unknown as string };
  });

export const setDeliveryTariffActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; active: boolean }) => {
    if (!input?.id || typeof input.active !== "boolean") throw new Error("invalid_input");
    return { id: input.id, active: input.active };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase.rpc("admin_set_delivery_tariff_active", {
      _id: data.id,
      _active: data.active,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
