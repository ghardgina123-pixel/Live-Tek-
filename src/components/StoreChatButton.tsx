import { useNavigate } from "@tanstack/react-router";
import { Loader2, MessageCircle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { openStoreConversation } from "@/lib/chat";

type Props = {
  storeId: string;
  className?: string;
  /** Mostra o texto "Conversar" ao lado do ícone. */
  withLabel?: boolean;
  size?: number;
};

/** Abre a conversa específica com a loja indicada (cria se ainda não existir). */
export function StoreChatButton({ storeId, className, withLabel = false, size = 20 }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (!user) {
      toast.error("Faça login para conversar com a loja.");
      void nav({ to: "/login" });
      return;
    }
    setBusy(true);
    try {
      const id = await openStoreConversation(storeId, user.id);
      await nav({ to: "/chat", search: { c: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Não foi possível abrir a conversa.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={open} disabled={busy} aria-label="Conversar com a loja" className={className}>
      {busy ? <Loader2 size={size} className="animate-spin" /> : <MessageCircle size={size} />}
      {withLabel && <span>Conversar</span>}
    </button>
  );
}
