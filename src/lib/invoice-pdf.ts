import { jsPDF } from "jspdf";

export type InvoiceData = {
  number: string;
  plan_name: string;
  plan_code: string;
  amount_aoa: number;
  currency_code: string;
  payment_method: string | null;
  reference: string | null;
  period_start: string;
  period_end: string | null;
  issued_at: string;
  status: string;
  customer_snapshot: { store_name?: string; phone?: string; nif?: string } | null;
};

const money = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (v?: string | null) => (v ? new Date(v).toLocaleDateString("pt-AO") : "—");

/** Gera a fatura em PDF a partir dos dados reais da transação do parceiro. */
export function generateInvoicePdf(inv: InvoiceData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const cust = inv.customer_snapshot ?? {};

  doc.setFillColor(4, 120, 87);
  doc.rect(0, 0, W, 90, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold").setFontSize(20).text("Live Teká", 40, 46);
  doc.setFont("helvetica", "normal").setFontSize(10).text("A plataforma de vendas em tempo real", 40, 64);
  doc.setFont("helvetica", "bold").setFontSize(14).text(`Fatura ${inv.number}`, W - 40, 52, { align: "right" });

  doc.setTextColor(30, 30, 30);
  let y = 130;
  doc.setFont("helvetica", "bold").setFontSize(11).text("Parceiro", 40, y);
  doc.setFont("helvetica", "normal").setFontSize(10);
  y += 16; doc.text(cust.store_name ?? "—", 40, y);
  y += 14; doc.text(`NIF: ${cust.nif ?? "—"}`, 40, y);
  y += 14; doc.text(`Telefone: ${cust.phone ?? "—"}`, 40, y);

  let yr = 130;
  doc.setFont("helvetica", "bold").setFontSize(11).text("Documento", W - 40, yr, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10);
  yr += 16; doc.text(`Emitida em: ${date(inv.issued_at)}`, W - 40, yr, { align: "right" });
  yr += 14; doc.text(`Estado: ${inv.status === "paid" ? "Paga" : inv.status}`, W - 40, yr, { align: "right" });
  yr += 14; doc.text(`Referência: ${inv.reference ?? "—"}`, W - 40, yr, { align: "right" });
  yr += 14; doc.text(`Método: ${inv.payment_method ?? "—"}`, W - 40, yr, { align: "right" });

  y = Math.max(y, yr) + 40;
  doc.setFillColor(240, 253, 244);
  doc.rect(40, y, W - 80, 26, "F");
  doc.setFont("helvetica", "bold").setFontSize(10);
  doc.text("Descrição", 52, y + 17);
  doc.text("Período", W / 2 + 20, y + 17);
  doc.text("Valor", W - 52, y + 17, { align: "right" });

  y += 46;
  doc.setFont("helvetica", "normal");
  doc.text(`Subscrição — Plano ${inv.plan_name}`, 52, y);
  doc.text(`${date(inv.period_start)} a ${date(inv.period_end)}`, W / 2 + 20, y);
  doc.text(money(inv.amount_aoa), W - 52, y, { align: "right" });

  y += 24;
  doc.setDrawColor(220);
  doc.line(40, y, W - 40, y);

  y += 26;
  doc.setFont("helvetica", "bold").setFontSize(12);
  doc.text("Total", W - 160, y);
  doc.text(money(inv.amount_aoa), W - 52, y, { align: "right" });

  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
  doc.text(
    "Documento gerado eletronicamente pela plataforma Live Teká. Valores expressos em Kwanzas (AOA).",
    40,
    doc.internal.pageSize.getHeight() - 40,
  );

  doc.save(`${inv.number.replace(/\//g, "-")}.pdf`);
}