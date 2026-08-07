import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({
  liveId: z.string().uuid(),
  canPublish: z.boolean().optional(),
});

// Short-lived room credentials: LiveKit tokens are temporary by design and are
// re-issued by this authenticated endpoint whenever a viewer/publisher joins.
const TOKEN_TTL_SECONDS = 10 * 60;

export const issueLiveKitToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data))
  .handler(async ({ data, context }) => {
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.LIVEKIT_URL;
    if (!apiKey || !apiSecret || !wsUrl) {
      throw new Error("LIVEKIT_NOT_CONFIGURED");
    }
    // Force identity to the authenticated user; never trust client.
    const identity = context.userId;
    // Resolve room and owner server-side via privileged client so internal
    // livekit_room identifiers never need to be exposed to the browser.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: live } = await supabaseAdmin
      .from("lives")
      .select("livekit_room, stores:store_id(owner_id)")
      .eq("id", data.liveId)
      .maybeSingle();
    const room = (live as { livekit_room?: string } | null)?.livekit_room;
    if (!room) throw new Error("LIVE_NOT_FOUND");
    const ownerId = (live as { stores?: { owner_id?: string } } | null)?.stores?.owner_id;
    const canPublish = !!data.canPublish && !!ownerId && ownerId === context.userId;
    const { recordSecurityEvent, requestAuditMeta } = await import("./audit.server");
    const { getRequest } = await import("@tanstack/react-start/server");
    const meta = requestAuditMeta(getRequest());
    if (data.canPublish && !canPublish) {
      // Someone asked for publish rights on a room they do not own.
      await recordSecurityEvent({
        event: "livekit.publish_denied",
        severity: "warning",
        actorId: context.userId,
        subjectId: data.liveId,
        ...meta,
      });
    }
    // Derive a non-identifying display name from the profile (never the email).
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("id", context.userId)
      .maybeSingle();
    const displayName = (profile?.display_name as string | undefined) ?? "Convidado";
    const { AccessToken } = await import("livekit-server-sdk");
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name: displayName,
      ttl: 60 * 60, // 1h
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish,
      canSubscribe: true,
      canPublishData: true,
    });
    const token = await at.toJwt();
    await recordSecurityEvent({
      event: "livekit.token_issued",
      severity: "info",
      actorId: context.userId,
      subjectId: data.liveId,
      metadata: { canPublish, ttl_seconds: TOKEN_TTL_SECONDS },
      ...meta,
    });
    return { token, url: wsUrl, expiresIn: TOKEN_TTL_SECONDS };
  });