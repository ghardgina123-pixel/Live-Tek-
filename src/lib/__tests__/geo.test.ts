import { describe, it, expect } from "vitest";
import { isValidLatLng, haversineMeters, formatDistanceM, formatDurationS, decodePolyline } from "@/lib/geo";

describe("isValidLatLng", () => {
  it("aceita coordenadas reais", () => {
    expect(isValidLatLng(-8.8383, 13.2344)).toBe(true);
  });
  it("rejeita ausência de coordenadas", () => {
    expect(isValidLatLng(null, 13.2344)).toBe(false);
    expect(isValidLatLng(-8.8383, null)).toBe(false);
    expect(isValidLatLng(undefined, undefined)).toBe(false);
  });
  it("rejeita coordenadas inválidas", () => {
    expect(isValidLatLng(120, 13)).toBe(false);
    expect(isValidLatLng(-8, 200)).toBe(false);
    expect(isValidLatLng("abc", 13)).toBe(false);
  });
});

describe("haversineMeters", () => {
  it("distância nula para o mesmo ponto", () => {
    expect(haversineMeters(-8.8383, 13.2344, -8.8383, 13.2344)).toBe(0);
  });
  it("distância plausível entre dois pontos reais", () => {
    const m = haversineMeters(-8.8383, 13.2344, -8.8147, 13.23);
    expect(m).toBeGreaterThan(2000);
    expect(m).toBeLessThan(3500);
  });
});

describe("formatDistanceM / formatDurationS", () => {
  it("não inventa valores quando não existem", () => {
    expect(formatDistanceM(null)).toBeNull();
    expect(formatDistanceM(undefined)).toBeNull();
    expect(formatDurationS(null)).toBeNull();
    expect(formatDurationS(0)).toBeNull();
    expect(formatDurationS(-10)).toBeNull();
  });
  it("formata metros e quilómetros", () => {
    expect(formatDistanceM(850)).toBe("850 m");
    expect(formatDistanceM(2500)).toBe("2.5 km");
  });
  it("formata durações reais", () => {
    expect(formatDurationS(600)).toBe("10 min");
    expect(formatDurationS(3600)).toBe("1 h");
    expect(formatDurationS(5400)).toBe("1 h 30 min");
  });
});

describe("decodePolyline", () => {
  it("descodifica um traçado", () => {
    const pts = decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@");
    expect(pts).toHaveLength(3);
    expect(pts[0]!.lat).toBeCloseTo(38.5, 1);
  });
});
