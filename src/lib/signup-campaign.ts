/**
 * Estado oficial da campanha de adesão de lojas.
 * A única fonte de verdade é a função `seller_signup_status` no backend —
 * nenhum valor (vagas, taxa, posição) é fixado no frontend.
 */
export type SignupStatus = {
  campaign_active: boolean;
  free_slots_total: number;
  free_slots_used: number;
  slots_left: number;
  next_position: number;
  fee_required: boolean;
  fee_aoa: number;
  approved_count: number;
  my_store: {
    registration_position: number | null;
    signup_fee_aoa: number;
    signup_fee_status: "not_required" | "pending" | "paid" | "waived";
    status: string;
    review_state: string;
  } | null;
};

export const REVIEW_STATE_LABEL: Record<string, string> = {
  pending: "Aguardando análise",
  under_review: "Em análise",
  approved: "Aprovado",
  rejected: "Rejeitado",
  needs_correction: "Precisa de correção",
  suspended: "Suspenso",
};

export const FEE_STATUS_LABEL: Record<string, string> = {
  not_required: "Isento",
  pending: "Taxa por liquidar",
  paid: "Taxa confirmada",
  waived: "Taxa dispensada",
};

export const formatAoa = (v: number) => `${Math.round(v).toLocaleString("pt-AO")} Kz`;
