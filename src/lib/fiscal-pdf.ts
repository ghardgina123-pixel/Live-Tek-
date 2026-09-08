import { jsPDF } from "jspdf";

/**
 * Geração do PDF fiscal a partir EXCLUSIVAMENTE dos snapshots guardados na
 * factura. Nunca lê o perfil actual do lojista/cliente e nunca inventa NIF,
 * regime fiscal, impostos ou números AGT: o que não existir fica omitido.
 */
export type FiscalParty = {
  legal_name?: string | null;
  trade_name?: string | null;
  name?: string | null;
  store_name?: string | null;
  nif?: string | null;
  address?: string | null;
  fiscal_address?: string | null;
  province?: string | null;
  fiscal_province?: string | null;
  municipality?: string | null;
  fiscal_municipality?: string | null;
  email?: string | null;
  phone?: string | null;
  tax_regime?: string | null;
  configured?: boolean | null;
};

export type FiscalInvoiceItem = {
  description: string;
  quantity: number;
  unit_price_aoa: number;
  total_aoa: number;
};

export type FiscalInvoice = {
  full_number: string;
  series: string;
  number: number | string;
  doc_kind: string;
  issuer_kind: string;
  issued_at: string;
  currency_code: string;
  subtotal_aoa: number;
  tax_aoa: number;
  total_aoa: number;
  payment_method?: string | null;
  reference?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  status: string;
  issuer_snapshot: FiscalParty | null;
  customer_snapshot: FiscalParty | null;
  items: FiscalInvoiceItem[];
};

const DOC_LABEL: Record<string, string> = {
  sale: "Factura de venda",
  commission: "Factura de comissão",
  subscription: "Factura de subscrição",
};

function money(n: number, currency: string) {
  const v = Number(n || 0).toLocaleString("pt-AO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${currency === "AOA" ? "Kz" : currency} ${v}`;
}

function fmtDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString("pt-AO") : "—";
}

function partyLines(p: FiscalParty | null): string[] {
  if (!p) return ["Dados fiscais por configurar"];
  const lines: string[] = [];
  const name = p.legal_name || p.trade_name || p.store_name || p.name;
  if (name) lines.push(String(name));
  if (p.nif) lines.push(`NIF: ${p.nif}`);
  const addr = p.fiscal_address || p.address;
  if (addr) lines.push(String(addr));
  const loc = [p.fiscal_municipality || p.municipality, p.fiscal_province || p.province]
    .filter(Boolean)
    .join(", ");
  if (loc) lines.push(loc);
  if (p.email) lines.push(String(p.email));
  if (p.phone) lines.push(String(p.phone));
  if (p.tax_regime) lines.push(`Regime fiscal: ${p.tax_regime}`);
  return lines.length ? lines : ["Dados fiscais por configurar"];
}

/** Devolve os bytes do PDF (sem gravar nada, sem depender do browser). */
export function buildFiscalInvoicePdf(inv: FiscalInvoice): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const cur = inv.currency_code || "AOA";

  doc.setFillColor(4, 120, 87);
  doc.rect(0, 0, W, 84, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(16).text("Live Teká", 40, 42);
  doc
    .setFont("helvetica", "normal")
    .setFontSize(9)
    .text(DOC_LABEL[inv.doc_kind] ?? "Documento", 40, 60);
  doc
    .setFont("helvetica", "bold")
    .setFontSize(13)
    .text(inv.full_number, W - 40, 48, { align: "right" });

  doc.setTextColor(30, 30, 30);
  let y = 120;
  doc.setFont("helvetica", "bold").setFontSize(10).text("Emissor", 40, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  partyLines(inv.issuer_snapshot).forEach((l) => {
    y += 13;
    doc.text(l, 40, y);
  });

  let yr = 120;
  doc.setFont("helvetica", "bold").setFontSize(10).text("Adquirente", W / 2 + 10, yr);
  doc.setFont("helvetica", "normal").setFontSize(9);
  partyLines(inv.customer_snapshot).forEach((l) => {
    yr += 13;
    doc.text(l, W / 2 + 10, yr);
  });

  y = Math.max(y, yr) + 28;
  doc.setFont("helvetica", "normal").setFontSize(9);
  doc.text(`Série: ${inv.series}   Nº: ${inv.number}`, 40, y);
  doc.text(`Data de emissão: ${fmtDate(inv.issued_at)}`, W - 40, y, { align: "right" });
  y += 13;
  doc.text(`Moeda: ${cur}`, 40, y);
  doc.text(`Estado: ${inv.status === "paid" ? "Paga" : inv.status}`, W - 40, y, { align: "right" });
  if (inv.period_start || inv.period_end) {
    y += 13;
    doc.text(`Período: ${fmtDate(inv.period_start)} a ${fmtDate(inv.period_end)}`, 40, y);
  }
  if (inv.reference || inv.payment_method) {
    y += 13;
    if (inv.payment_method) doc.text(`Método: ${inv.payment_method}`, 40, y);
    if (inv.reference) doc.text(`Referência: ${inv.reference}`, W - 40, y, { align: "right" });
  }

  y += 26;
  doc.setFillColor(240, 253, 244);
  doc.rect(40, y, W - 80, 22, "F");
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text("Descrição", 50, y + 15);
  doc.text("Qtd.", W - 250, y + 15, { align: "right" });
  doc.text("Preço unit.", W - 160, y + 15, { align: "right" });
  doc.text("Total", W - 50, y + 15, { align: "right" });

  y += 36;
  doc.setFont("helvetica", "normal");
  const items = inv.items.length
    ? inv.items
    : [
        {
          description: DOC_LABEL[inv.doc_kind] ?? "Documento",
          quantity: 1,
          unit_price_aoa: inv.subtotal_aoa,
          total_aoa: inv.subtotal_aoa,
        },
      ];
  for (const it of items) {
    const desc = doc.splitTextToSize(String(it.description ?? ""), W - 330) as string[];
    doc.text(desc, 50, y);
    doc.text(String(it.quantity ?? 1), W - 250, y, { align: "right" });
    doc.text(money(it.unit_price_aoa, cur), W - 160, y, { align: "right" });
    doc.text(money(it.total_aoa, cur), W - 50, y, { align: "right" });
    y += Math.max(desc.length, 1) * 12 + 6;
    if (y > H - 140) {
      doc.addPage();
      y = 80;
    }
  }

  doc.setDrawColor(220);
  doc.line(40, y, W - 40, y);
  y += 20;
  doc.setFont("helvetica", "normal").setFontSize(10);
  doc.text("Subtotal", W - 170, y);
  doc.text(money(inv.subtotal_aoa, cur), W - 50, y, { align: "right" });
  if (Number(inv.tax_aoa) > 0) {
    y += 16;
    doc.text("Impostos", W - 170, y);
    doc.text(money(inv.tax_aoa, cur), W - 50, y, { align: "right" });
  }
  y += 20;
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total", W - 170, y);
  doc.text(money(inv.total_aoa, cur), W - 50, y, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
  doc.text(
    "Documento gerado electronicamente. Ainda não constitui documento fiscal certificado pela AGT.",
    40,
    H - 40,
  );

  return new Uint8Array(doc.output("arraybuffer") as ArrayBuffer);
}
