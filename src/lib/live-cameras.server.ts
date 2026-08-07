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
export function ingressStatus(info: IngressInfo | undefined | null): { status: string; error: string | null } {
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
      encodingOptions: { case: "preset", value: IngressVideoEncodingPreset.H264_720P_30FPS_1_LAYER },
    }),
  };
}

/** Normaliza e valida a URL de uma câmara IP na rede da loja. */
export function normalizeSourceUrl(sourceType: string, raw: string | undefined): string | undefined {
  if (sourceType !== "rtsp") return undefined;
  const url = (raw ?? "").trim();
  if (!/^(rtsp|rtsps|http|https):\/\//i.test(url)) {
    throw new Error("URL inválida: use rtsp://utilizador:senha@ip:554/stream");
  }
  return url;
}