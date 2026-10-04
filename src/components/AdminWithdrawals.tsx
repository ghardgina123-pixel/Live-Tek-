import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type W = {
  id: string;
  store_id: string;
  amount_aoa: number;
  status: string;
  created_at: string;
  bank_reference: string | null;
  rejection_reason: string | null;
  stores: { name: string } | null;
};
type Audit = {
  id: string;
  action: string;
  resource_id: string | null;
  previous_state: string | null;
  new_state: string | null;
  result: string;
  created_at: string;
};

const kz = (n: number) =>
  `Kz ${Number(n || 0).toLocaleString("pt-AO", { minimumFractionDigits: 2 })}`;

export function AdminWithdrawals() {
  const [rows, setRows] = useState<W[] | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [ref, setRef] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      supabase
        .from("store_withdrawals")
        .select(
          "id,store_id,amount_aoa,status,created_at,bank_reference,rejection_reason,stores(name)",
        )
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("financial_audit_log")
        .select("id,action,resource_id,previous_state,new_state,result,created_at")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    setRows((a.data ?? []) as unknown as W[]);
    setAudit((b.data ?? []) as Audit[]);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (w: W, action: "approve" | "process" | "pay" | "reject") => {
    const text = (ref[w.id] ?? "").trim();
    if (action === "pay" && !text)
      return toast.error("Indique a referência bancária da transferência.");
    if (action === "reject" && !text) return toast.error("Indique o motivo da rejeição.");
    setBusy(w.id);
    const { error } = await supabase.rpc("admin_withdrawal_action", {
      _id: w.id,
      _action: action,
      _bank_reference: action === "pay" ? text : undefined,
      _reason: action === "reject" ? text : undefined,
    });
    setBusy(null);
    if (error)
      toast.error(
        error.message.includes("self_approval")
          ? "Não pode aprovar levantamentos da sua própria loja."
          : "Operação recusada.",
      );
    else toast.success("Atualizado.");
    void load();
  };

  return (
    <section className="space-y-3 rounded-2xl border border-border p-4">
      <h2 className="text-sm font-bold">Levantamentos de lojistas</h2>
      {!rows ? (
        <Loader2 className="animate-spin" size={16} />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sem pedidos de levantamento.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((w) => {
            const open = !["PAID", "REJECTED"].includes(w.status);
            return (
              <li key={w.id} className="space-y-2 rounded-xl border border-border p-3 text-xs">
                <div className="flex justify-between">
                  <span>
                    {w.stores?.name ?? w.store_id.slice(0, 8)} ·{" "}
                    {new Date(w.created_at).toLocaleString("pt-AO")}
                  </span>
                  <strong>
                    {kz(w.amount_aoa)} · {w.status}
                  </strong>
                </div>
                {w.bank_reference && <p>Ref. bancária: {w.bank_reference}</p>}
                {w.rejection_reason && <p>Motivo: {w.rejection_reason}</p>}
                {open && (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="h-8 flex-1"
                      placeholder="Referência bancária / motivo"
                      value={ref[w.id] ?? ""}
                      onChange={(e) => setRef({ ...ref, [w.id]: e.target.value })}
                    />
                    {w.status === "PENDING_REVIEW" && (
                      <Button size="sm" disabled={busy === w.id} onClick={() => act(w, "approve")}>
                        Aprovar
                      </Button>
                    )}
                    {w.status === "APPROVED" && (
                      <Button size="sm" disabled={busy === w.id} onClick={() => act(w, "process")}>
                        Processar
                      </Button>
                    )}
                    {w.status === "PROCESSING" && (
                      <Button size="sm" disabled={busy === w.id} onClick={() => act(w, "pay")}>
                        Marcar PAID
                      </Button>
                    )}
                    {w.status !== "PROCESSING" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === w.id}
                        onClick={() => act(w, "reject")}
                      >
                        Rejeitar
                      </Button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-xs font-semibold">Auditoria financeira</summary>
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-[11px]">
          {audit.map((a) => (
            <li key={a.id}>
              {new Date(a.created_at).toLocaleString("pt-AO")} · {a.action} ·{" "}
              {a.previous_state ?? "—"} → {a.new_state ?? "—"} · {a.result}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
