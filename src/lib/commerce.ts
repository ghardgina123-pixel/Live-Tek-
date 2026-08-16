/** Rótulos e regras comerciais partilhadas (fonte de verdade continua no backend). */

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending: "Aguardando pagamento",
  paid: "Pago",
  preparing: "Em preparação",
  shipped: "Enviado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export const GATEWAY_PENDING_MESSAGE =
  "Pagamento aguardando configuração do método de pagamento.";

export const formatAoa = (v: number) =>
  `${Math.round(Number(v) || 0).toLocaleString("pt-AO")} Kz`;
