import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertCheckoutGateway, checkoutPaymentTypeSchema } from "@/lib/checkout-payment";

export const confirmDigitalCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({
    storeId: z.string().uuid(),
    addressId: z.string().uuid(),
    paymentMethod: checkoutPaymentTypeSchema,
    items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(999) })).min(1),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: method, error } = await context.supabase.from("payment_methods")
      .select("id, is_cash_on_delivery, is_active")
      .eq("method_type", data.paymentMethod).eq("country_code", "AO").eq("is_active", true).maybeSingle();
    if (error) throw new Error("Não foi possível verificar o método de pagamento. Tente novamente.");
    if (!method || method.is_cash_on_delivery) throw new Error("Método de pagamento inválido.");
    // Fail before reserving stock, creating orders, intents or notifications.
    // Official provider contracts and credentials have not been supplied.
    assertCheckoutGateway(data.paymentMethod);
  });

/** Legacy entry point remains fail-closed until a real Express adapter exists. */
export const createMulticaixaExpressIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async () => assertCheckoutGateway("multicaixa_express"));
