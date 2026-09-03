import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, MapPin, Loader2, Power, Truck, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/entregador/$deliveryId")({
  head: () => ({ meta: [{ title: "Entregador — Live Teká" }, { name: "robots", content: "noindex" }] }),
  component: EntregadorPage,
});

type Delivery = {
  delivery_id: string;
  order_id: string;
  status: string;
  order_status: string;
  shipping_aoa: number;
  subtotal_aoa: number;
  total_aoa: number;
  courier_earning_aoa: number;
  store_name: string | null;
  street: string | null;
  municipality: string | null;
};

function EntregadorPage() {
  const { deliveryId } = Route.useParams();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [tracking, setTracking] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.rpc("courier_delivery_detail", { _delivery_id: deliveryId });
      if (cancelled) return;
      if (error) setError(error.message);
      setDelivery((data as unknown as Delivery) ?? null);
    })();
    return () => { cancelled = true; };
  }, [deliveryId]);

  const stop = () => {
    if (watchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setTracking(false);
  };

  useEffect(() => stop, []);

  const start = () => {
    if (!navigator.geolocation) return toast.error("Geolocalização não suportada");
    setTracking(true);
    watchRef.current = navigator.geolocation.watchPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLastPoint({ lat: latitude, lng: longitude, ts: Date.now() });
        const { error } = await supabase.from("delivery_tracking").insert({ delivery_id: deliveryId, lat: latitude, lng: longitude });
        if (error) toast.error(error.message);
      },
      (err) => { toast.error(err.message); stop(); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  };

  const setStatus = async (next: string) => {
    const patch: { status: string; picked_up_at?: string; delivered_at?: string } = { status: next };
    if (next === "in_transit") patch.picked_up_at = new Date().toISOString();
    if (next === "delivered") { patch.delivered_at = new Date().toISOString(); stop(); }
    const { error } = await supabase.from("deliveries").update(patch).eq("id", deliveryId);
    if (error) return toast.error(error.message);
    setDelivery((d) => (d ? { ...d, status: next } : d));
    toast.success("Estado atualizado");
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Link to="/perfil" aria-label="Voltar" className="rounded-full p-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Entrega #{deliveryId.slice(0, 8)}</h1>
          <p className="text-[11px] text-muted-foreground">Estado: {delivery?.status ?? "…"}</p>
        </div>
      </header>

      <div className="flex-1 space-y-4 p-4">
        {error && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
        {!delivery ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" aria-label="Carregando" /></div>
        ) : (
          <>
            <div className="rounded-2xl border border-border p-4 text-sm">
              <p className="font-semibold">Pedido #{delivery.order_id.slice(0, 8)}</p>
              <p className="text-xs text-muted-foreground">
                {delivery.store_name ?? "Loja"} · {delivery.street ?? ""} {delivery.municipality ? `· ${delivery.municipality}` : ""}
              </p>
              <dl className="mt-3 space-y-1 text-xs">
                <div className="flex justify-between"><dt className="text-muted-foreground">Estado da entrega</dt><dd className="font-semibold">{delivery.status}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Estado do pedido</dt><dd className="font-semibold">{delivery.order_status}</dd></div>
                <div className="flex justify-between"><dt className="text-muted-foreground">Taxa de entrega</dt><dd className="font-semibold">{formatAoa(Number(delivery.shipping_aoa))}</dd></div>
                <div className="flex justify-between border-t border-border pt-1">
                  <dt className="text-muted-foreground">Valor a receber</dt>
                  <dd className="font-bold text-primary">{formatAoa(Number(delivery.courier_earning_aoa))}</dd>
                </div>
              </dl>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Liquidação manual através do pedido de saque, após a entrega concluída.
              </p>
            </div>

            <div className="rounded-2xl border border-border p-4 text-sm">
              <p className="flex items-center gap-2 font-semibold"><MapPin size={16} /> Transmissão GPS</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tracking ? "Enviando localização em tempo real." : "Toque em Iniciar para transmitir a sua localização à central e ao cliente."}
              </p>
              {lastPoint && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Última: {lastPoint.lat.toFixed(5)}, {lastPoint.lng.toFixed(5)} · {new Date(lastPoint.ts).toLocaleTimeString("pt-AO")}
                </p>
              )}
              <button
                onClick={tracking ? stop : start}
                aria-pressed={tracking}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <Power size={16} /> {tracking ? "Parar transmissão" : "Iniciar transmissão"}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setStatus("in_transit")} className="rounded-xl border border-border p-3 text-sm font-semibold hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary">
                <Truck size={16} className="mx-auto mb-1" /> A caminho
              </button>
              <button onClick={() => setStatus("delivered")} className="rounded-xl border border-border p-3 text-sm font-semibold hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary">
                <CheckCircle2 size={16} className="mx-auto mb-1" /> Entregue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}