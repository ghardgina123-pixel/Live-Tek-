import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Store as StoreIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

/**
 * Ícone flutuante para acesso rápido à Área do Lojista.
 * Só aparece se o utilizador for dono de uma loja activa — evita duplicar
 * ações no cabeçalho e mantém o header limpo em telemóveis estreitos.
 */
export function LojistaShortcut() {
  const { user } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) { setShow(false); return; }
    let cancelled = false;
    supabase
      .from("stores")
      .select("id, status")
      .eq("owner_id", user.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => { if (!cancelled) setShow(Boolean(data)); });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (!show) return null;

  return (
    <Link
      to="/lojista"
      aria-label="Área do Lojista"
      className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background shadow-sm transition active:scale-95"
      style={{ touchAction: "manipulation" }}
    >
      <StoreIcon size={18} className="text-foreground" />
    </Link>
  );
}