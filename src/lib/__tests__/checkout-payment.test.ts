import { describe, expect, it } from "vitest";
import { assertCheckoutGateway, checkoutPaymentTypeSchema } from "../checkout-payment";

describe("digital-only Angola checkout", () => {
  it("rejects cash or TPA on delivery", () => {
    expect(checkoutPaymentTypeSchema.safeParse("cash_on_delivery").success).toBe(false);
  });
  it("requires an explicit payment selection", () => {
    expect(checkoutPaymentTypeSchema.safeParse(undefined).success).toBe(false);
    expect(checkoutPaymentTypeSchema.safeParse("").success).toBe(false);
  });
  it.each(["multicaixa_express", "multicaixa_reference", "unitel_money", "kwik", "ekwanza", "afrimoney"])("accepts the requested native method %s", (method) => {
    expect(checkoutPaymentTypeSchema.parse(method)).toBe(method);
  });
  it("rejects manual transfer and unrecognized payment methods", () => {
    expect(checkoutPaymentTypeSchema.safeParse("manual").success).toBe(false);
    expect(checkoutPaymentTypeSchema.safeParse("bank_transfer").success).toBe(false);
    expect(checkoutPaymentTypeSchema.safeParse("unknown").success).toBe(false);
  });
  it.each(["multicaixa_express", "multicaixa_reference", "unitel_money", "kwik", "ekwanza", "afrimoney"])("does not invent a provider transaction for %s", (method) => {
    expect(() => assertCheckoutGateway(checkoutPaymentTypeSchema.parse(method))).toThrow("Nenhum pedido ou pagamento foi criado");
  });
});