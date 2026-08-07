import { useCallback, useEffect, useState } from "react";
import { Wallet, Loader2, Clock, BanknoteArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const PAYOUT_MIN_AOA = 50000;
export const PAYOUT_SLA_HOURS = 72;

type OpenRequest = { id: string; amount_aoa: number; status: string; due_at: string; created_at: string };
type State = {
  available_aoa: number;
  min_aoa: number;
  has_open_request: boolean;
  open_request: OpenRequest | null;
  earned_aoa?: number;
  withdrawn_aoa?: number;
  deliveries_done?: number;
};

const kz = (v: number) =>
  "Kz " + Number(v || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const STATUS_LABEL: Record<string, string> = {
  pending: "Em fila de processamento",
  processing: "A processar",
  paid: "Pago",
  cancelled: "Cancelado",
};

export function PayoutWallet({ kind, subtitle }: { kind: "affiliate" | "courier"; subtitle?: string }) {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const rpcName = kind === "affiliate" ? "affiliate_withdrawable" : "courier_withdrawable";

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc(rpcName as never);
    if (error) { toast.error("Não foi possível carregar a carteira."); setLoading(false); return; }
    setState(data as unknown as State);
    setLoading(false);
  }, [rpcName]);

  useEffect(() => { void load(); }, [load]);

  const request = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("request_payout" as never, { _kind: kind } as never);
    setBusy(false);
    if (error) { toast.error("Não foi possível registar o pedido."); return; }
    const res = data as unknown as { ok: boolean; reason?: string; due_at?: string };
    if (!res?.ok) {
      if (res?.reason === "below_minimum") toast.error(`Saldo mínimo de ${kz(PAYOUT_MIN_AOA)} não atingido.`);
      else if (res?.reason === "open_request") toast.error("Já existe um pedido em processamento.");
      else toast.error("Pedido não aceite.");
      await load();
      return;
    }
    toast.success(`Saque pedido! Processamento em até ${PAYOUT_SLA_HOURS} horas.`);
    await load();
  };

  if (loading) {
    return (
      <section className="mt-4 flex items-center justify-center rounded-2xl border border-border p-6 text-muted-foreground">
        <Loader2 className="animate-spin" size={18} />
      </section>
    );
  }

  const available = state?.available_aoa ?? 0;
  const min = state?.min_aoa ?? PAYOUT_MIN_AOA;
  const open = state?.open_request ?? null;
  const canRequest = !state?.has_open_request && available >= min;
  const progress = Math.min(100, Math.round((available / min) * 100));

  return (
    <section className="mt-4 rounded-2xl border border-border p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Wallet size={16} />
        <span className="text-[11px] uppercase tracking-wide">Carteira · saldo disponível</span>
      </div>
      <p className="mt-1 text-2xl font-bold">{kz(available)}</p>
      {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}

      {kind === "courier" && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          {state?.deliveries_done ?? 0} entregas concluídas · {kz(state?.earned_aoa ?? 0)} ganhos totais · {kz(state?.withdrawn_aoa ?? 0)} levantados
        </p>
      )}

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-accent">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        {available >= min
          ? `Mínimo de ${kz(min)} atingido — saque disponível.`
          : `Faltam ${kz(min - available)} para atingir o mínimo de ${kz(min)}.`}
      </p>

      {open ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <Clock size={16} className="mt-0.5 text-primary" />
          <div className="text-xs">
            <p className="font-semibold">{kz(open.amount_aoa)} · {STATUS_LABEL[open.status] ?? open.status}</p>
            <p className="text-muted-foreground">
              Processamento até {new Date(open.due_at).toLocaleString("pt-AO")} ({PAYOUT_SLA_HOURS}h).
            </p>
          </div>
        </div>
      ) : (
        <Button onClick={request} disabled={!canRequest || busy} className="mt-3 w-full gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <BanknoteArrowDown size={16} />}
          {available >= min ? `Sacar ${kz(available)}` : `Saque a partir de ${kz(min)}`}
        </Button>
      )}

      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        O levantamento é autónomo: pede diretamente aqui, sem aprovação manual. O valor é processado num prazo
        máximo de {PAYOUT_SLA_HOURS} horas após o pedido.
      </p>
    </section>
  );
}
