import type { Dict } from "../keys";
import { ptPT } from "./pt-PT";

export const ptAO: Dict = {
  ...ptPT,
  password: "Senha", forgot_password: "Esqueci a senha", show_password: "Mostrar senha", hide_password: "Ocultar senha",
  v_password_min: "A senha deve ter pelo menos 6 caracteres",
  logout: "Sair", save: "Salvar", delete: "Apagar", my_orders: "Os meus pedidos", track_order: "Rastrear pedido",
  order_placed: "Pedido criado com sucesso", place_order: "Confirmar pedido", viewers: "Espectadores", likes: "Curtidas",
  settings: "Configurações", stock: "Estoque",
  province: "Província", municipality: "Município", district: "Bairro", select_country_first: "Selecione primeiro o país", select_province_first: "Selecione primeiro a província", select_municipality_first: "Selecione primeiro o município",
  admin_panel: "Painel do administrador", courier_panel: "Quero entregar / cadastrar transporte", realestate_panel: "Imobiliária / registar imóvel", following: "A seguir", login_to_continue: "Faça login para continuar", country_default_hint: "Define o país padrão para entregas, lojas e imóveis.",
};
