import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type LiveCameraStats = {
  online?: boolean;
  ingestActive?: boolean;
  bitrateKbps?: number | null;
  audioBitrateKbps?: number | null;
  fps?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  uptimeSec?: number | null;
  latencyMs?: number | null;
  lossPct?: number | null;
  updatedAt?: string;
};

export type LiveCameraDTO = {
  id: string;
  label: string;
  sourceType: "phone" | "rtsp" | "rtmp" | "whip";
  sourceUrl: string | null;
  ingressId: string | null;
  ingressUrl: string | null;
  streamKey: string | null;
  participantIdentity: string;
  status: string;
  lastError: string | null;
  isActive: boolean;
  stats: LiveCameraStats | null;
  lastSeenAt: string | null;
};

const liveIdSchema = z.object({ liveId: z.string().uuid() });
const cameraIdSchema = z.object({ cameraId: z.string().uuid() });

export const listLiveCameras = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => liveIdSchema.parse(d))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ cameras: LiveCameraDTO[]; activeCameraId: string | null }> => {
      const { loadCameras, requireLiveOwner } = await import("@/lib/live-cameras.repo.server");
      const live = await requireLiveOwner(data.liveId, context.userId);
      return loadCameras(live, context.userId);
    },
  );

export const createLiveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        liveId: z.string().uuid(),
        label: z.string().trim().min(1).max(60),
        sourceType: z.enum(["rtsp", "rtmp", "whip"]),
        sourceUrl: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<LiveCameraDTO> => {
    const { addCamera, requireLiveOwner } = await import("@/lib/live-cameras.repo.server");
    const live = await requireLiveOwner(data.liveId, context.userId);
    return addCamera(live, data);
  });

export const startLiveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => cameraIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<LiveCameraDTO> => {
    const { startCamera } = await import("@/lib/live-cameras.repo.server");
    return startCamera(data.cameraId, context.userId);
  });

export const stopLiveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => cameraIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<LiveCameraDTO> => {
    const { stopCamera } = await import("@/lib/live-cameras.repo.server");
    return stopCamera(data.cameraId, context.userId);
  });

export const deleteLiveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => cameraIdSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { removeCamera } = await import("@/lib/live-cameras.repo.server");
    await removeCamera(data.cameraId, context.userId);
    return { ok: true };
  });

export const switchLiveCamera = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ liveId: z.string().uuid(), cameraId: z.string().uuid() }).parse(d),
  )
  .handler(
    async ({ data, context }): Promise<{ activeCameraId: string; activeIdentity: string }> => {
      const { requireLiveOwner, switchCamera } = await import("@/lib/live-cameras.repo.server");
      const live = await requireLiveOwner(data.liveId, context.userId);
      return switchCamera(live, data.cameraId, context.userId);
    },
  );

export const reportCameraTelemetry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        liveId: z.string().uuid(),
        bitrateKbps: z.number().nonnegative().max(100_000).optional(),
        fps: z.number().nonnegative().max(240).optional(),
        width: z.number().nonnegative().max(8192).optional(),
        height: z.number().nonnegative().max(8192).optional(),
        latencyMs: z.number().nonnegative().max(60_000).optional(),
        lossPct: z.number().min(0).max(100).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: boolean }> => {
    const { requireLiveOwner, saveCameraTelemetry } = await import(
      "@/lib/live-cameras.repo.server"
    );
    await requireLiveOwner(data.liveId, context.userId);
    const { liveId, ...stats } = data;
    const res = await saveCameraTelemetry(liveId, context.userId, stats);
    return { ok: res.ok };
  });

export const logLiveAuditEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        liveId: z.string().uuid(),
        kind: z.string().trim().min(1).max(40),
        level: z.enum(["info", "warn", "error"]).default("info"),
        message: z.string().trim().min(1).max(300),
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { requireLiveOwner, logLiveEvent } = await import("@/lib/live-cameras.repo.server");
    const live = await requireLiveOwner(data.liveId, context.userId);
    await logLiveEvent({
      liveId: live.id,
      storeId: live.storeId,
      actorId: context.userId,
      kind: data.kind,
      level: data.level,
      message: data.message,
      metadata: data.metadata ?? {},
    });
    return { ok: true };
  });
