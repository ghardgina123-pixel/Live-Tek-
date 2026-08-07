import { useCallback, useEffect, useState } from "react";
import { Loader2, Store as StoreIcon, Wrench, Wallet, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type PartnerType = "retail" | "service";
type Balance = {
  partner_type: PartnerType;
  commission_pct: number;
  pending_clearance_aoa: number;
  available_aoa: number;
  platform_fees_aoa: number;
};

const kz = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { maximumFractionDigits: 2 })}`;

export function PartnerSettlementCard({ storeId }: { storeId: string }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("store_balance", { _store_id: storeId });
    if (error) {
      toast.error(error.message);
      return;
    }
    setBalance(data as unknown as Balance);
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  const setType = async (type: PartnerType) => {
    if (saving || balance?.partner_type === type) return;
    setSaving(true);
    const { error } = await supabase.rpc("set_store_partner_type", { _store_id: storeId, _type: type });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(type === "service" ? "Parceria de Serviços — sem comissão." : "Parceria de Retalho — comissão de 5%.");
    load();
  };

  if (!balance) {
    return (
      <div className="flex justify-center rounded-2xl border border-border py-6">
        <Loader2 className="animate-spin text-primary" size={18} />
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <div>
        <h3 className="text-sm font-bold">Tipo de parceria</h3>
        <p className="text-[11px] text-muted-foreground">
          Retalho: pagamento dividido automaticamente após a entrega. Serviços: sem comissão.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([
          { key: "retail" as const, label: "Retalho", desc: "Comissão 5%", icon: StoreIcon },
          { key: "service" as const, label: "Serviços", desc: "Sem comissão", icon: Wrench },
        ]).map(({ key, label, desc, icon: Icon }) => {
          const active = balance.partner_type === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setType(key)}
              disabled={saving}
              aria-pressed={active}
              className={`rounded-xl border p-3 text-left transition ${
                active ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              } disabled:opacity-60`}
            >
              <Icon size={16} className="text-primary" />
              <p className="mt-1 text-xs font-bold">{label}</p>
              <p className="text-[10px] text-muted-foreground">{desc}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border p-3">
          <Clock size={14} className="text-primary" />
          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Em compensação</p>
          <p className="text-sm font-bold">{kz(balance.pending_clearance_aoa)}</p>
        </div>
        <div className="rounded-xl border border-border p-3">
          <Wallet size={14} className="text-primary" />
          <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">Disponível</p>
          <p className="text-sm font-bold">{kz(balance.available_aoa)}</p>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Comissão aplicada: <strong className="text-foreground">{Number(balance.commission_pct)}%</strong> · Taxas da
        plataforma acumuladas: <strong className="text-foreground">{kz(balance.platform_fees_aoa)}</strong>
      </p>
    </div>
  );
}
