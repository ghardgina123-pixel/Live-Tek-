import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  decideBitrate,
  emptyCursor,
  parseVideoStats,
  MIN_BITRATE,
  MAX_BITRATE,
} from "@/lib/live-adaptive";
import { eventsToCsv } from "@/components/LiveAuditLog";
import { ingressTelemetry } from "@/lib/live-cameras.server";

describe("adaptação automática de qualidade", () => {
  it("degrada agressivamente com latência muito alta", () => {
    expect(decideBitrate(350_000, { rttMs: 600, lossPct: 0 })).toBe(210_000);
  });
  it("degrada suavemente com latência média", () => {
    expect(decideBitrate(350_000, { rttMs: 250, lossPct: 0 })).toBe(280_000);
  });
  it("degrada por perda de pacotes mesmo com RTT baixo", () => {
    expect(decideBitrate(350_000, { rttMs: 50, lossPct: 6 })).toBe(210_000);
  });
  it("recupera devagar em rede boa", () => {
    expect(decideBitrate(200_000, { rttMs: 80, lossPct: 0.2 })).toBe(230_000);
  });
  it("mantém o bitrate em zona neutra", () => {
    expect(decideBitrate(350_000, { rttMs: 150, lossPct: 1.5 })).toBe(350_000);
  });
  it("nunca sai dos limites configurados", () => {
    expect(decideBitrate(MIN_BITRATE, { rttMs: 900, lossPct: 40 })).toBe(MIN_BITRATE);
    expect(decideBitrate(MAX_BITRATE, { rttMs: 30, lossPct: 0 })).toBe(MAX_BITRATE);
  });
  it("converge para o mínimo em rede persistentemente má", () => {
    let b = MAX_BITRATE;
    for (let i = 0; i < 30; i++) b = decideBitrate(b, { rttMs: 800, lossPct: 20 });
    expect(b).toBe(MIN_BITRATE);
  });
});

describe("leitura real das estatísticas WebRTC", () => {
  it("calcula bitrate, RTT e perda entre amostras", () => {
    const cursor = emptyCursor();
    parseVideoStats(
      [{ type: "outbound-rtp", kind: "video", bytesSent: 0, timestamp: 0, packetsSent: 0 }],
      cursor,
    );
    const report = parseVideoStats(
      [
        { type: "outbound-rtp", kind: "video", bytesSent: 125_000, timestamp: 1000, packetsSent: 100 },
        { type: "remote-inbound-rtp", kind: "video", roundTripTime: 0.25, packetsLost: 5 },
      ],
      cursor,
    );
    expect(report.bitrateKbps).toBe(1000);
    expect(report.rttMs).toBe(250);
    expect(report.lossPct).toBe(5);
  });

  it("usa o candidate-pair quando não há RTT no outbound", () => {
    const report = parseVideoStats(
      [{ type: "candidate-pair", nominated: true, currentRoundTripTime: 0.08 }],
      emptyCursor(),
    );
    expect(report.rttMs).toBe(80);
  });
});

describe("telemetria real das câmaras IP (LiveKit Ingress)", () => {
  it("extrai bitrate, fps e resolução do estado do ingress", () => {
    const startedAt = BigInt((Date.now() - 60_000) * 1e6);
    const t = ingressTelemetry({
      state: {
        status: 2,
        error: "",
        startedAt,
        updatedAt: BigInt(Date.now() * 1e6),
        video: { averageBitrate: 1_500_000, width: 1280, height: 720, framerate: 25, mimeType: "video/h264" },
        audio: { averageBitrate: 64_000 },
      },
    } as never);
    expect(t.ingestActive).toBe(true);
    expect(t.bitrateKbps).toBe(1500);
    expect(t.fps).toBe(25);
    expect(t.width).toBe(1280);
    expect(t.uptimeSec).toBeGreaterThanOrEqual(59);
  });

  it("marca a câmara offline quando não há ingress", () => {
    const t = ingressTelemetry(undefined);
    expect(t.online).toBe(false);
    expect(t.bitrateKbps).toBeNull();
  });
});

