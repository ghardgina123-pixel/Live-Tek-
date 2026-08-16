import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, ShoppingBag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/lib/i18n";
import { ORDER_STATUS_LABEL, formatAoa } from "@/lib/commerce";

export const Route = createFileRoute("/_authenticated/compras")({
  head: () => ({ meta: [{ title: "Minhas compras — Live Teká" }] }),
  component: Compras,
});

type Order = {
  id: string;
  total_aoa: number;
  status: string;
  created_at: string;
  payment_method: string | null;
  stores: { name: string } | null;
};

function Compras() {
  const { t } = useT();
  const { user } = useAuth();
  const [items, setItems] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase.from("orders")
      .select("id, total_aoa, status, created_at, payment_method, stores(name)")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setItems((data as Order[]) ?? []);
        setLoading(false);
      });
  }, [user?.id]);

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">{t("s_minhas_compras")}</h1>
      </header>
      <div className="px-5 py-5">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <ShoppingBag className="mx-auto text-muted-foreground" size={32} />
            <p className="mt-3 text-sm text-muted-foreground">{t("s_voce_ainda_nao_fez_nenhuma_compra")}</p>
            <Link to="/home" className="mt-4 inline-block rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{t("s_explorar_lojas")}</Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((o) => (
              <li key={o.id} className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">{o.stores?.name ?? t("s_loja")}</p>
                  <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase">
                    {ORDER_STATUS_LABEL[o.status] ?? o.status}
                  </span>
                </div>
                <p className="mt-1 text-sm">{formatAoa(o.total_aoa)}</p>
                <p className="text-[10px] text-muted-foreground">
                  Pedido {o.id.slice(0, 8)} · {o.payment_method ?? "método por definir"} ·{" "}
                  {new Date(o.created_at).toLocaleString("pt-PT")}
                </p>
                <Link to="/rastreio/$orderId" params={{ orderId: o.id }} className="mt-2 inline-block text-xs font-semibold text-primary">
                  Ver detalhes do pedido
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}