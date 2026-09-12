import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, MapPin, Loader2, Power, Truck, CheckCircle2, Package, Phone, Route as RouteIcon, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatAoa } from "@/lib/commerce";
import { loadGoogleMaps } from "@/lib/google-maps";
import { useMapDefaults } from "@/lib/region";
import { getDeliveryRoute, type DeliveryRouteResult } from "@/lib/logistics.functions";
import { decodePolyline, formatDistanceM, formatDurationS } from "@/lib/geo";

export const Route = createFileRoute("/_authenticated/entregador/$deliveryId")({
  head: () => ({ meta: [{ title: "Entregador — Live Teká" }, { name: "robots", content: "noindex" }] }),
  component: EntregadorPage,
});


type Delivery = {
  delivery_id: string;
  order_id: string;
  status: string;
  order_status: string;
  payment_method: string | null;
  shipping_aoa: number;
  subtotal_aoa: number;
  total_aoa: number;
  courier_earning_aoa: number;
  store_name: string | null;
  store_phone: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  street: string | null;
  reference: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  municipality: string | null;
  items_count: number;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendente",
  packaging: "Em preparação",
  in_transit: "A caminho",
  delivered: "Entregue",
  cancelled: "Cancelada",
};

function EntregadorPage() {
  const { deliveryId } = Route.useParams();
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [tracking, setTracking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastPoint, setLastPoint] = useState<{ lat: number; lng: number; ts: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const watchRef = useRef<number | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObjRef = useRef<any>(null);
  const mapDefaults = useMapDefaults();

  const loadDetail = async () => {
    const { data, error } = await supabase.rpc("courier_delivery_detail", { _delivery_id: deliveryId });
    if (error) setError(error.message);
    setDelivery((data as unknown as Delivery) ?? null);
  };

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

  // Mapa com recolha (loja) e entrega (cliente)
  useEffect(() => {
    if (!delivery || !mapRef.current) return;
    const pickup = delivery.pickup_lat != null && delivery.pickup_lng != null
      ? { lat: Number(delivery.pickup_lat), lng: Number(delivery.pickup_lng) } : null;
    const dropoff = delivery.dropoff_lat != null && delivery.dropoff_lng != null
      ? { lat: Number(delivery.dropoff_lat), lng: Number(delivery.dropoff_lng) } : null;
    if (!pickup && !dropoff) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        const center = pickup ?? dropoff ?? mapDefaults.center;
        mapObjRef.current = new maps.Map(mapRef.current, { center, zoom: 13, disableDefaultUI: true });
        if (pickup) new maps.Marker({ position: pickup, map: mapObjRef.current, title: "Recolha" });
        if (dropoff) new maps.Marker({ position: dropoff, map: mapObjRef.current, title: "Entrega" });
        if (pickup && dropoff) {
          const bounds = new maps.LatLngBounds();
          bounds.extend(pickup);
          bounds.extend(dropoff);
          mapObjRef.current.fitBounds(bounds);
        }
      })
      .catch(() => { /* mapa opcional: chave ausente não bloqueia a entrega */ });
    return () => { cancelled = true; };
  }, [delivery?.delivery_id, delivery?.pickup_lat, delivery?.dropoff_lat, mapDefaults.center]);

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

  // Estado alterado apenas através da função protegida no servidor.
  const setStatus = async (next: "packaging" | "in_transit" | "delivered") => {
    setBusy(true);
    const { error } = await supabase.rpc("courier_update_delivery_status", { _delivery_id: deliveryId, _status: next });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (next === "delivered") stop();
    await loadDetail();
    toast.success("Estado atualizado");
  };

  const hasMap = !!delivery && ((delivery.pickup_lat != null && delivery.pickup_lng != null) || (delivery.dropoff_lat != null && delivery.dropoff_lng != null));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Link to="/entregador" aria-label="Voltar" className="rounded-full p-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Entrega #{deliveryId.slice(0, 8)}</h1>
          <p className="text-[11px] text-muted-foreground">Estado: {STATUS_LABEL[delivery?.status ?? ""] ?? delivery?.status ?? "…"}</p>
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
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Package size={13} /> {delivery.items_count} item(ns) · {delivery.payment_method ?? "pagamento"}
              </p>
              <div className="mt-3 space-y-2 text-xs">
                <div>
                  <p className="font-semibold">Recolha</p>
                  <p className="text-muted-foreground">{delivery.pickup_address ?? delivery.store_name ?? "Loja"}</p>
                  {delivery.store_phone && (
                    <a href={`tel:${delivery.store_phone}`} className="mt-0.5 inline-flex items-center gap-1 text-primary">
                      <Phone size={12} /> {delivery.store_phone}
                    </a>
                  )}
                </div>
                <div>
                  <p className="font-semibold">Entrega</p>
                  <p className="text-muted-foreground">
                    {delivery.dropoff_address ?? [delivery.street, delivery.municipality].filter(Boolean).join(", ")}
                  </p>
                  {delivery.reference && <p className="text-muted-foreground">Ref.: {delivery.reference}</p>}
                  {delivery.recipient_name && <p className="text-muted-foreground">{delivery.recipient_name}</p>}
                  {delivery.recipient_phone && (
                    <a href={`tel:${delivery.recipient_phone}`} className="mt-0.5 inline-flex items-center gap-1 text-primary">
                      <Phone size={12} /> {delivery.recipient_phone}
                    </a>
                  )}
                </div>
              </div>
              <dl className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
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

            {hasMap ? (
              <div className="overflow-hidden rounded-2xl border border-border">
                <div ref={mapRef} className="h-48 w-full bg-muted" aria-label="Mapa da recolha e da entrega" />
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                Sem coordenadas registadas para esta entrega. Use os endereços acima.
              </p>
            )}

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

            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => setStatus("packaging")} disabled={busy || delivery.status !== "pending"} className="rounded-xl border border-border p-3 text-xs font-semibold hover:bg-accent disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary">
                <Package size={16} className="mx-auto mb-1" /> Recolher
              </button>
              <button onClick={() => setStatus("in_transit")} disabled={busy || !["pending", "packaging"].includes(delivery.status)} className="rounded-xl border border-border p-3 text-xs font-semibold hover:bg-accent disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary">
                <Truck size={16} className="mx-auto mb-1" /> A caminho
              </button>
              <button onClick={() => setStatus("delivered")} disabled={busy || delivery.status !== "in_transit"} className="rounded-xl border border-border p-3 text-xs font-semibold hover:bg-accent disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-primary">
                <CheckCircle2 size={16} className="mx-auto mb-1" /> Entregue
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
