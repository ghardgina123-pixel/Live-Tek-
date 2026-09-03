import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, Package, Truck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatAoa } from "@/lib/commerce";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/entregador/")({
  head: () => ({ meta: [{ title: "Painel do entregador — Live Teká" }, { name: "robots", content: "noindex" }] }),
  component: EntregadorIndex,
});

type Open = {
  delivery_id: string; order_id: string; status: string; shipping_aoa: number;
  store_name: string | null; municipality: string | null; created_at: string;
};
type Mine = Open & { order_status: string; street: string | null; assigned_at: string | null; delivered_at: string | null };

const DELIVERY_LABEL: Record<string, string> = {
  pending: "Pendente",
  packaging: "Em preparação",
  in_transit: "A caminho",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

function EntregadorIndex() {
  const { user } = useAuth();
  const [open, setOpen] = useState<Open[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [o, m] = await Promise.all([
      supabase.rpc("courier_open_deliveries"),
      supabase.rpc("courier_my_deliveries"),
    ]);
    if (o.error) toast.error(o.error.message);
    if (m.error) toast.error(m.error.message);
    setOpen((o.data as Open[]) ?? []);
    setMine((m.data as Mine[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { if (user) void load(); }, [user?.id, load]);

  const accept = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("courier_accept_delivery", { _delivery_id: id });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success("Entrega atribuída a si");
    void load();
  };

  const earnedPending = mine
    .filter((d) => d.status !== "delivered" && d.status !== "cancelled")
    .reduce((s, d) => s + Number(d.shipping_aoa || 0), 0);
  const earnedDone = mine
    .filter((d) => d.status === "delivered")
    .reduce((s, d) => s + Number(d.shipping_aoa || 0), 0);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Link to="/perfil" aria-label="Voltar" className="rounded-full p-1 hover:bg-accent">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="flex-1 text-base font-semibold">Painel do entregador</h1>
      </header>

      <div className="flex-1 space-y-5 p-4">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Entregas concluídas</p>
            <p className="text-lg font-bold">{formatAoa(earnedDone)}</p>
          </div>
          <div className="rounded-2xl border border-border p-3">
            <p className="text-[11px] text-muted-foreground">Em curso</p>
            <p className="text-lg font-bold">{formatAoa(earnedPending)}</p>
          </div>
        </div>
        <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-[11px] text-muted-foreground">
          <Wallet size={14} /> O valor de cada entrega é a taxa registada no pedido (orders.shipping_aoa) — a mesma que o cliente vê.
          O levantamento é feito na área de saques.
        </p>

        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <>
            <section>
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Entregas disponíveis</h2>
              {open.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Sem entregas disponíveis de momento.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {open.map((d) => (
                    <li key={d.delivery_id} className="rounded-2xl border border-border p-3">
                      <div className="flex items-start gap-3">
                        <Package size={18} className="mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">Pedido #{d.order_id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">{d.store_name ?? "Loja"} · {d.municipality ?? "—"}</p>
                          <p className="mt-0.5 text-xs font-semibold text-primary">Taxa de entrega: {formatAoa(Number(d.shipping_aoa))}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => accept(d.delivery_id)}
                        disabled={busy === d.delivery_id}
                        className="mt-2 h-10 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {busy === d.delivery_id ? "A aceitar…" : "Aceitar entrega"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-xs font-bold uppercase text-muted-foreground">As minhas entregas</h2>
              {mine.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  Ainda não tem entregas atribuídas.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {mine.map((d) => (
                    <li key={d.delivery_id}>
                      <Link
                        to="/entregador/$deliveryId"
                        params={{ deliveryId: d.delivery_id }}
                        className="flex items-start gap-3 rounded-2xl border border-border p-3"
                      >
                        <Truck size={18} className="mt-0.5 text-primary" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">Pedido #{d.order_id.slice(0, 8)}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.store_name ?? "Loja"} · {d.street ?? ""} {d.municipality ? `· ${d.municipality}` : ""}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Estado: {DELIVERY_LABEL[d.status] ?? d.status} · Pedido: {d.order_status}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold text-primary">
                            A receber: {formatAoa(Number(d.shipping_aoa))}
                          </p>
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
