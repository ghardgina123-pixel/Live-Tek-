export type WithdrawalResult = { ok: boolean; reason?: string; status?: string; minAmount?: number };

export function withdrawalResult(value: unknown): WithdrawalResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "invalid_response" };
  const record = value as Record<string, unknown>;
  return {
    ok: record["ok"] === true,
    ...(typeof record["reason"] === "string" ? { reason: record["reason"] } : {}),
    ...(typeof record["status"] === "string" ? { status: record["status"] } : {}),
    ...(typeof record["min_amount_aoa"] === "number" ? { minAmount: record["min_amount_aoa"] } : {}),
  };
}

export const withdrawalStatusLabel = (status: string) => ({
  pending: "Pendente de análise", PENDING_REVIEW: "Pendente de análise",
  approved: "Aprovado", APPROVED: "Aprovado",
  processing: "Em processamento", PROCESSING: "Em processamento",
  rejected: "Rejeitado", REJECTED: "Rejeitado",
  paid: "Pago", PAID: "Pago", cancelled: "Cancelado",
})[status] ?? status;

export function maskedBankAccount(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "Não registado";
  const normalized = value.replace(/\s/g, "");
  return normalized.length > 4 ? `•••• ${normalized.slice(-4)}` : "••••";
}

export function withdrawalFailure(reason?: string, minimum?: number): string {
  if (reason === "below_minimum_limit") return minimum
    ? `O mínimo por levantamento é ${minimum.toLocaleString("pt-AO")} AOA.`
    : "O valor é inferior ao mínimo de levantamento.";
  const reasons: Record<string, string> = {
    bank_account_required: "Registe o titular, o banco e o IBAN ou número de conta antes de pedir o levantamento.",
    bank_account_invalid: "O IBAN ou número de conta não é válido. Corrija a conta bancária registada.",
    bank_holder_mismatch: "O titular da conta bancária não corresponde ao beneficiário registado.",
    identity_required: "Complete a sua identificação pessoal no Perfil antes de pedir o levantamento.",
    beneficiary_not_eligible: "A sua conta não está habilitada para este tipo de levantamento.",
    insufficient_balance: "Saldo disponível insuficiente.",
    open_request: "Já existe um levantamento em análise ou processamento.",
    daily_limit: "O pedido excede o limite disponível para hoje.",
    bank_confirmation_required: "O pagamento exige confirmação bancária autenticada; a aprovação não realiza uma transferência.",
    invalid_transition: "O estado deste pedido já não permite essa operação. Atualize a lista.",
    reason_required: "Indique o motivo da rejeição.",
    self_approval_forbidden: "Não pode aprovar levantamentos de que é beneficiário.",
    not_found: "O pedido não foi encontrado.",
    invalid_amount: "Indique um valor válido.",
  };
  return reasons[reason ?? ""] ?? "Operação recusada. O pedido não foi alterado.";
}

export function canRequestWithdrawal(available: number, remaining: number, minimum: number, hasOpen: boolean): boolean {
  return !hasOpen && Number.isFinite(minimum) && minimum > 0 && Math.min(available, remaining) >= minimum;
}