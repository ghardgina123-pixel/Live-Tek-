import { describe, it, expect } from "vitest";
import { signupSchema, productSchema, checkoutSchema } from "@/lib/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("signupSchema", () => {
  const valid = { name: "João Silva", email: "joao@example.com", phone: "+244 923 000 000", pwd: "secret1" };

  it("accepts a valid payload", () => {
    expect(signupSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty optional phone", () => {
    expect(signupSchema.safeParse({ ...valid, phone: "" }).success).toBe(true);
  });

  it("rejects name shorter than 2 chars", () => {
    const r = signupSchema.safeParse({ ...valid, name: "A" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/curto/i);
  });

  it("rejects name longer than 100 chars", () => {
    expect(signupSchema.safeParse({ ...valid, name: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects invalid email", () => {
    expect(signupSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
  });

  it("rejects phone with letters", () => {
    expect(signupSchema.safeParse({ ...valid, phone: "abc123" }).success).toBe(false);
  });

  it("rejects password shorter than 6 chars", () => {
    expect(signupSchema.safeParse({ ...valid, pwd: "12345" }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(signupSchema.safeParse({}).success).toBe(false);
  });
});

describe("productSchema", () => {
  const valid = { name: "Camisa", description: "Algodão", price_aoa: 5000, stock: 10 };

  it("accepts a valid payload", () => {
    expect(productSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts empty description", () => {
    expect(productSchema.safeParse({ ...valid, description: "" }).success).toBe(true);
  });

  it("rejects zero price", () => {
    const r = productSchema.safeParse({ ...valid, price_aoa: 0 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/Preço inválido/);
  });

  it("rejects negative price", () => {
    expect(productSchema.safeParse({ ...valid, price_aoa: -100 }).success).toBe(false);
  });

  it("rejects price exceeding maximum", () => {
    expect(productSchema.safeParse({ ...valid, price_aoa: 200_000_000 }).success).toBe(false);
  });

  it("rejects non-integer stock", () => {
    expect(productSchema.safeParse({ ...valid, stock: 1.5 }).success).toBe(false);
  });

  it("rejects negative stock", () => {
    expect(productSchema.safeParse({ ...valid, stock: -1 }).success).toBe(false);
  });

  it("rejects name shorter than 2 chars", () => {
    expect(productSchema.safeParse({ ...valid, name: "A" }).success).toBe(false);
  });

  it("rejects description longer than 2000 chars", () => {
    expect(productSchema.safeParse({ ...valid, description: "x".repeat(2001) }).success).toBe(false);
  });

  it("rejects missing required fields", () => {
    expect(productSchema.safeParse({ name: "X" }).success).toBe(false);
  });
});

describe("checkoutSchema", () => {
  const valid = {
    addressId: uuid,
    paymentMethodId: uuid,
    items: [{ productId: uuid, quantity: 2 }],
  };

  it("accepts a valid payload", () => {
    expect(checkoutSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects invalid address uuid", () => {
    expect(checkoutSchema.safeParse({ ...valid, addressId: "abc" }).success).toBe(false);
  });

  it("rejects empty cart", () => {
    const r = checkoutSchema.safeParse({ ...valid, items: [] });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].message).toMatch(/vazio/i);
  });

  it("rejects zero quantity", () => {
    expect(
      checkoutSchema.safeParse({ ...valid, items: [{ productId: uuid, quantity: 0 }] }).success,
    ).toBe(false);
  });

  it("rejects quantity above 999", () => {
    expect(
      checkoutSchema.safeParse({ ...valid, items: [{ productId: uuid, quantity: 1000 }] }).success,
    ).toBe(false);
  });

  it("rejects missing payment method", () => {
    const { paymentMethodId, ...rest } = valid;
    void paymentMethodId;
    expect(checkoutSchema.safeParse(rest).success).toBe(false);
  });
});