describe("exportação de auditoria", () => {
  it("gera CSV com aspas escapadas", () => {
    const csv = eventsToCsv([
      {
        id: "1",
        kind: "camera_switch",
        level: "info",
        message: 'Fonte no ar: "Câmara 1"',
        metadata: { next: "abc" },
        created_at: "2026-01-01T10:00:00.000Z",
      },
    ]);
    expect(csv.split("\n")).toHaveLength(2);
    expect(csv).toContain('""Câmara 1""');
    expect(csv).toContain("camera_switch");
  });
});

// --- Integração do repositório (alternância + failover) com LiveKit e BD simulados ---

type Row = Record<string, unknown>;

const state: { cameras: Row[]; lives: Row[]; events: Row[] } = {
  cameras: [],
  lives: [],
  events: [],
};

const updateRoomMetadata = vi.fn(async () => {});
const listIngress = vi.fn(async () => [] as Array<Record<string, unknown>>);

vi.mock("@/lib/live-cameras.server", async (orig) => {
  const actual = await orig<typeof import("@/lib/live-cameras.server")>();
  return {
    ...actual,
    livekitConfig: () => ({ url: "wss://x", apiKey: "k", apiSecret: "s" }),
    ingressClient: () => ({ listIngress, deleteIngress: vi.fn(), createIngress: vi.fn() }),
    roomClient: () => ({ updateRoomMetadata }),
  };
});

function table(name: string) {
  const rows = () => state[name.replace("live_", "") as "cameras" | "events"] ?? [];
  let filters: Array<[string, unknown]> = [];
  const api: Record<string, unknown> = {
    select: () => api,
    order: () => api,
    eq: (col: string, val: unknown) => {
      filters.push([col, val]);
      return api;
    },
    maybeSingle: async () => ({
      data: rows().find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
    }),
    then: undefined,
    insert: (payload: Row) => {
      const row = { id: `id-${rows().length + 1}`, ...payload };
      rows().push(row);
      return {
        select: () => ({ single: async () => ({ data: row, error: null }) }),
        then: (res: (v: unknown) => void) => res({ data: [row], error: null }),
      };
    },
    update: (patch: Row) => ({
      eq: async (col: string, val: unknown) => {
        for (const r of rows()) if (r[col] === val) Object.assign(r, patch);
        return { error: null };
      },
    }),
    delete: () => ({
      eq: async (col: string, val: unknown) => {
        const list = rows();
        const i = list.findIndex((r) => r[col] === val);
        if (i >= 0) list.splice(i, 1);
        return { error: null };
      },
    }),
  };
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (name: string) => {
      if (name === "lives") {
        let filters: Array<[string, unknown]> = [];
        const api: Record<string, unknown> = {
          select: () => api,
          eq: (c: string, v: unknown) => {
            filters.push([c, v]);
            return api;
          },
          maybeSingle: async () => ({
            data: state.lives.find((r) => filters.every(([c, v]) => r[c] === v)) ?? null,
          }),
          update: (patch: Row) => ({
            eq: async (c: string, v: unknown) => {
              for (const r of state.lives) if (r[c] === v) Object.assign(r, patch);
              return { error: null };
            },
          }),
        };
        return api;
      }
      return table(name);
    },
  },
}));

const LIVE = {
  id: "11111111-1111-1111-1111-111111111111",
  storeId: "22222222-2222-2222-2222-222222222222",
  room: "store-abc",
  activeCameraId: null as string | null,
  ownerId: "33333333-3333-3333-3333-333333333333",
};

beforeEach(() => {
  state.cameras = [];
  state.events = [];
  state.lives = [
    { id: LIVE.id, store_id: LIVE.storeId, livekit_room: LIVE.room, active_camera_id: null },
  ];
  updateRoomMetadata.mockClear();
  listIngress.mockResolvedValue([]);
});

