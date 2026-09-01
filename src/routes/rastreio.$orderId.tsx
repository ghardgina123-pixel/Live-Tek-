import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, MapPin, Package, Truck, CheckCircle2, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { loadGoogleMaps } from "@/lib/google-maps";
import { useMapDefaults } from "@/lib/region";
import { toast } from "sonner";

export const Route = createFileRoute("/rastreio/$orderId")({
  head: () => ({
    meta: [
      { title: "Rastreio de encomenda — Live Teká" },
      { name: "description", content: "Acompanhe em tempo real o estado e a localização da sua encomenda Live Teká, desde a recolha na loja até à entrega." },
      { property: "og:title", content: "Rastreio de encomenda — Live Teká" },
      { property: "og:description", content: "Siga em tempo real a localização e o estado da sua encomenda Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),

  component: RastreioPage,
});

type DeliveryRow = {
  id: string;
  order_id: string;
  status: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  picked_up_at: string | null;
  delivered_at: string | null;
};
type TrackPoint = { lat: number; lng: number; updated_at: string };

const STEPS: { key: string; label: string; icon: typeof Clock }[] = [
  { key: "pending", label: "Pendente", icon: Clock },
  { key: "packaging", label: "Preparação", icon: Package },
  { key: "in_transit", label: "A caminho", icon: Truck },
  { key: "delivered", label: "Entregue", icon: CheckCircle2 },
];

function RastreioPage() {
  const { orderId } = Route.useParams();
  const { user, loading: authLoading } = useAuth();
  const [delivery, setDelivery] = useState<DeliveryRow | null>(null);
  const [point, setPoint] = useState<TrackPoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const markerRef = useRef<any>(null);
  const mapObjRef = useRef<any>(null);
  const mapDefaults = useMapDefaults();

  // Load delivery
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("deliveries")
        .select("id, order_id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, picked_up_at, delivered_at")
        .eq("order_id", orderId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setError(error.message);
      setDelivery((data as DeliveryRow | null) ?? null);
      if (data) {
        const { data: tp } = await supabase
          .from("delivery_tracking")
          .select("lat, lng, updated_at")
          .eq("delivery_id", data.id)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!cancelled && tp) setPoint(tp as TrackPoint);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [orderId, user?.id]);

  // Realtime tracking
  useEffect(() => {
    if (!delivery) return;
    const ch = supabase
      .channel(`track-${delivery.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "delivery_tracking", filter: `delivery_id=eq.${delivery.id}` },
        (payload) => setPoint(payload.new as TrackPoint),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "deliveries", filter: `id=eq.${delivery.id}` },
        (payload) => setDelivery((prev) => ({ ...(prev as DeliveryRow), ...(payload.new as DeliveryRow) })),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [delivery?.id]);

  // Google Maps init & marker
  useEffect(() => {
    if (!mapRef.current) return;
    let cancelled = false;
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapRef.current) return;
        const center = point
          ? { lat: Number(point.lat), lng: Number(point.lng) }
          : delivery?.dropoff_lat
            ? { lat: Number(delivery.dropoff_lat), lng: Number(delivery.dropoff_lng) }
            : mapDefaults.center; // centro do país seleccionado
        const zoom = point || delivery?.dropoff_lat ? 14 : mapDefaults.zoom;
        if (!mapObjRef.current) {
          mapObjRef.current = new maps.Map(mapRef.current, {
            center,
            zoom,
            disableDefaultUI: true,
            zoomControl: true,
          });
        } else {
          mapObjRef.current.setCenter(center);
        }
        if (point) {
          const pos = { lat: Number(point.lat), lng: Number(point.lng) };
          if (markerRef.current) markerRef.current.setPosition(pos);
          else markerRef.current = new maps.Marker({ map: mapObjRef.current, position: pos, title: "Entregador" });
          mapObjRef.current.panTo(pos);
        }
      })
      .catch((e) => toast.error("Mapa indisponível: " + e.message));
    return () => { cancelled = true; };
  }, [delivery?.id, point?.updated_at]);

  if (authLoading || loading) {
    return <Center><Loader2 className="animate-spin text-primary" /></Center>;
  }
  if (!user) {
    return <Center><p className="text-sm text-muted-foreground">Entre para ver o rastreio.</p></Center>;
  }
  if (error || !delivery) {
    return (
      <Center>
        <div className="space-y-2 text-center">
          <MapPin className="mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Ainda não há entrega associada a este pedido.</p>
          <Link to="/perfil" className="text-sm font-semibold text-primary">Voltar</Link>
        </div>
      </Center>
    );
  }

  const status = delivery.status;
  const currentIdx = Math.max(0, STEPS.findIndex((s) => s.key === status));

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <Link to="/perfil" aria-label="Voltar" className="rounded-full p-1 hover:bg-accent focus:outline-none focus:ring-2 focus:ring-primary">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold">Rastreio</h1>
          <p className="text-[11px] text-muted-foreground">Pedido #{orderId.slice(0, 8)}</p>
        </div>
      </header>

      <div ref={mapRef} aria-label="Mapa do entregador" className="h-[45vh] w-full bg-muted" />

      <div className="flex-1 space-y-4 p-4">
        <ol className="space-y-2">
          {STEPS.map((s, i) => {
            const done = i <= currentIdx;
            const Icon = s.icon;
            return (
              <li key={s.key} className="flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-full ${done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                  <Icon size={16} />
                </span>
                <span className={done ? "text-sm font-semibold" : "text-sm text-muted-foreground"}>{s.label}</span>
              </li>
            );
          })}
        </ol>

        {point ? (
          <p className="text-[11px] text-muted-foreground">Última localização: {new Date(point.updated_at).toLocaleTimeString("pt-AO")}</p>
        ) : (
          <p className="text-[11px] text-muted-foreground">Aguardando o entregador transmitir a localização…</p>
        )}
      </div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background">{children}</div>;
}