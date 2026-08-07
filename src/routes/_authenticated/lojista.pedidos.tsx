import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Clock, CheckCircle2, Package, Truck, XCircle, MapPin, Copy } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/lojista/pedidos")({
  head: () => ({ meta: [{ title: "Pedidos — Lojista" }] }),
  component: ShellPage,
});

type OrderStatus = "pending" | "paid" | "preparing" | "shipped" | "delivered" | "cancelled";
type Order = {
  id: string;
  total_aoa: number;
  status: OrderStatus;
  payment_method: string | null;
  created_at: string;
  customer_id: string;
  delivery_id?: string | null;
};

const STATUS_META: Record<OrderStatus, { label: string; cls: string; icon: typeof Clock }> = {
  pending: { label: "Pendente", cls: "bg-yellow-100 text-yellow-800", icon: Clock },
  paid: { label: "Pago", cls: "bg-blue-100 text-blue-800", icon: CheckCircle2 },
  preparing: { label: "Preparando", cls: "bg-indigo-100 text-indigo-800", icon: Package },
  shipped: { label: "Enviado", cls: "bg-purple-100 text-purple-800", icon: Truck },
  delivered: { label: "Entregue", cls: "bg-green-100 text-green-800", icon: CheckCircle2 },
  cancelled: { label: "Cancelado", cls: "bg-red-100 text-red-800", icon: XCircle },
};

const NEXT: Record<OrderStatus, OrderStatus[]> = {
  pending: ["paid", "cancelled"],
  paid: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
};

function Pedidos() {
  const { t } = useT();
  const { store } = useLojistaStore();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = async () => {
    if (!store) return;
    const { data } = await supabase
      .from("orders")
      .select("id, total_aoa, status, payment_method, created_at, customer_id, deliveries(id)")
      .eq("store_id", store.id)
      .order("created_at", { ascending: false });
    const rows = ((data as any[]) ?? []).map((r) => ({ ...r, delivery_id: r.deliveries?.[0]?.id ?? null })) as Order[];
    setItems(rows);
    setLoading(false);
  };
  useEffect(() => { load(); }, [store?.id]);

  const updateStatus = async (id: string, next: OrderStatus) => {
    setUpdating(id);
    const { error } = await supabase.from("orders").update({ status: next }).eq("id", id);
    setUpdating(null);
    if (error) return toast.error(error.message);
    toast.success(`Pedido atualizado: ${STATUS_META[next].label}`);
    setItems((prev) => prev.map((o) => (o.id === id ? { ...o, status: next } : o)));
  };

  const createDelivery = async (orderId: string) => {
    setUpdating(orderId);
    const { data, error } = await supabase.rpc("seller_create_delivery", { _order_id: orderId });
    setUpdating(null);
    if (error) return toast.error(error.message);
    const deliveryId = data as string;
    const url = `${window.location.origin}/entregador/${deliveryId}`;
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    toast.success(t("s_entrega_criada_link_copiado_para_o_estafeta"));
    setItems((prev) => prev.map((o) => (o.id === orderId ? { ...o, delivery_id: deliveryId, status: "shipped" as OrderStatus } : o)));
  };

  if (!store) return null;

  return (
    <div>
      <h2 className="mb-3 text-sm font-bold">{items.length} pedido(s)</h2>
      {loading ? (
        <ul className="space-y-3" aria-busy="true" aria-label={t("s_carregando_pedidos")}>
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="animate-pulse rounded-xl border border-border p-3">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="mt-2 h-4 w-32 rounded bg-muted" />
              <div className="mt-2 h-3 w-40 rounded bg-muted" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <Empty label={t("s_nenhum_pedido_ainda")} />
      ) : (
        <ul className="space-y-3">
          {items.map((o) => {
            const meta = STATUS_META[o.status];
            const Icon = meta.icon;
            const options = NEXT[o.status];
            return (
              <li key={o.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-mono text-muted-foreground">#{o.id.slice(0, 8)}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${meta.cls}`}>
                    <Icon size={10} /> {meta.label}
                  </span>
                </div>
                <p className="mt-1 text-sm font-bold">Kz {Number(o.total_aoa).toLocaleString("pt-AO")}</p>
                <p className="text-[10px] text-muted-foreground">
                  {new Date(o.created_at).toLocaleString("pt-BR")}
                  {o.payment_method && <> · {o.payment_method}</>}
                </p>
                {options.length > 0 && (
                  <div className="mt-3 flex items-center gap-2">
                    <Select
                      disabled={updating === o.id}
                      onValueChange={(v) => updateStatus(o.id, v as OrderStatus)}
                    >
                      <SelectTrigger className="h-9 flex-1 text-xs">
                        <SelectValue placeholder={t("s_alterar_status")} />
                      </SelectTrigger>
                      <SelectContent>
                        {options.map((s) => (
                          <SelectItem key={s} value={s}>{STATUS_META[s].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {updating === o.id && <Loader2 size={14} className="animate-spin text-primary" />}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {!o.delivery_id ? (
                    (o.status === "paid" || o.status === "preparing" || o.status === "shipped") && (
                      <button
                        onClick={() => createDelivery(o.id)}
                        disabled={updating === o.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60"
                      >
                        <Truck size={12} /> {t("s_criar_entrega")}
                      </button>
                    )
                  ) : (
                    <>
                      <Link
                        to="/rastreio/$orderId"
                        params={{ orderId: o.id }}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <MapPin size={12} /> {t("s_ver_mapa")}
                      </Link>
                      <button
                        onClick={async () => {
                          const url = `${window.location.origin}/entregador/${o.delivery_id}`;
                          try { await navigator.clipboard.writeText(url); toast.success(t("s_link_do_estafeta_copiado")); } catch { toast.error(t("s_nao_foi_possivel_copiar")); }
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-[11px] font-semibold hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary"
                      >
                        <Copy size={12} /> {t("s_copiar_link_do_estafeta")}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">{label}</div>;
}

function ShellPage() {
  const { t } = useT();
  return (
    <LojistaShell title={t("s_pedidos")}>
      <Pedidos />
    </LojistaShell>
  );
}