describe("alternância de câmaras em produção", () => {
  it("cria a câmara do telemóvel e coloca-a no ar por omissão", async () => {
    const { loadCameras } = await import("@/lib/live-cameras.repo.server");
    const res = await loadCameras({ ...LIVE }, LIVE.ownerId);
    expect(res.cameras).toHaveLength(1);
    expect(res.cameras[0]!.sourceType).toBe("phone");
    expect(res.activeCameraId).toBe(res.cameras[0]!.id);
    expect(state.lives[0]!["active_identity"]).toBe(LIVE.ownerId);
  });

  it("alterna a fonte no ar, publica metadados na sala e regista auditoria", async () => {
    const { switchCamera } = await import("@/lib/live-cameras.repo.server");
    state.cameras.push({
      id: "cam-ip",
      live_id: LIVE.id,
      store_id: LIVE.storeId,
      label: "Câmara IP",
      source_type: "rtsp",
      participant_identity: "cam-ip-1",
      status: "publishing",
    });
    const out = await switchCamera({ ...LIVE }, "cam-ip", LIVE.ownerId);
    expect(out).toEqual({ activeCameraId: "cam-ip", activeIdentity: "cam-ip-1" });
    expect(state.lives[0]!["active_camera_id"]).toBe("cam-ip");
    expect(updateRoomMetadata).toHaveBeenCalledWith(
      LIVE.room,
      JSON.stringify({ activeIdentity: "cam-ip-1", activeCameraId: "cam-ip" }),
    );
    expect(state.events.some((e) => e["kind"] === "camera_switch")).toBe(true);
  });

  it("recusa alternar para uma câmara de outra live", async () => {
    const { switchCamera } = await import("@/lib/live-cameras.repo.server");
    state.cameras.push({
      id: "cam-x",
      live_id: "outra-live",
      participant_identity: "x",
      label: "X",
    });
    await expect(switchCamera({ ...LIVE }, "cam-x")).rejects.toThrow("CAMERA_NOT_FOUND");
  });
});

describe("failover automático", () => {
  it("passa a fonte para o telemóvel quando a câmara IP no ar falha", async () => {
    const { loadCameras } = await import("@/lib/live-cameras.repo.server");
    state.cameras.push(
      {
        id: "cam-phone",
        live_id: LIVE.id,
        store_id: LIVE.storeId,
        label: "Telemóvel",
        source_type: "phone",
        participant_identity: LIVE.ownerId,
        status: "publishing",
      },
      {
        id: "cam-ip",
        live_id: LIVE.id,
        store_id: LIVE.storeId,
        label: "Câmara IP",
        source_type: "rtsp",
        participant_identity: "cam-ip-1",
        ingress_id: "ing-1",
        status: "publishing",
      },
    );
    listIngress.mockResolvedValue([
      { ingressId: "ing-1", state: { status: 3, error: "RTSP timeout" } },
    ]);

    const res = await loadCameras({ ...LIVE, activeCameraId: "cam-ip" }, LIVE.ownerId);

    expect(res.activeCameraId).toBe("cam-phone");
    expect(state.lives[0]!["active_identity"]).toBe(LIVE.ownerId);
    expect(state.events.some((e) => e["kind"] === "camera_error")).toBe(true);
    expect(state.events.some((e) => e["kind"] === "camera_failover")).toBe(true);
  });

  it("mantém a fonte quando a câmara no ar está saudável", async () => {
    const { loadCameras } = await import("@/lib/live-cameras.repo.server");
    state.cameras.push({
      id: "cam-phone",
      live_id: LIVE.id,
      store_id: LIVE.storeId,
      label: "Telemóvel",
      source_type: "phone",
      participant_identity: LIVE.ownerId,
      status: "publishing",
    });
    const res = await loadCameras({ ...LIVE, activeCameraId: "cam-phone" }, LIVE.ownerId);
    expect(res.activeCameraId).toBe("cam-phone");
    expect(state.events.some((e) => e["kind"] === "camera_failover")).toBe(false);
  });
});
