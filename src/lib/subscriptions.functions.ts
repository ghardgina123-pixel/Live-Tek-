import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SubscriptionIntent = {
  subscription_id: string;
  reference: string;
  plan_code: string;
  plan_name: string;
  amount_aoa: number;
  status: string;
  payment_method: string;
};

/**
 * Cria o pedido de subscrição (plano Básico / Profissional / Elite) e tenta
 * abrir o checkout do Multicaixa Express. Enquanto as credenciais do gateway
 * não estiverem configuradas devolve a referência real para pagamento, que o
 * webhook `/api/public/multicaixa-subscription-callback` confirma.
 */
export const createSubscriptionCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { storeId: string; planCode: string }) => {
    if (!input?.storeId || !input?.planCode) throw new Error("invalid_input");
    if (!["basico", "profissional", "elite"].includes(input.planCode)) throw new Error("plan_not_found");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: intentRaw, error } = await supabase.rpc("create_subscription_intent", {
      _store_id: data.storeId,
      _plan_code: data.planCode,
      _payment_method: "multicaixa_express",
    });
    if (error) throw new Error(error.message);
    const intent = intentRaw as unknown as SubscriptionIntent;

    const merchant = process.env["MULTICAIXA_EXPRESS_MERCHANT_ID"];
    const token = process.env["MULTICAIXA_EXPRESS_TOKEN"];
    const endpoint = process.env["MULTICAIXA_EXPRESS_ENDPOINT"];

    if (!merchant || !token || !endpoint) {
      return {
        intent,
        checkoutUrl: null as string | null,
        gatewayConfigured: false,
        message:
          "Referência gerada. Pague por Multicaixa Express com a referência indicada — a subscrição é ativada automaticamente após confirmação.",
      };
    }

    const res = await fetch(`${endpoint.replace(/\/$/, "")}/frame-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        reference: intent.reference,
        amount: intent.amount_aoa,
        currency: "AOA",
        merchant_id: merchant,
        description: `Subscrição ${intent.plan_name} — Live Teká`,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`Multicaixa subscription checkout failed [${res.status}]: ${body}`);
      throw new Error(`gateway_error_${res.status}`);
    }

    const payload = (await res.json()) as { url?: string; token?: string; id?: string };
    await supabase
      .from("store_subscriptions")
      .update({ external_id: payload.id ?? payload.token ?? null })
      .eq("id", intent.subscription_id);

    return {
      intent,
      checkoutUrl: payload.url ?? null,
      gatewayConfigured: true,
      message: "Checkout Multicaixa Express criado.",
    };
  });