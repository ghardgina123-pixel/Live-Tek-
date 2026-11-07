import { z } from "zod";

export const ANGOLA_CHECKOUT_METHODS = [
  { type: "multicaixa_express", name: "Multicaixa Express" },
  { type: "multicaixa_reference", name: "Referência Multicaixa" },
  { type: "unitel_money", name: "Unitel Money" },
  { type: "kwik", name: "Kwiki" },
  { type: "ekwanza", name: "e-Kwanza" },
  { type: "afrimoney", name: "AfriMoney" },
] as const;

export const checkoutPaymentTypeSchema = z.enum([
  "multicaixa_express", "multicaixa_reference", "unitel_money", "kwik", "ekwanza", "afrimoney",
]);
export type CheckoutPaymentType = z.infer<typeof checkoutPaymentTypeSchema>;

export function assertCheckoutGateway(method: CheckoutPaymentType): never {
  // The existing Express intent writer does not call a provider; none of the
  // other five methods has an adapter. A catalog flag cannot authorize money.
  // Replace this guard only with an officially validated provider initiation.
  const name = ANGOLA_CHECKOUT_METHODS.find((item) => item.type === method)?.name;
  throw new Error(`${name ?? "Pagamento"}: não existe uma ligação de cobrança ativa. Nenhum pedido ou pagamento foi criado.`);
}