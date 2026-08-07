import type { Dict } from "../keys";
import { ptPT } from "./pt-PT";

export const ptAO: Dict = {
  ...ptPT,
  password: "Senha", forgot_password: "Esqueci a senha", show_password: "Mostrar senha", hide_password: "Ocultar senha",
  v_password_min: "A senha deve ter pelo menos 6 caracteres",
  logout: "Sair", save: "Salvar", delete: "Apagar", my_orders: "Os meus pedidos", track_order: "Rastrear pedido",
  order_placed: "Pedido criado com sucesso", place_order: "Confirmar pedido", viewers: "Espectadores", likes: "Curtidas",
  settings: "Configurações", stock: "Estoque",
};
