import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "fiscal-documents";
const SIGNED_TTL = 300; // 5 minutos

const idInput = z.object({ invoiceId: z.string().uuid() });

/**
 * Devolve uma URL ASSINADA temporária para o PDF da factura.
 * - O acesso é validado pelas políticas RLS de `invoices` (cliente/lojista/gestor).
 * - O PDF é gerado a partir dos snapshots fiscais da factura e guardado uma
 *   única vez no bucket PRIVADO; `pdf_path` guarda apenas o caminho.
 * - Nenhuma URL assinada é gravada na base de dados.
 */
export const getInvoicePdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => idInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // RLS: só devolve a factura se o utilizador tiver mesmo acesso.
    const { data: inv, error } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", data.invoiceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Factura não encontrada ou sem permissão.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let path = inv.pdf_path as string | null;

    if (!path) {
      const { data: items } = await supabase
        .from("invoice_items")
        .select("description, quantity, unit_price_aoa, total_aoa")
        .eq("invoice_id", inv.id);

      const { buildFiscalInvoicePdf } = await import("./fiscal-pdf");
      const bytes = buildFiscalInvoicePdf({
        full_number: inv.full_number,
        series: inv.series,
        number: inv.number,
        doc_kind: inv.doc_kind,
        issuer_kind: inv.issuer_kind,
        issued_at: inv.issued_at,
        currency_code: inv.currency_code,
        subtotal_aoa: Number(inv.subtotal_aoa),
        tax_aoa: Number(inv.tax_aoa),
        total_aoa: Number(inv.total_aoa),
        payment_method: inv.payment_method,
        reference: inv.reference,
        period_start: inv.period_start,
        period_end: inv.period_end,
        status: inv.status,
        issuer_snapshot: (inv.issuer_snapshot ?? null) as never,
        customer_snapshot: (inv.customer_snapshot ?? null) as never,
        items: (items ?? []).map((i) => ({
          description: i.description,
          quantity: Number(i.quantity),
          unit_price_aoa: Number(i.unit_price_aoa),
          total_aoa: Number(i.total_aoa),
        })),
      });

      path = `${inv.issuer_kind}/${inv.id}/${inv.full_number.replace(/[^\w.-]/g, "-")}.pdf`;

      const { error: upErr } = await supabaseAdmin.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      // Se já existir (corrida), reutilizamos o ficheiro existente — nunca substituímos.
      if (upErr && !/exists/i.test(upErr.message)) throw new Error(upErr.message);

      // O trigger `guard_invoice_fiscal_immutable` impede substituição posterior.
      const { error: updErr } = await supabaseAdmin
        .from("invoices")
        .update({ pdf_path: path, pdf_generated_at: new Date().toISOString() })
        .eq("id", inv.id)
        .is("pdf_path", null);
      if (updErr) throw new Error(updErr.message);

      const { data: fresh } = await supabaseAdmin
        .from("invoices")
        .select("pdf_path")
        .eq("id", inv.id)
        .maybeSingle();
      path = (fresh?.pdf_path as string | null) ?? path;
    }

    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_TTL);
    if (signErr || !signed?.signedUrl) throw new Error(signErr?.message ?? "Falha ao assinar URL.");

    return { url: signed.signedUrl, expiresIn: SIGNED_TTL, fileName: `${inv.full_number}.pdf` };
  });
