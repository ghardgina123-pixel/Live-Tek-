import { supabase } from "@/integrations/supabase/client";

/**
 * Abre (ou cria) a conversa entre o cliente autenticado e uma loja concreta.
 * Devolve o id da conversa para navegar até /chat?c=<id>.
 */
export async function openStoreConversation(storeId: string, userId: string): Promise<string> {
  const { data: existing, error: findErr } = await supabase
    .from("conversations")
    .select("id")
    .eq("store_id", storeId)
    .eq("customer_id", userId)
    .maybeSingle();
  if (findErr) throw findErr;
  if (existing?.id) return existing.id as string;

  const { data, error } = await supabase
    .from("conversations")
    .insert({ store_id: storeId, customer_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}
