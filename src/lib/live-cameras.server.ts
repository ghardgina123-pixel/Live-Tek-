import {
  IngressAudioEncodingPreset,
  IngressAudioOptions,
  IngressInput,
  IngressVideoEncodingPreset,
  IngressVideoOptions,
  IngressClient,
  RoomServiceClient,
  type IngressInfo,
} from "livekit-server-sdk";

export type LiveKitConfig = { apiKey: string; apiSecret: string; wsUrl: string; httpUrl: string };

/** Lê a configuração LiveKit (apenas dentro de handlers de servidor). */
export function livekitConfig(): LiveKitConfig {
  const apiKey = process.env["LIVEKIT_API_KEY"];
  const apiSecret = process.env["LIVEKIT_API_SECRET"];
  const wsUrl = process.env["LIVEKIT_URL"];
  if (!apiKey || !apiSecret || !wsUrl) throw new Error("LIVEKIT_NOT_CONFIGURED");
  const httpUrl = wsUrl.replace(/^ws/, "http");
  return { apiKey, apiSecret, wsUrl, httpUrl };
}

export function ingressClient(cfg: LiveKitConfig) {
  return new IngressClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
}

export function roomClient(cfg: LiveKitConfig) {
  return new RoomServiceClient(cfg.httpUrl, cfg.apiKey, cfg.apiSecret);
}

/** Mapeia o estado numérico do Ingress para um estado legível guardado na BD. */
export function ingressStatus(info: IngressInfo | undefined | null): {
  status: string;
  error: string | null;
} {
  const status = info?.state?.status;
  switch (status) {
    case 2:
      return { status: "publishing", error: null };
    case 1:
      return { status: "buffering", error: null };
    case 3:
      return { status: "error", error: info?.state?.error ?? "Falha no ingress" };
    default:
      return { status: "idle", error: info?.state?.error ?? null };
  }
}

export function inputTypeFor(sourceType: string): IngressInput {
  if (sourceType === "whip") return IngressInput.WHIP_INPUT;
  if (sourceType === "rtmp") return IngressInput.RTMP_INPUT;
  return IngressInput.URL_INPUT; // RTSP / HLS / HTTP pull (gstreamer uridecodebin)
}

export type CameraTelemetry = {
  online: boolean;
  ingestActive: boolean;
  bitrateKbps: number | null;
  audioBitrateKbps: number | null;
  fps: number | null;
  width: number | null;
  height: number | null;
  codec: string | null;
  uptimeSec: number | null;
  latencyMs: number | null;
  updatedAt: string;
};

/** Extrai telemetria real do estado do Ingress LiveKit (sem valores fictícios). */
export function ingressTelemetry(info: IngressInfo | undefined | null): CameraTelemetry {
  const st = info?.state;
  const video = st?.video;
  const audio = st?.audio as { averageBitrate?: number } | undefined;
  const startedAt = st?.startedAt ? Number(st.startedAt) : 0;
  const updatedAt = st?.updatedAt ? Number(st.updatedAt) : 0;
  const nowNs = Date.now() * 1e6;
  return {
    online: st?.status === 2 || st?.status === 1,
    ingestActive: st?.status === 2,
    bitrateKbps: video?.averageBitrate ? Math.round(video.averageBitrate / 1000) : null,
    audioBitrateKbps: audio?.averageBitrate ? Math.round(audio.averageBitrate / 1000) : null,
    fps: video?.framerate ? Math.round(video.framerate) : null,
    width: video?.width || null,
    height: video?.height || null,
    codec: video?.mimeType || null,
    uptimeSec: startedAt ? Math.max(0, Math.round((nowNs - startedAt) / 1e9)) : null,
    // Atraso entre a última actualização de estado reportada pelo servidor e agora.
    latencyMs: updatedAt ? Math.max(0, Math.round((nowNs - updatedAt) / 1e6)) : null,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Perfis de encoding conservadores: a prioridade da plataforma é a voz do
 * locutor, por isso o áudio fica em estéreo 96k e o vídeo em 720p 30fps
 * (o LiveKit degrada automaticamente para os espetadores em rede fraca).
 */
export function ingressEncoding() {
  return {
    audio: new IngressAudioOptions({
      name: "audio",
      encodingOptions: { case: "preset", value: IngressAudioEncodingPreset.OPUS_MONO_64KBS },
    }),
    video: new IngressVideoOptions({
      name: "video",
      encodingOptions: {
        case: "preset",
        value: IngressVideoEncodingPreset.H264_720P_30FPS_1_LAYER,
      },
    }),
  };
}

/** Normaliza e valida a URL de uma câmara IP na rede da loja. */
export function normalizeSourceUrl(
  sourceType: string,
  raw: string | undefined,
): string | undefined {
  if (sourceType !== "rtsp") return undefined;
  const url = (raw ?? "").trim();
  if (!/^(rtsp|rtsps|http|https):\/\//i.test(url)) {
    throw new Error("URL inválida: use rtsp://utilizador:senha@ip:554/stream");
  }
  return url;
}
