import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Read-only integration. Mutations remain disabled until reviewed SQL is approved. */
export const getManagementOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: allowed, error: permissionError } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
    if (permissionError || !allowed) throw new Error("Acesso reservado ao administrador.");

    const [limits, audit, admins] = await Promise.all([
      supabase.from("withdrawal_limits").select("currency,min_amount,max_daily_amount,timezone,updated_at").order("currency"),
      supabase.from("financial_audit_log").select("id,actor_id,action,resource_id,previous_state,new_state,created_at,result")
        .eq("resource", "withdrawal_limits").order("created_at", { ascending: false }).limit(100),
      supabase.from("user_roles").select("user_id,role,created_at").eq("role", "admin").order("created_at"),
    ]);
    for (const response of [limits, audit, admins]) {
      if (response.error) throw new Error("Não foi possível consultar os registos. Tente novamente.");
    }
    const ids = [...new Set((admins.data ?? []).map((row) => row.user_id))];
    const profiles = ids.length
      ? await supabase.from("profiles").select("id,display_name").in("id", ids)
      : { data: [], error: null };
    if (profiles.error) throw new Error("Não foi possível consultar os membros.");
    return {
      limits: limits.data ?? [],
      history: audit.data ?? [],
      administrators: (admins.data ?? []).map((row) => ({
        ...row, name: profiles.data?.find((profile) => profile.id === row.user_id)?.display_name ?? null,
      })),
      currentUserId: userId,
    };
  });