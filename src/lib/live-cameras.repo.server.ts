import type { LiveCameraDTO } from "@/lib/live-cameras.functions";
import {
  ingressClient,
  ingressEncoding,
  ingressStatus,
  inputTypeFor,
  livekitConfig,
  normalizeSourceUrl,
  roomClient,
} from "@/lib/live-cameras.server";

export type OwnedLive = { id: string; storeId: string; room: string; activeCameraId: string | null; ownerId: string };

type CameraRow = {
  id: string;
  label: string;
  source_type: string;
  source_url: string | null;
  ingress_id: string | null;
  ingress_url: string | null;
  stream_key: string | null;
  participant_identity: string;
  status: string;
  last_error: string | null;
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
    sourceUrl: row.source_url,
    ingressId: row.ingress_id,
    ingressUrl: row.ingress_url,
    streamKey: row.stream_key,
    participantIdentity: row.participant_identity,
    status: row.status,
    lastError: row.last_error,
    isActive: activeCameraId === row.id,
  };
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
        if (next.status !== row.status || (next.error ?? null) !== row.last_error) {
          row.status = next.status;
          row.last_error = next.error;
          await db
            .from("live_cameras")
            .update({ status: next.status, last_error: next.error })
            .eq("id", row.id);
        }
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

  return { cameras: rows.map((r) => toDTO(r, activeCameraId)), activeCameraId };
}

/** Regista uma nova fonte de vídeo externa (câmara IP RTSP/ONVIF, RTMP ou WHIP). */
export async function addCamera(
  live: OwnedLive,
  input: { label: string; sourceType: "rtsp" | "rtmp" | "whip"; sourceUrl?: string },
) {
  const db = await admin();
  const sourceUrl = normalizeSourceUrl(input.sourceType, input.sourceUrl);
  if (input.sourceType === "rtsp" && !sourceUrl) throw new Error("URL RTSP em falta");

  const { data: inserted, error } = await db
    .from("live_cameras")
    .insert({
      live_id: live.id,
      store_id: live.storeId,
      label: input.label,
      source_type: input.sourceType,
      source_url: sourceUrl ?? null,
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
      ...(row.source_type === "rtsp" ? { url: row.source_url ?? undefined } : {}),
      audio,
      video,
    });
    const state = ingressStatus(info);
    const patch = {
      ingress_id: info.ingressId,
      ingress_url: info.url ?? null,
      stream_key: info.streamKey ?? null,
      status: row.source_type === "rtsp" ? "connecting" : state.status,
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
  if (row.source_type === "phone") throw new Error("A câmara do telemóvel liga-se pelo botão de transmissão.");
  return provisionIngress(live, row);
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
  const patch = { ingress_id: null, ingress_url: null, stream_key: null, status: "idle", last_error: null };
  await db.from("live_cameras").update(patch).eq("id", row.id);
  return toDTO({ ...row, ...patch }, live.activeCameraId);
}

export async function removeCamera(cameraId: string, userId: string) {
  const { row } = await requireCameraOwner(cameraId, userId);
  const db = await admin();
  if (row.ingress_id) {
    try {
      await ingressClient(livekitConfig()).deleteIngress(row.ingress_id);
    } catch {
      // noop
    }
  }
  await db.from("live_cameras").delete().eq("id", row.id);
}

/**
 * Alterna a fonte em direto: actualiza a live na BD (os espetadores reagem via
 * Realtime) e escreve os metadados da sala LiveKit para clientes nativos.
 * A sala nunca é desligada — apenas muda a fonte apresentada.
 */
export async function switchCamera(live: OwnedLive, cameraId: string) {
  const db = await admin();
  const { data } = await db
    .from("live_cameras")
    .select("id, participant_identity, live_id")
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
    await roomClient(cfg).updateRoomMetadata(live.room, JSON.stringify({ activeIdentity: identity, activeCameraId: cameraId }));
  } catch {
    // sala ainda sem sessão activa — o estado na BD é a fonte de verdade.
  }
  return { activeCameraId: cameraId, activeIdentity: identity };
}