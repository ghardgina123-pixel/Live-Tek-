import { useRegion } from "@/lib/region";

export type Lang = "pt" | "en" | "fr" | "es";

const DICT: Record<Lang, Record<string, string>> = {
  pt: {
    country: "País",
    language: "Idioma",
    currency: "Moeda",
    region_settings: "Definições regionais",
    region_hint: "Ao escolher o país, o idioma, a moeda, os métodos de pagamento e os mapas ajustam-se automaticamente.",
    province: "Província / Estado",
    municipality: "Município / Cidade",
    district: "Distrito / Bairro",
    select: "Selecione…",
    payment_methods: "Métodos de pagamento",
    no_payment_methods: "Nenhum método de pagamento disponível para",
    home: "Início",
    search: "Pesquisar",
    cart: "Carrinho",
    profile: "Perfil",
  },
  en: {
    country: "Country",
    language: "Language",
    currency: "Currency",
    region_settings: "Regional settings",
    region_hint: "Choosing a country automatically updates language, currency, payment methods and maps.",
    province: "State / Province",
    municipality: "City / Municipality",
    district: "District / Neighbourhood",
    select: "Select…",
    payment_methods: "Payment methods",
    no_payment_methods: "No payment method available for",
    home: "Home",
    search: "Search",
    cart: "Cart",
    profile: "Profile",
  },
  fr: {
    country: "Pays",
    language: "Langue",
    currency: "Devise",
    region_settings: "Paramètres régionaux",
    region_hint: "Le choix du pays met à jour la langue, la devise, les moyens de paiement et les cartes.",
    province: "Province / État",
    municipality: "Ville / Commune",
    district: "Quartier",
    select: "Sélectionner…",
    payment_methods: "Moyens de paiement",
    no_payment_methods: "Aucun moyen de paiement disponible pour",
    home: "Accueil",
    search: "Rechercher",
    cart: "Panier",
    profile: "Profil",
  },
  es: {
    country: "País",
    language: "Idioma",
    currency: "Moneda",
    region_settings: "Ajustes regionales",
    region_hint: "Al elegir el país se actualizan idioma, moneda, métodos de pago y mapas.",
    province: "Provincia / Estado",
    municipality: "Municipio / Ciudad",
    district: "Distrito / Barrio",
    select: "Seleccione…",
    payment_methods: "Métodos de pago",
    no_payment_methods: "Ningún método de pago disponible para",
    home: "Inicio",
    search: "Buscar",
    cart: "Carrito",
    profile: "Perfil",
  },
};

export const LANGUAGE_NAMES: Record<Lang, string> = {
  pt: "Português",
  en: "English",
  fr: "Français",
  es: "Español",
};

export function useT() {
  const region = useRegion();
  const lang = (DICT[region.language_code as Lang] ? region.language_code : "pt") as Lang;
  return {
    lang,
    t: (key: string) => DICT[lang][key] ?? DICT.pt[key] ?? key,
  };
}
