import { useCallback, useEffect, useState } from "react";
import { Loader2, Banknote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Summary = {
  available_aoa: number;
  pending_aoa: number;
  reserved_aoa: number;
  sales_aoa: number;
  commissions_aoa: number;
  withdrawn_aoa: number;
  min_withdrawal_aoa: number;
};
type Entry = { id: string; kind: string; net_aoa: number; delta_available: number; delta_pending: number; delta_reserved: number; created_at: string; order_id: string | null };
type Withdrawal = { id: string; amount_aoa: number; status: string; created_at: string; bank_reference: string | null; rejection_reason: string | null };

const kz = (n: number) => `Kz ${Number(n || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = {
  sale_credit: "Venda (pendente)",
  release: "Venda libertada",
  withdrawal_reserve: "Levantamento reservado",
  withdrawal_release: "Levantamento rejeitado (devolvido)",
  withdrawal_paid: "Levantamento pago",
  adjustment: "Ajuste",
  reversal: "Estorno",
};
const WSTATUS: Record<string, string> = {
  PENDING_REVIEW: "Em análise",
  APPROVED: "Aprovado",
  PROCESSING: "Em transferência",
  PAID: "Pago",
  REJECTED: "Rejeitado",
};

export function StoreLedgerWallet({ storeId }: { storeId: string }) {
  const [s, setS] = useState<Summary | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [wds, setWds] = useState<Withdrawal[]>([]);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.rpc("store_ledger_summary", { _store_id: storeId }),
      supabase.from("ledger_entries").select("id,kind,net_aoa,delta_available,delta_pending,delta_reserved,created_at,order_id").eq("store_id", storeId).order("created_at", { ascending: false }).limit(50),
      supabase.from("store_withdrawals").select("id,amount_aoa,status,created_at,bank_reference,rejection_reason").eq("store_id", storeId).order("created_at", { ascending: false }).limit(20),
    ]);
    if (a.error) return toast.error("Não foi possível carregar a carteira.");
    setS(a.data as unknown as Summary);
    setEntries((b.data ?? []) as Entry[]);
    setWds((c.data ?? []) as Withdrawal[]);
  }, [storeId]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    const v = Number(amount.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) return toast.error("Indique um valor válido.");
    setBusy(true);
    const { data, error } = await supabase.rpc("request_store_withdrawal", { _store_id: storeId, _amount: v });
    setBusy(false);
    if (error) return toast.error("Pedido não aceite.");
    const r = data as { ok: boolean; reason?: string };
    if (!r.ok) {
      toast.error(
        r.reason === "below_minimum" ? `Mínimo de ${kz(s?.min_withdrawal_aoa ?? 50000)}.` : r.reason === "insufficient_balance" ? "Saldo disponível insuficiente." : r.reason === "open_request" ? "Já existe um levantamento em curso." : "Pedido não aceite.",
      );
    } else {
      toast.success("Levantamento pedido. Aguarda aprovação manual.");
      setAmount("");
    }
    void load();
  };

  if (!s) return <div className="flex justify-center rounded-2xl border border-border py-6"><Loader2 className="animate-spin text-primary" size={18} /></div>;

  const stats: [string, number][] = [
    ["Disponível", s.available_aoa],
    ["Pendente", s.pending_aoa],
    ["Reservado", s.reserved_aoa],
    ["Total de vendas", s.sales_aoa],
    ["Comissões", s.commissions_aoa],
    ["Total levantado", s.withdrawn_aoa],
  ];
  const open = wds.some((w) => ["PENDING_REVIEW", "APPROVED", "PROCESSING"].includes(w.status));

  return (
    <div className="space-y-3 rounded-2xl border border-border p-4">
      <h3 className="text-sm font-bold">Carteira do lojista</h3>
      <div className="grid grid-cols-3 gap-2">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-xl border border-border p-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
            <p className="text-xs font-bold">{kz(v)}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input inputMode="decimal" placeholder="Valor (Kz)" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={open || busy} />
        <Button onClick={request} disabled={open || busy} className="gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Banknote size={16} />}
          Solicitar Levantamento
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">Mínimo {kz(s.min_withdrawal_aoa)}. Cada pedido é revisto e transferido manualmente pela equipa financeira.</p>

      {wds.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold">Levantamentos</p>
          <ul className="space-y-1 text-xs">
            {wds.map((w) => (
              <li key={w.id} className="flex justify-between rounded-lg border border-border px-2 py-1">
                <span>{new Date(w.created_at).toLocaleDateString("pt-AO")} · {WSTATUS[w.status] ?? w.status}{w.bank_reference ? ` · Ref ${w.bank_reference}` : ""}{w.rejection_reason ? ` · ${w.rejection_reason}` : ""}</span>
                <strong>{kz(w.amount_aoa)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <p className="mb-1 text-xs font-semibold">Extrato</p>
        {entries.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">Ainda sem movimentos.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
            {entries.map((e) => (
              <li key={e.id} className="flex justify-between rounded-lg border border-border px-2 py-1">
                <span>{new Date(e.created_at).toLocaleString("pt-AO")} · {KIND[e.kind] ?? e.kind}{e.order_id ? ` #${e.order_id.slice(0, 8)}` : ""}</span>
                <strong>{kz(e.net_aoa)}</strong>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
