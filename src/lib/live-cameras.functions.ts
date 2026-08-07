import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
      return switchCamera(live, data.cameraId);
    },
  );
