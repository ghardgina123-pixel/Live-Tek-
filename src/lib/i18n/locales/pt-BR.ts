import type { Dict } from "../keys";
import { ptPT } from "./pt-PT";

export const ptBR: Dict = {
  ...ptPT,
  password: "Senha", forgot_password: "Esqueci a senha", show_password: "Mostrar senha", hide_password: "Ocultar senha",
  v_password_min: "A senha deve ter no mínimo 6 caracteres", v_email_invalid: "E-mail inválido",
  logout: "Sair", save: "Salvar", delete: "Excluir", close: "Fechar", share: "Compartilhar",
  my_orders: "Meus pedidos", track_order: "Rastrear pedido", place_order: "Finalizar pedido",
  order_placed: "Pedido criado com sucesso", settings: "Configurações", stock: "Estoque",
  viewers: "Espectadores", likes: "Curtidas", welcome_back: "Bem-vindo de volta",
  region_hint: "Ao escolher o país, a moeda, as formas de pagamento e os mapas se ajustam automaticamente.",
  search_placeholder: "Buscar lojas, produtos…", search: "Buscar", seller_panel: "Painel do lojista",
  cart_empty: "Seu carrinho está vazio", nav_shorts: "Shorts",
  province: "Estado", municipality: "Cidade / Município", district: "Bairro", select_country_first: "Selecione primeiro o país", select_province_first: "Selecione primeiro o estado", select_municipality_first: "Selecione primeiro a cidade",
  admin_panel: "Painel do administrador", courier_panel: "Quero entregar / cadastrar transporte", realestate_panel: "Imobiliária / cadastrar imóvel", following: "Seguindo", login_to_continue: "Faça login para continuar", country_default_hint: "Define o país padrão para entregas, lojas e imóveis.",
};
