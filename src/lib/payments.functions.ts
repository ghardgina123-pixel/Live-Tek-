import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const COMMISSION_PCT = 5.0;

/**
 * Cria um Payment Intent (Multicaixa Express) para um pedido do cliente.
 * Calcula o split entre a loja e a plataforma. Não contacta o gateway ainda:
 * grava o intent como "pending" para que o webhook do provedor possa confirmá-lo.
 */
export const createMulticaixaExpressIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { orderId: string }) => {
    if (!input?.orderId || typeof input.orderId !== "string") throw new Error("invalid_input");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, customer_id, store_id, total_aoa, status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (orderErr) throw new Error(orderErr.message);
    if (!order) throw new Error("order_not_found");
    if (order.customer_id !== userId) throw new Error("not_authorized");
    if (order.status !== "pending") throw new Error("order_not_payable");

    const amount = Number(order.total_aoa);
    const platformFee = Math.round(amount * (COMMISSION_PCT / 100) * 100) / 100;
    const storeAmount = Math.round((amount - platformFee) * 100) / 100;

    const reference = `LM-${order.id.slice(0, 8).toUpperCase()}-${Date.now().toString().slice(-5)}`;

    const { data: intent, error: insertErr } = await supabase
      .from("payment_intents")
      .insert({
        order_id: order.id,
        provider: "multicaixa_express",
        amount_aoa: amount,
        store_amount_aoa: storeAmount,
        platform_fee_aoa: platformFee,
        commission_pct: COMMISSION_PCT,
        reference,
        status: "pending",
      })
      .select("id, reference, amount_aoa, store_amount_aoa, platform_fee_aoa, status")
      .single();
    if (insertErr) throw new Error(insertErr.message);

    // TODO: quando MULTICAIXA_EXPRESS_MERCHANT_ID / TOKEN estiverem configurados,
    // chamar aqui o SDK do provedor para gerar o token de checkout one-tap
    // e devolvê-lo no campo `checkoutToken`.
    return { intent, checkoutToken: null as string | null };
  });