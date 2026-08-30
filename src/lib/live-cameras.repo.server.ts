import type { LiveCameraDTO } from "@/lib/live-cameras.functions";
import {
  ingressClient,
  ingressEncoding,
  ingressStatus,
  ingressTelemetry,
  inputTypeFor,
  livekitConfig,
  roomClient,
} from "@/lib/live-cameras.server";

export type OwnedLive = {
  id: string;
  storeId: string;
  room: string;
  activeCameraId: string | null;
  ownerId: string;
};

type CameraRow = {
  id: string;
  label: string;
  source_type: string;
  ingress_id: string | null;
  ingress_url: string | null;
  stream_key: string | null;
  participant_identity: string;
  status: string;
  last_error: string | null;
  last_stats?: Record<string, unknown> | null;
  last_seen_at?: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function toDTO(row: CameraRow, activeCameraId: string | null): LiveCameraDTO {
  return {
    id: row.id,
    label: row.label,
    sourceType: row.source_type as LiveCameraDTO["sourceType"],
    ingressId: row.ingress_id,
    ingressUrl: row.ingress_url,
    streamKey: row.stream_key,
    participantIdentity: row.participant_identity,
    status: row.status,
    lastError: row.last_error,
    isActive: activeCameraId === row.id,
    stats: (row.last_stats as LiveCameraDTO["stats"]) ?? null,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

/** Regista um evento de auditoria da live (nunca falha o fluxo principal). */
export async function logLiveEvent(input: {
  liveId: string | null;
  storeId: string;
  cameraId?: string | null;
  actorId?: string | null;
  kind: string;
  level?: "info" | "warn" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    const db = await admin();
    await db.from("live_events").insert({
      live_id: input.liveId,
      store_id: input.storeId,
      camera_id: input.cameraId ?? null,
      actor_id: input.actorId ?? null,
      kind: input.kind,
      level: input.level ?? "info",
      message: input.message,
      metadata: (input.metadata ?? {}) as never,
    });
  } catch {
    // auditoria best-effort
  }
}

/** Garante que o utilizador autenticado é o dono da loja desta live. */
export async function requireLiveOwner(liveId: string, userId: string): Promise<OwnedLive> {
  const db = await admin();
  const { data } = await db
    .from("lives")
    .select("id, store_id, livekit_room, active_camera_id, stores:store_id(owner_id)")
    .eq("id", liveId)
    .maybeSingle();
  if (!data) throw new Error("LIVE_NOT_FOUND");
  const ownerId = (data as unknown as { stores?: { owner_id?: string } }).stores?.owner_id;
  if (!ownerId || ownerId !== userId) throw new Error("FORBIDDEN");
  return {
    id: data.id,
    storeId: data.store_id,
    room: data.livekit_room,
    activeCameraId: data.active_camera_id ?? null,
    ownerId,
  };
}

async function requireCameraOwner(cameraId: string, userId: string) {
  const db = await admin();
  const { data } = await db.from("live_cameras").select("*").eq("id", cameraId).maybeSingle();
  if (!data) throw new Error("CAMERA_NOT_FOUND");
  if (!data.live_id) throw new Error("CAMERA_NOT_FOUND");
  const live = await requireLiveOwner(data.live_id, userId);
  return { row: data as unknown as CameraRow, live };
}

/**
 * Lista as câmaras da live, garantindo a existência da câmara "telemóvel"
 * (a que o lojista publica pelo browser) e sincronizando o estado real dos
 * ingresses LiveKit das câmaras IP.
 */
export async function loadCameras(live: OwnedLive, userId: string) {
  const db = await admin();
  const { data } = await db
    .from("live_cameras")
    .select("*")
    .eq("live_id", live.id)
    .order("created_at", { ascending: true });
  let rows = (data ?? []) as unknown as CameraRow[];

  if (!rows.some((r) => r.source_type === "phone")) {
    const { data: inserted } = await db
      .from("live_cameras")
      .insert({
        live_id: live.id,
        store_id: live.storeId,
        label: "Telemóvel (plano detalhe)",
        source_type: "phone",
        participant_identity: userId,
        status: "idle",
      })
      .select("*")
      .single();
    if (inserted) rows = [inserted as unknown as CameraRow, ...rows];
  }

  // Sincroniza estado real dos ingresses (câmaras IP) com a base de dados.
  const withIngress = rows.filter((r) => r.ingress_id);
  if (withIngress.length) {
    try {
      const cfg = livekitConfig();
      const list = await ingressClient(cfg).listIngress({ roomName: live.room });
      for (const row of withIngress) {
        const info = list.find((i) => i.ingressId === row.ingress_id);
        const next = ingressStatus(info);
        const stats = ingressTelemetry(info);
        const changed = next.status !== row.status || (next.error ?? null) !== row.last_error;
        if (changed && next.status === "error") {
          await logLiveEvent({
            liveId: live.id,
            storeId: live.storeId,
            cameraId: row.id,
            actorId: userId,
            kind: "camera_error",
            level: "error",
            message: `Falha na câmara "${row.label}": ${next.error ?? "erro desconhecido"}`,
            metadata: { sourceType: row.source_type },
          });
        } else if (changed) {
          await logLiveEvent({
            liveId: live.id,
            storeId: live.storeId,
            cameraId: row.id,
            actorId: userId,
            kind: "camera_status",
            level: "info",
            message: `Câmara "${row.label}" mudou para ${next.status}`,
            metadata: { from: row.status, to: next.status },
          });
        }
        row.status = next.status;
        row.last_error = next.error;
        row.last_stats = stats as unknown as Record<string, unknown>;
        row.last_seen_at = stats.updatedAt;
        await db
          .from("live_cameras")
          .update({
            status: next.status,
            last_error: next.error,
            last_stats: stats as never,
            last_seen_at: stats.updatedAt,
          })
          .eq("id", row.id);
      }
    } catch {
      // LiveKit indisponível — devolvemos o último estado conhecido.
    }
  }

  let activeCameraId = live.activeCameraId;
  if (!activeCameraId && rows.length) {
    const phone = rows.find((r) => r.source_type === "phone") ?? rows[0];
    activeCameraId = phone.id;
    await db
      .from("lives")
      .update({ active_camera_id: phone.id, active_identity: phone.participant_identity })
      .eq("id", live.id);
  }

  // Failover automático: se a fonte no ar falhou, passa para outra saudável.
  const active = rows.find((r) => r.id === activeCameraId);
  if (active && active.status === "error") {
    const healthy =
      rows.find((r) => r.id !== active.id && r.status === "publishing") ??
      rows.find((r) => r.id !== active.id && r.source_type === "phone");
    if (healthy) {
      await db
        .from("lives")
        .update({
          active_camera_id: healthy.id,
          active_identity: healthy.participant_identity,
        })
        .eq("id", live.id);
      activeCameraId = healthy.id;
      await logLiveEvent({
        liveId: live.id,
        storeId: live.storeId,
        cameraId: healthy.id,
        actorId: userId,
        kind: "camera_failover",
        level: "warn",
        message: `Failover automático: "${active.label}" falhou, no ar "${healthy.label}"`,
        metadata: { from: active.id, to: healthy.id },
      });
    }
  }

  return { cameras: rows.map((r) => toDTO(r, activeCameraId)), activeCameraId };
}

/** Guarda telemetria real medida pelo publisher (câmara do telemóvel). */
export async function saveCameraTelemetry(
  liveId: string,
  userId: string,
  stats: Record<string, unknown>,
) {
  const db = await admin();
  const { data } = await db
    .from("live_cameras")
    .select("id")
    .eq("live_id", liveId)
    .eq("source_type", "phone")
    .maybeSingle();
  if (!data) return { ok: false as const };
  const now = new Date().toISOString();
  await db
    .from("live_cameras")
    .update({
      last_stats: { ...stats, online: true, ingestActive: true, updatedAt: now } as never,
      last_seen_at: now,
      status: "publishing",
      last_error: null,
    })
    .eq("id", data.id);
  return { ok: true as const };
}

/**
 * Regista uma nova fonte externa (encoder RTMPS ou WHIP). O servidor nunca
 * recebe uma URL de origem: é o LiveKit que emite o destino de ingestão e a
 * chave temporária, pelo que não existe superfície de SSRF nem credenciais
 * de câmara guardadas.
 */
export async function addCamera(
  live: OwnedLive,
  input: { label: string; sourceType: "rtmp" | "whip" },
) {
  const db = await admin();

  const { data: inserted, error } = await db
    .from("live_cameras")
    .insert({
      live_id: live.id,
      store_id: live.storeId,
      label: input.label,
      source_type: input.sourceType,
      participant_identity: "pending",
      status: "idle",
    })
    .select("*")
    .single();
  if (error || !inserted) throw new Error(error?.message ?? "Não foi possível criar a câmara");

  const identity = `cam-${inserted.id.slice(0, 8)}`;
  await db.from("live_cameras").update({ participant_identity: identity }).eq("id", inserted.id);

  const row = { ...(inserted as unknown as CameraRow), participant_identity: identity };
  return provisionIngress(live, row);
}

/** Cria (ou recria) o ingress LiveKit que capta o stream real da câmara. */
async function provisionIngress(live: OwnedLive, row: CameraRow): Promise<LiveCameraDTO> {
  const db = await admin();
  const cfg = livekitConfig();
  const client = ingressClient(cfg);

  if (row.ingress_id) {
    try {
      await client.deleteIngress(row.ingress_id);
    } catch {
      // ingress já removido
    }
  }

  try {
    const { audio, video } = ingressEncoding();
    const info = await client.createIngress(inputTypeFor(row.source_type), {
      name: row.label,
      roomName: live.room,
      participantIdentity: row.participant_identity,
      participantName: row.label,
      enableTranscoding: row.source_type !== "whip",
      audio,
      video,
    });
    const state = ingressStatus(info);
    const patch = {
      ingress_id: info.ingressId,
      ingress_url: info.url ?? null,
      stream_key: info.streamKey ?? null,
      status: state.status,
      last_error: state.error,
    };
    await db.from("live_cameras").update(patch).eq("id", row.id);
    return toDTO({ ...row, ...patch }, live.activeCameraId);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("live_cameras").update({ status: "error", last_error: message }).eq("id", row.id);
    throw new Error(`Falha ao ligar à câmara: ${message}`);
  }
}

export async function startCamera(cameraId: string, userId: string) {
  const { row, live } = await requireCameraOwner(cameraId, userId);
  if (row.source_type === "phone")
    throw new Error("A câmara do telemóvel liga-se pelo botão de transmissão.");
  const dto = await provisionIngress(live, row);
  await logLiveEvent({
    liveId: live.id,
    storeId: live.storeId,
    cameraId: row.id,
    actorId: userId,
    kind: "camera_start",
    message: `Câmara "${row.label}" ligada`,
    metadata: { sourceType: row.source_type },
  });
  return dto;
}

export async function stopCamera(cameraId: string, userId: string) {
  const { row, live } = await requireCameraOwner(cameraId, userId);
  const db = await admin();
  if (row.ingress_id) {
    try {
      await ingressClient(livekitConfig()).deleteIngress(row.ingress_id);
    } catch {
      // já parado
    }
  }
  const patch = {
    ingress_id: null,
    ingress_url: null,
    stream_key: null,
    status: "idle",
    last_error: null,
  };
  await db.from("live_cameras").update(patch).eq("id", row.id);
  await logLiveEvent({
    liveId: live.id,
    storeId: live.storeId,
    cameraId: row.id,
    actorId: userId,
    kind: "camera_stop",
    message: `Câmara "${row.label}" parada`,
  });
  return toDTO({ ...row, ...patch }, live.activeCameraId);
}

export async function removeCamera(cameraId: string, userId: string) {
  const { row, live } = await requireCameraOwner(cameraId, userId);
  const db = await admin();
  if (row.ingress_id) {
    try {
      await ingressClient(livekitConfig()).deleteIngress(row.ingress_id);
    } catch {
      // noop
    }
  }
  await db.from("live_cameras").delete().eq("id", row.id);
  await logLiveEvent({
    liveId: live.id,
    storeId: live.storeId,
    actorId: userId,
    kind: "camera_remove",
    level: "warn",
    message: `Câmara "${row.label}" removida`,
  });
}

/**
 * Alterna a fonte em direto: actualiza a live na BD (os espetadores reagem via
 * Realtime) e escreve os metadados da sala LiveKit para clientes nativos.
 * A sala nunca é desligada — apenas muda a fonte apresentada.
 */
export async function switchCamera(live: OwnedLive, cameraId: string, userId?: string) {
  const db = await admin();
  const { data } = await db
    .from("live_cameras")
    .select("id, participant_identity, live_id, label")
    .eq("id", cameraId)
    .maybeSingle();
  if (!data || data.live_id !== live.id) throw new Error("CAMERA_NOT_FOUND");
  const identity = data.participant_identity;
  await db
    .from("lives")
    .update({ active_camera_id: cameraId, active_identity: identity })
    .eq("id", live.id);
  try {
    const cfg = livekitConfig();
    await roomClient(cfg).updateRoomMetadata(
      live.room,
      JSON.stringify({ activeIdentity: identity, activeCameraId: cameraId }),
    );
  } catch {
    // sala ainda sem sessão activa — o estado na BD é a fonte de verdade.
  }
  await logLiveEvent({
    liveId: live.id,
    storeId: live.storeId,
    cameraId,
    actorId: userId ?? null,
    kind: "camera_switch",
    message: `Fonte no ar: "${(data as { label?: string }).label ?? cameraId}"`,
    metadata: { previous: live.activeCameraId, next: cameraId },
  });
  return { activeCameraId: cameraId, activeIdentity: identity };
}

/**
 * Encerra a live: apaga os ingresses (revoga as chaves de ingestão), desliga
 * a sala LiveKit (invalidando as sessões dos participantes) e marca o estado
 * final na base de dados.
 */
export async function endLiveSession(live: OwnedLive, userId: string) {
  const db = await admin();
  const { data: cams } = await db
    .from("live_cameras")
    .select("id, ingress_id")
    .eq("live_id", live.id);
  let cfg: ReturnType<typeof livekitConfig> | null = null;
  try {
    cfg = livekitConfig();
  } catch {
    cfg = null;
  }
  if (cfg) {
    for (const cam of cams ?? []) {
      if (!cam.ingress_id) continue;
      try {
        await ingressClient(cfg).deleteIngress(cam.ingress_id);
      } catch {
        // já removido
      }
    }
    try {
      await roomClient(cfg).deleteRoom(live.room);
    } catch {
      // sala já encerrada
    }
  }
  await db
    .from("live_cameras")
    .update({ ingress_id: null, ingress_url: null, stream_key: null, status: "idle" })
    .eq("live_id", live.id);
  await db
    .from("lives")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", live.id);
  await logLiveEvent({
    liveId: live.id,
    storeId: live.storeId,
    actorId: userId,
    kind: "live_end",
    level: "warn",
    message: "Live encerrada: sala LiveKit destruída e chaves de ingestão revogadas",
    metadata: { revokedIngresses: (cams ?? []).filter((c) => c.ingress_id).length },
  });
  return { ok: true as const };
}
