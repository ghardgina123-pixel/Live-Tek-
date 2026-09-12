// Utilitários geográficos puros (sem estado, sem rede).
// A distância oficial de uma entrega é sempre calculada no servidor/base de
// dados (`geo_distance_m`) — estas funções servem apenas para apresentação e
// para descodificar o traçado devolvido pelo serviço de rotas.

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  const la = Number(lat);
  const ln = Number(lng);
  if (lat === null || lng === null || lat === undefined || lng === undefined) return false;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
  return la >= -90 && la <= 90 && ln >= -180 && ln <= 180;
}

/** Distância geodésica em metros (apenas para conferência/testes). */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Formata metros. Devolve null quando não há valor real. */
export function formatDistanceM(meters: number | null | undefined): string | null {
  if (meters === null || meters === undefined) return null;
  const m = Number(meters);
  if (!Number.isFinite(m) || m < 0) return null;
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m / 1000 < 10 ? 1 : 0)} km`;
}

/** Formata segundos de duração real. Devolve null quando não há valor real. */
export function formatDurationS(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const mins = Math.round(s / 60);
  if (mins < 60) return `${Math.max(1, mins)} min`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** Descodifica uma encoded polyline (formato Google) em coordenadas. */
export function decodePolyline(encoded: string): { lat: number; lng: number }[] {
  const points: { lat: number; lng: number }[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}
