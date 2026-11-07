import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

/**
 * Global realtime listener:
 * - Toasts on new messages (in any conversation the user participates in).
 * - Toasts on new orders for stores the user owns.
 * RLS guarantees the user only receives events for rows they can see.
 */
const announcedPaid = new Set<string>();

export function RealtimeNotifier() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) return;

    const channel = supabase
      .channel(`notify-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as { sender_id: string; text: string; conversation_id: string };
          if (m.sender_id === user.id) return;
          toast.message("Nova mensagem 💬", {
            description: m.text.length > 80 ? m.text.slice(0, 80) + "…" : m.text,
            action: { label: "Abrir", onClick: () => navigate({ to: "/chat", search: { c: m.conversation_id } as never }) },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (payload) => {
          const o = payload.new as { customer_id: string; total_aoa: number };
          if (o.customer_id === user.id) return; // only notify the seller side
          toast.success("Novo pedido recebido 🛒", {
            description: `Kz ${Number(o.total_aoa).toLocaleString("pt-AO")}`,
            action: { label: "Ver", onClick: () => navigate({ to: "/lojista/pedidos" }) },
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (payload) => {
          const o = payload.new as { id: string; customer_id: string; total_aoa: number; status: string };
          if (o.status !== "paid" || announcedPaid.has(o.id)) return;
          announcedPaid.add(o.id);
          const amount = `Kz ${Number(o.total_aoa).toLocaleString("pt-AO")}`;
          if (o.customer_id === user.id) {
            toast.success("Pagamento foi aceite ✅", {
              description: `Valor pago: ${amount}`,
              action: { label: "Ver compra", onClick: () => navigate({ to: "/compras" }) },
            });
          } else {
            // Lojista (pedido da sua loja) ou gestão — RLS só entrega pedidos visíveis.
            toast.success("O cliente efetuou o pagamento com sucesso 💰", {
              description: `Valor exato: ${amount} · Pedido #${o.id.slice(0, 8)}`,
              duration: 10000,
              action: { label: "Ver", onClick: () => navigate({ to: "/lojista/pedidos" }) },
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, navigate]);

  return null;
}