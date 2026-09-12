import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, MapPin, Package, Truck, Wallet } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatAoa } from "@/lib/commerce";
import { formatDistanceM } from "@/lib/geo";
import { toast } from "sonner";

const ACCEPT_ERROR_LABEL: Record<string, string> = {
  not_authenticated: "Sessão inválida. Entre novamente.",
  courier_not_active: "A sua conta de entregador não está activa.",
  courier_unavailable: "Está indisponível. Active a disponibilidade para aceitar entregas.",
  delivery_not_found: "Entrega não encontrada.",
  delivery_already_assigned: "Esta entrega já foi atribuída a outro entregador.",
  delivery_closed: "Esta entrega já foi concluída ou cancelada.",
  delivery_not_open: "Esta entrega já não está aberta.",
  vehicle_incompatible_with_load_class: "O seu veículo não tem capacidade para esta carga.",
};

function acceptErrorMessage(message: string): string {
  const key = Object.keys(ACCEPT_ERROR_LABEL).find((k) => message.includes(k));
  return key ? ACCEPT_ERROR_LABEL[key]! : message;
}

export const Route = createFileRoute("/_authenticated/entregador/")({
  head: () => ({ meta: [{ title: "Painel do entregador — Live Teká" }, { name: "robots", content: "noindex" }] }),
  component: EntregadorIndex,
});

type Open = {
  delivery_id: string; order_id: string; status: string; shipping_aoa: number;
  courier_fee_aoa: number | null; pickup_address: string | null; dropoff_address: string | null;
  store_name: string | null; municipality: string | null; load_class?: string | null; created_at: string;
  total_weight_kg?: number | null; total_volume_cm3?: number | null; items_count?: number | null;
  logistics_incomplete?: boolean | null;
  pickup_distance_m?: number | null;
  gps_fresh?: boolean | null;
};

const LOAD_CLASS_LABEL: Record<string, string> = {
  pequeno: "Carga pequena",
  medio: "Carga média",
  grande: "Carga grande",
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
  const [available, setAvailable] = useState<boolean | null>(null);
  const [gpsAt, setGpsAt] = useState<string | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const [gpsBusy, setGpsBusy] = useState(false);

  const load = useCallback(async () => {
    const [o, m, c] = await Promise.all([
      supabase.rpc("courier_open_deliveries"),
      supabase.rpc("courier_my_deliveries"),
      supabase.from("couriers").select("is_available, last_location_at").maybeSingle(),
    ]);
    if (o.error) toast.error(o.error.message);
    if (m.error) toast.error(m.error.message);
    setOpen((o.data as Open[]) ?? []);
    setMine((m.data as Mine[]) ?? []);
    if (c.data) {
      setAvailable(Boolean(c.data.is_available));
      setGpsAt(c.data.last_location_at ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (user) void load(); }, [user?.id, load]);

  // Envia a localização GPS REAL do dispositivo. Sem GPS não há proximidade.
  const shareLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGpsError("Este dispositivo não disponibiliza GPS.");
      return;
    }
    setGpsBusy(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { error } = await supabase.rpc("courier_update_location", {
          _lat: pos.coords.latitude,
          _lng: pos.coords.longitude,
        });
        setGpsBusy(false);
        if (error) { setGpsError(error.message); return; }
        setGpsError(null);
        void load();
      },
      (err) => {
        setGpsBusy(false);
        setGpsError(
          err.code === err.PERMISSION_DENIED
            ? "Permissão de localização recusada."
            : "Localização indisponível neste momento.",
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, [load]);

  const toggleAvailability = async () => {
    if (available === null) return;
    const next = !available;
    const { error } = await supabase.rpc("courier_set_availability", { _available: next });
    if (error) return toast.error(error.message);
    setAvailable(next);
    void load();
  };

  // Novas entregas aparecem em tempo real, sem recarregar a página.
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel("courier-deliveries")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "deliveries" }, () => {
        toast.info("Nova entrega disponível.");
        void load();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "deliveries" }, () => { void load(); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, load]);

  const accept = async (id: string) => {
    setBusy(id);
    const { error } = await supabase.rpc("courier_accept_delivery", { _delivery_id: id });
    setBusy(null);
    if (error) {
      toast.error(acceptErrorMessage(error.message));
      void load();
      return;
    }
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
                          <p className="mt-1 text-[11px] text-muted-foreground">Recolha: {d.pickup_address ?? "loja"}</p>
                          <p className="text-[11px] text-muted-foreground">Entrega: {d.dropoff_address ?? "endereço do cliente"}</p>
                          <p className="text-[11px] text-muted-foreground">
                            {d.load_class ? LOAD_CLASS_LABEL[d.load_class] : "Carga não classificada"}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {d.logistics_incomplete
                              ? "Dados logísticos incompletos"
                              : `${d.items_count ?? 0} artigo(s) · ${Number(d.total_weight_kg ?? 0).toLocaleString("pt-AO")} kg · ${Math.round(Number(d.total_volume_cm3 ?? 0) / 1000).toLocaleString("pt-AO")} L`}
                          </p>

                          <p className="mt-0.5 text-xs font-semibold text-primary">A receber: {formatAoa(Number(d.courier_fee_aoa ?? d.shipping_aoa))}</p>
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
