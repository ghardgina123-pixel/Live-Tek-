export const SERVICE_CATEGORIES = [
  { value: "salao", label: "Salão de beleza", emoji: "💇" },
  { value: "barbearia", label: "Barbearia", emoji: "💈" },
  { value: "hotel", label: "Hotel / Alojamento", emoji: "🏨" },
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
  { value: "limpeza", label: "Limpeza & Doméstico", emoji: "🧹" },
  { value: "construcao", label: "Construção & Reparações", emoji: "🧱" },
  { value: "outros", label: "Outros serviços", emoji: "🛠️" },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]["value"];

export function serviceCategoryLabel(value: string | null | undefined) {
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.label ?? "Serviço";
}

export function serviceCategoryEmoji(value: string | null | undefined) {
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.emoji ?? "🛠️";
}
