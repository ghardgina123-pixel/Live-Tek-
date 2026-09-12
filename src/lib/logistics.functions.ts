import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { limitByKey } from "@/lib/rate-limit.server";
import { isValidLatLng } from "@/lib/geo";

export type DeliveryRouteResult = {
  /** Estado da geografia da entrega. */
  status: "ok" | "no_coordinates" | "not_configured" | "unavailable";
  message: string | null;
  origin: { lat: number; lng: number } | null;
  destination: { lat: number; lng: number } | null;
  /** Distância geodésica congelada na criação da entrega (metros). */
  straightDistanceM: number | null;
  distanceUnit: string | null;
  distanceComputedAt: string | null;
  /** Distância e duração reais do serviço de rotas (nunca estimadas aqui). */
  routeDistanceM: number | null;
  routeDurationS: number | null;
  routePolyline: string | null;
  routeProvider: string | null;
  routeComputedAt: string | null;
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_maps";
const MAX_ROUTE_AGE_MS = 15 * 60 * 1000;

/**
 * Devolve a geografia real de uma entrega e, quando possível, obtém a rota
 * real (distância + duração) do serviço de rotas configurado no backend.
 *
 * Regras:
 * - autorização é feita pela função protegida `courier_delivery_detail`
 *   (entregador atribuído ou administração);
 * - a distância oficial vem do snapshot gravado pela base de dados;
 * - a rota é gravada por `set_delivery_route` (apenas service_role);
 * - sem coordenadas válidas ou sem serviço configurado nada é calculado nem
 *   inventado.
 */
export const getDeliveryRoute = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { deliveryId: string }) => {
    if (!input?.deliveryId || typeof input.deliveryId !== "string") throw new Error("invalid_input");
    return { deliveryId: input.deliveryId };
  })
  .handler(async ({ data, context }): Promise<DeliveryRouteResult> => {
    const { supabase, userId } = context;

    const limited = await limitByKey(`delivery_route:${userId}`, 30, 5, 5);
    if (limited.blocked) throw new Error("rate_limited");

    // Autorização + leitura do snapshot oficial (SECURITY DEFINER protegida).
    const { data: detail, error } = await supabase.rpc("courier_delivery_detail", {
      _delivery_id: data.deliveryId,
    });
    if (error) throw new Error(error.message);
    const d = (detail ?? null) as Record<string, unknown> | null;
    if (!d) throw new Error("delivery_not_found");

    const originLat = d["pickup_lat"] as number | null;
    const originLng = d["pickup_lng"] as number | null;
    const destLat = d["dropoff_lat"] as number | null;
    const destLng = d["dropoff_lng"] as number | null;

    const base: DeliveryRouteResult = {
      status: "ok",
      message: null,
      origin: isValidLatLng(originLat, originLng) ? { lat: Number(originLat), lng: Number(originLng) } : null,
      destination: isValidLatLng(destLat, destLng) ? { lat: Number(destLat), lng: Number(destLng) } : null,
      straightDistanceM: (d["straight_distance_m"] as number | null) ?? null,
      distanceUnit: (d["distance_unit"] as string | null) ?? null,
      distanceComputedAt: (d["distance_computed_at"] as string | null) ?? null,
      routeDistanceM: (d["route_distance_m"] as number | null) ?? null,
      routeDurationS: (d["route_duration_s"] as number | null) ?? null,
      routePolyline: (d["route_polyline"] as string | null) ?? null,
      routeProvider: (d["route_provider"] as string | null) ?? null,
      routeComputedAt: (d["route_computed_at"] as string | null) ?? null,
    };

    if (!base.origin || !base.destination) {
      return {
        ...base,
        status: "no_coordinates",
        message: "Distância indisponível — coordenadas reais em falta.",
      };
    }

    // Rota já obtida e recente: não repetir a chamada externa.
    if (base.routeComputedAt && Date.now() - new Date(base.routeComputedAt).getTime() < MAX_ROUTE_AGE_MS) {
      return base;
    }

    const lovableKey = process.env["LOVABLE_API_KEY"];
    const mapsKey = process.env["GOOGLE_MAPS_API_KEY"];
    if (!lovableKey || !mapsKey) {
      return {
        ...base,
        status: "not_configured",
        message: "Rota não disponível — serviço de mapas não configurado.",
      };
    }

    try {
      const response = await fetch(`${GATEWAY_URL}/routes/directions/v2:computeRoutes`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": mapsKey,
          "Content-Type": "application/json",
          "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: base.origin.lat, longitude: base.origin.lng } } },
          destination: { location: { latLng: { latitude: base.destination.lat, longitude: base.destination.lng } } },
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(`routes gateway failed [${response.status}]: ${body}`);
        return {
          ...base,
          status: "unavailable",
          message: "Rota indisponível — o serviço de rotas respondeu com erro.",
        };
      }

      const json = (await response.json()) as {
        routes?: { distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }[];
      };
      const route = json.routes?.[0];
      const distanceM = route?.distanceMeters ?? null;
      const durationS = route?.duration ? Number(String(route.duration).replace(/s$/, "")) : null;
      if (!distanceM || !durationS || !Number.isFinite(durationS)) {
        return {
          ...base,
          status: "unavailable",
          message: "Rota indisponível — o serviço não devolveu distância e duração reais.",
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: saveErr } = await supabaseAdmin.rpc("set_delivery_route", {
        _delivery_id: data.deliveryId,
        _distance_m: distanceM,
        _duration_s: Math.round(durationS),
        _polyline: route?.polyline?.encodedPolyline ?? null,
        _provider: "google_routes_api",
      });
      if (saveErr) console.error("set_delivery_route failed", saveErr);

      return {
        ...base,
        status: "ok",
        message: null,
        routeDistanceM: distanceM,
        routeDurationS: Math.round(durationS),
        routePolyline: route?.polyline?.encodedPolyline ?? null,
        routeProvider: "google_routes_api",
        routeComputedAt: new Date().toISOString(),
      };
    } catch (e) {
      console.error("computeRoutes error", e);
      return {
        ...base,
        status: "unavailable",
        message: "Rota indisponível — falha ao contactar o serviço de rotas.",
      };
    }
  });
