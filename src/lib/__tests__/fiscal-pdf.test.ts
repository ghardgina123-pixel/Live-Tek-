import { describe, expect, it } from "vitest";
import { buildFiscalInvoicePdf, type FiscalInvoice } from "../fiscal-pdf";

const base: FiscalInvoice = {
  full_number: "COM 2026/1",
  series: "COM",
  number: 1,
  doc_kind: "commission",
  issuer_kind: "platform",
  issued_at: "2026-09-08T10:00:00Z",
  currency_code: "AOA",
  subtotal_aoa: 1000,
  tax_aoa: 0,
  total_aoa: 1000,
  payment_method: null,
  reference: null,
  period_start: null,
  period_end: null,
  status: "pending",
  issuer_snapshot: null,
  customer_snapshot: { store_name: "Loja X", nif: "5000000000" },
  items: [{ description: "Comissão 10%", quantity: 1, unit_price_aoa: 1000, total_aoa: 1000 }],
};

describe("buildFiscalInvoicePdf", () => {
  it("gera bytes de um PDF válido", () => {
    const bytes = buildFiscalInvoicePdf(base);
    expect(bytes.byteLength).toBeGreaterThan(500);
    expect(String.fromCharCode(...bytes.slice(0, 4))).toBe("%PDF");
  });

  it("não inventa dados fiscais quando o emissor está por configurar", () => {
    const bytes = buildFiscalInvoicePdf(base);
    const txt = new TextDecoder("latin1").decode(bytes);
    expect(txt).not.toContain("TUSSALA");
  });

  it("funciona sem itens (usa o subtotal do documento)", () => {
    const bytes = buildFiscalInvoicePdf({ ...base, items: [] });
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
