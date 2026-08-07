import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type SubscriptionStatus = {
  partner_type: "retail" | "service";
  service_category: string | null;
  subscription_required: boolean;
  subscription_status: "active" | "grace" | "suspended" | "inactive";
  plan_code: string | null;
  plan_name: string | null;
  price_aoa: number | null;
  started_at: string | null;
  expires_at: string | null;
  grace_until: string | null;
  days_remaining: number | null;
  max_lives_per_month: number | null;
  can_go_live: boolean;
};

export type LiveUsage = {
  plan_code: string | null;
  used: number;
  limit: number | null;
  unlimited: boolean;
  remaining: number | null;
};

/** Estado real da subscrição da loja (usado para bloquear lives). */
export function useSubscriptionStatus(storeId?: string) {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [usage, setUsage] = useState<LiveUsage | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const [{ data, error }, { data: usageData }] = await Promise.all([
      supabase.rpc("store_subscription_status", { _store_id: storeId }),
      supabase.rpc("store_live_usage", { _store_id: storeId }),
    ]);
    setLoading(false);
    setUsage((usageData as unknown as LiveUsage) ?? null);
    if (error) return;
    setStatus(data as unknown as SubscriptionStatus);
  }, [storeId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    if (!storeId) return;
    const ch = supabase
      .channel(`store-subs-${storeId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "store_subscriptions", filter: `store_id=eq.${storeId}` },
        () => reload(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "lives", filter: `store_id=eq.${storeId}` },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [storeId, reload]);

  return { status, usage, loading, reload };
}