import { z } from "zod";

// Cadastro
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(100, "Nome muito longo"),
  email: z.string().trim().email("E-mail inválido").max(255),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+\d\s()-]*$/, "Telefone inválido")
    .optional()
    .or(z.literal("")),
  pwd: z.string().min(6, "Senha mínima de 6 caracteres").max(72, "Senha muito longa"),
});
export type SignupInput = z.infer<typeof signupSchema>;

// Produtos (painel do lojista)
const optionalPositive = (max: number, msg: string) =>
  z
    .number()
    .positive(msg)
    .max(max, msg)
    .optional()
    .nullable();

export const productSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto").max(200, "Nome muito longo"),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  price_aoa: z.number().positive("Preço inválido").max(100_000_000),
  stock: z.number().int().min(0).max(1_000_000),
  weight_kg: optionalPositive(10_000, "Peso inválido"),
  length_cm: optionalPositive(1_000, "Comprimento inválido"),
  width_cm: optionalPositive(1_000, "Largura inválida"),
  height_cm: optionalPositive(1_000, "Altura inválida"),
});
export type ProductInput = z.infer<typeof productSchema>;


// Checkout
export const checkoutSchema = z.object({
  addressId: z.string().uuid("Endereço inválido"),
  paymentMethodId: z.string().uuid("Forma de pagamento inválida"),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive().max(999),
      }),
    )
    .min(1, "Carrinho vazio"),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;