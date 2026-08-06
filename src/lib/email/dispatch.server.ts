import * as React from "react";
import { render } from "@react-email/render";
import { TEMPLATES } from "@/lib/email-templates/registry";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SITE_NAME = "Live Teká";
const SENDER_DOMAIN = "notify.livemarketplece.live";
const FROM_DOMAIN = "livemarketplece.live";

function generateToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type InternalEmailResult =
  | { sent: true }
  | { sent: false; reason: "duplicate" | "suppressed" | "no_recipient" | "unknown_template" | "error" };

/**
 * Envio interno (service role) de e-mails transacionais — usado por webhooks e
 * tarefas agendadas que não têm sessão de utilizador. Idempotente: o mesmo
 * `idempotencyKey` nunca é enfileirado duas vezes.
 */
export async function sendInternalEmail(params: {
  templateName: string;
  recipientEmail?: string | null;
  templateData?: Record<string, unknown>;
  idempotencyKey: string;
}): Promise<InternalEmailResult> {
  const { templateName, idempotencyKey } = params;
  const template = TEMPLATES[templateName];
  if (!template) return { sent: false, reason: "unknown_template" };

  const recipient = template.to || params.recipientEmail;
  if (!recipient) return { sent: false, reason: "no_recipient" };
  const normalized = recipient.toLowerCase();

  // Idempotência: já existe um envio registado com esta chave?
  const { data: existingLog } = await supabaseAdmin
    .from("email_send_log")
    .select("id")
    .eq("template_name", templateName)
    .contains("metadata", { idempotency_key: idempotencyKey })
    .maybeSingle();
  if (existingLog) return { sent: false, reason: "duplicate" };

  const { data: suppressed, error: supErr } = await supabaseAdmin
    .from("suppressed_emails")
    .select("id")
    .eq("email", normalized)
    .maybeSingle();
  if (supErr) return { sent: false, reason: "error" };
  if (suppressed) return { sent: false, reason: "suppressed" };

  // Token de cancelamento de subscrição de e-mails (um por endereço)
  let unsubscribeToken: string;
  const { data: existingToken } = await supabaseAdmin
    .from("email_unsubscribe_tokens")
    .select("token, used_at")
    .eq("email", normalized)
    .maybeSingle();
  if (existingToken?.token && !existingToken.used_at) {
    unsubscribeToken = existingToken.token;
  } else if (!existingToken) {
    unsubscribeToken = generateToken();
    await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .upsert({ token: unsubscribeToken, email: normalized }, { onConflict: "email", ignoreDuplicates: true });
    const { data: stored } = await supabaseAdmin
      .from("email_unsubscribe_tokens")
      .select("token")
      .eq("email", normalized)
      .maybeSingle();
    if (!stored?.token) return { sent: false, reason: "error" };
    unsubscribeToken = stored.token;
  } else {
    return { sent: false, reason: "suppressed" };
  }

  const messageId = crypto.randomUUID();
  const element = React.createElement(template.component, params.templateData ?? {});
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const subject =
    typeof template.subject === "function" ? template.subject(params.templateData ?? {}) : template.subject;

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: templateName,
    recipient_email: recipient,
    status: "pending",
    metadata: { idempotency_key: idempotencyKey },
  });

  const { error: enqueueError } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "transactional_emails",
    payload: {
      message_id: messageId,
      to: recipient,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject,
      html,
      text,
      purpose: "transactional",
      label: templateName,
      idempotency_key: idempotencyKey,
      unsubscribe_token: unsubscribeToken,
      queued_at: new Date().toISOString(),
    } as never,
  });

  if (enqueueError) {
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: templateName,
      recipient_email: recipient,
      status: "failed",
      error_message: "Failed to enqueue email",
      metadata: { idempotency_key: idempotencyKey },
    });
    return { sent: false, reason: "error" };
  }

  return { sent: true };
}
