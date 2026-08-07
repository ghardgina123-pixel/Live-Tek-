export const SERVICE_CATEGORIES = [
  { value: "salao", label: "Salão de beleza", emoji: "💇" },
  { value: "barbearia", label: "Barbearia", emoji: "💈" },
  { value: "lavandaria", label: "Lavandaria", emoji: "🧺" },
  { value: "costureiro", label: "Costureiro / Alfaiate", emoji: "🧵" },
  { value: "hotel", label: "Hotel / Alojamento", emoji: "🏨" },
  { value: "hospedaria", label: "Hospedaria / Pensão", emoji: "🛏️" },
  { value: "restaurante", label: "Restaurante", emoji: "🍽️" },
  { value: "lanchonete", label: "Lanchonete", emoji: "🍔" },
  { value: "bar", label: "Bar / Lounge", emoji: "🍹" },
  { value: "cozinha", label: "Cozinha / Catering", emoji: "👩‍🍳" },
  { value: "escola", label: "Escola / Formação", emoji: "🎓" },
  { value: "hospital", label: "Clínica / Hospital", emoji: "🏥" },
  { value: "farmacia", label: "Farmácia", emoji: "💊" },
  { value: "oficina", label: "Oficina / Mecânica", emoji: "🔧" },
  { value: "transporte", label: "Transporte", emoji: "🚐" },
  { value: "eventos", label: "Eventos & Fotografia", emoji: "🎉" },
  { value: "fotografo", label: "Fotógrafo", emoji: "📸" },
  { value: "ginasio", label: "Ginásio", emoji: "🏋️" },
  { value: "limpeza", label: "Limpeza & Doméstico", emoji: "🧹" },
  { value: "construcao", label: "Construção & Reparações", emoji: "🧱" },
  { value: "imobiliaria", label: "Imobiliária", emoji: "🏘️" },
  { value: "turismo", label: "Turismo & Viagens", emoji: "🧳" },
  { value: "outros", label: "Outros serviços", emoji: "🛠️" },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]["value"];

export function serviceCategoryLabel(value: string | null | undefined) {
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.label ?? "Serviço";
}

export function serviceCategoryEmoji(value: string | null | undefined) {
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.emoji ?? "🛠️";
}

/**
 * Plano recomendado para uma categoria de serviço. As categorias vivem na
 * base de dados (`subscription_plans.categories`), por isso a recomendação é
 * sempre calculada a partir dos planos carregados — nunca de valores fixos.
 */
export function recommendedPlanCode(
  plans: Array<{ code: string; categories?: string[] | null; sort_order?: number }>,
  serviceCategory: string | null | undefined,
): string | null {
  if (!serviceCategory) return null;
  const match = plans.find((p) => (p.categories ?? []).includes(serviceCategory));
  return match?.code ?? null;
}
