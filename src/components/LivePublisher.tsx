import { useEffect, useRef, useState } from "react";
import {
  AudioPresets,
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  createLocalTracks,
  type LocalTrack,
  type LocalVideoTrack,
  type LocalTrackPublication,
} from "livekit-client";
import { Loader2, Video, VideoOff, Radio, AlertTriangle, Mic, CheckCircle2, ShieldCheck, Activity, Bluetooth } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { issueLiveKitToken } from "@/lib/livekit.functions";
import { createVoiceChain, micConstraints, type AudioChain } from "@/lib/live-audio";
import { startAdaptiveBitrate, type NetworkReport } from "@/lib/live-adaptive";

type Props = {
  liveId: string;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
};

type State = "idle" | "requesting" | "preflight" | "connecting" | "publishing" | "error" | "unconfigured";

const PREVIEW_TIMEOUT_MS = 3_000;
const PUBLISH_TIMEOUT_MS = 8_000;

const MIC_PREF_KEY = "liveteka.micDeviceId";

// Resolução baixa forçada (640x480 @ 15fps) para dispositivos entry-level
// Android. VideoPresets.h480 = 640x480. Reduz drasticamente o consumo do
// encoder por software e evita ecrã preto por timeout do WebRTC.
const LOW_RES = { width: 640, height: 480, frameRate: 15 } as const;
const videoConstraintTiers = [
  { facingMode: "environment", resolution: LOW_RES },
  { facingMode: "user", resolution: LOW_RES },
  { facingMode: undefined, resolution: { width: 480, height: 360, frameRate: 15 } },
] as const;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function waitForVideoReady(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      if (video.videoWidth <= 0) return;
      cleanup();
      void video.play().catch(() => undefined);
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Erro no dispositivo: o preview da câmara não conseguiu reproduzir vídeo."));
    };
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
    video.addEventListener("error", onError);
    void video.play().catch(() => undefined);
    onReady();
  });
}

function getErrorMessage(error: unknown) {
  const err = error as { name?: string; message?: string };
  const name = err?.name ?? "";
  const detail = err?.message || name || String(error);

  if (detail.includes("LIVEKIT_NOT_CONFIGURED")) return "LIVEKIT_NOT_CONFIGURED";
  const prefix = name ? `[${name}] ` : "";
  if (name === "NotAllowedError") return `${prefix}Permissão de câmara/microfone negada. Autorize no browser e recarregue.`;
  if (name === "NotFoundError") return `${prefix}Nenhuma câmara ou microfone encontrado neste dispositivo.`;
  if (name === "NotReadableError") return `${prefix}Câmara/microfone em uso por outra aplicação.`;
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError")
    return `${prefix}Formato de vídeo não suportado: ${detail}`;
  if (name === "SecurityError") return `${prefix}Acesso bloqueado (contexto inseguro / HTTPS).`;
  if (detail.startsWith("[")) return detail;
  return `${prefix}${detail}`;
}

export function LivePublisher({ liveId, onConnected, onDisconnected, onError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const roomRef = useRef<Room | null>(null);
  const tracksRef = useRef<LocalTrack[]>([]);
  const audioMeterRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const disconnectedByUserRef = useRef(false);
  const voiceChainRef = useRef<AudioChain | null>(null);
  const adaptiveStopRef = useRef<(() => void) | null>(null);
  const rawMicRef = useRef<LocalAudioTrack | null>(null);
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [micOk, setMicOk] = useState(false);
  const [cameraOk, setCameraOk] = useState(false);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [micId, setMicId] = useState<string>(() => (typeof window === "undefined" ? "" : localStorage.getItem(MIC_PREF_KEY) ?? ""));
  const [noiseGate, setNoiseGate] = useState(true);
  const [net, setNet] = useState<(NetworkReport & { targetKbps: number }) | null>(null);
  const issue = useServerFn(issueLiveKitToken);

  // (1) Pré-aquecimento de permissões: pede acesso à câmara/microfone assim que o
  // componente monta, para que a permissão já esteja concedida quando o utilizador
  // clica em "Ligar câmara". Libertamos os tracks imediatamente — só queremos o prompt.
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
    let cancelled = false;
    (async () => {
      try {
        if (navigator.permissions) {
          try {
            const cam = await navigator.permissions.query({ name: "camera" as PermissionName });
            const mic = await navigator.permissions.query({ name: "microphone" as PermissionName });
            // eslint-disable-next-line no-console
            console.info("[LivePublisher] permissions", { camera: cam.state, microphone: mic.state });
            if (cam.state === "granted" && mic.state === "granted") return;
            if (cam.state === "denied" || mic.state === "denied") return;
          } catch {
            // Permissions API pode não suportar 'camera'/'microphone' — seguimos.
          }
        }
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // Prompt aceite — libertar imediatamente. O clique real irá voltar a pedir sem prompt.
        stream.getTracks().forEach((t) => t.stop());
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn("[LivePublisher] pré-permissão falhou (o utilizador terá o prompt no clique)", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lista de microfones (inclui lapelas/headsets Bluetooth emparelhados).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return;
    const refresh = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setMics(devices.filter((d) => d.kind === "audioinput"));
      } catch {
        // noop
      }
    };
    void refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
  }, []);

  // O noise gate pode ser alternado em direto, sem interromper a transmissão.
  useEffect(() => {
    voiceChainRef.current?.setEnabled(noiseGate);
  }, [noiseGate]);

  const cleanupHardware = async () => {
    if (audioMeterRef.current) {
      cancelAnimationFrame(audioMeterRef.current);
      audioMeterRef.current = null;
    }
    if (adaptiveStopRef.current) {
      adaptiveStopRef.current();
      adaptiveStopRef.current = null;
    }
    if (voiceChainRef.current) {
      await voiceChainRef.current.close();
      voiceChainRef.current = null;
    }
    if (rawMicRef.current) {
      try {
        rawMicRef.current.stop();
      } catch {
        // noop
      }
      rawMicRef.current = null;
    }
    if (audioCtxRef.current) {
      try {
        await audioCtxRef.current.close();
      } catch {
        // noop
      }
      audioCtxRef.current = null;
    }
    tracksRef.current.forEach((track) => {
      try {
        track.detach().forEach((element) => element.remove());
      } catch {
        // noop
      }
      try {
        track.stop();
      } catch {
        // noop
      }
    });
    tracksRef.current = [];
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setAudioLevel(0);
    setMicOk(false);
    setCameraOk(false);
    setNet(null);
  };

  const cleanupRoom = async () => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) await room.disconnect().catch(() => undefined);
  };

  const stop = async () => {
    disconnectedByUserRef.current = true;
    await cleanupRoom();
    await cleanupHardware();
    setErrorMsg(null);
    setState("idle");
    onDisconnected?.();
  };

  const fail = async (error: unknown, notify = true) => {
    // eslint-disable-next-line no-console
    console.error("[LivePublisher] falha", error);
    const message = getErrorMessage(error);
    disconnectedByUserRef.current = true;
    await cleanupRoom();
    await cleanupHardware();
    if (message.includes("LIVEKIT_NOT_CONFIGURED")) {
      setErrorMsg("Streaming não configurado.");
      setState("unconfigured");
    } else {
      setErrorMsg(message);
      setState("error");
    }
    if (notify) onError?.(message);
  };

  const acquireTracks = async (): Promise<LocalTrack[]> => {
    let lastError: unknown;
    for (const tier of videoConstraintTiers) {
      try {
        const tracks = await createLocalTracks({
          audio: micConstraints(micId || undefined),
          video: {
            resolution: tier.resolution,
            facingMode: tier.facingMode,
          },
        });
        if (!tracks.some((t) => t.kind === Track.Kind.Video)) {
          throw new Error("A câmara não devolveu vídeo.");
        }
        if (!tracks.some((t) => t.kind === Track.Kind.Audio)) {
          throw new Error("O microfone não foi encontrado.");
        }
        return tracks;
      } catch (error) {
        // Log técnico completo para diagnóstico no console do browser
        // eslint-disable-next-line no-console
        console.warn("[LivePublisher] createLocalTracks falhou", tier, error);
        lastError = error;
      }
    }
    throw lastError;
  };

  /**
   * Substitui o track de microfone pelo áudio processado (passa-alto + noise
   * gate + compressor) e usa o mesmo grafo para alimentar o medidor de nível.
   */
  const applyVoiceProcessing = (tracks: LocalTrack[], audioTrack: LocalAudioTrack): LocalTrack[] => {
    const chain = createVoiceChain(audioTrack.mediaStreamTrack);
    if (!chain) {
      setMicOk(true);
      return tracks;
    }
    voiceChainRef.current = chain;
    chain.setEnabled(noiseGate);
    rawMicRef.current = audioTrack;
    const processed = new LocalAudioTrack(chain.track, undefined, false);
    const tick = () => {
      const level = chain.level();
      setAudioLevel(level);
      if (level > 0.04) setMicOk(true);
      audioMeterRef.current = requestAnimationFrame(tick);
    };
    audioMeterRef.current = requestAnimationFrame(tick);
    return tracks.map((t) => (t === (audioTrack as unknown as LocalTrack) ? (processed as unknown as LocalTrack) : t));
  };

  const preflight = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      await fail(new Error("Erro no dispositivo: este browser não suporta acesso à câmara."));
      return;
    }

    setErrorMsg(null);
    setMicOk(false);
    setCameraOk(false);
    disconnectedByUserRef.current = false;
    setState("requesting");

    try {
      // Primeira operação assíncrona real após o clique: pedir hardware.
      const tracks = await acquireTracks();
      const videoTrack = tracks.find((track) => track.kind === Track.Kind.Video) as LocalVideoTrack | undefined;
      const audioTrack = tracks.find((track) => track.kind === Track.Kind.Audio) as LocalAudioTrack | undefined;
      if (!videoTrack) throw new Error("Erro no dispositivo: a câmara não iniciou.");
      if (!audioTrack) throw new Error("Erro no dispositivo: o microfone não iniciou.");

      tracksRef.current = applyVoiceProcessing(tracks, audioTrack);
      const video = videoRef.current;
      if (!video) throw new Error("Erro no dispositivo: o preview de vídeo não está disponível.");
      videoTrack.attach(video);
      await withTimeout(
        waitForVideoReady(video),
        PREVIEW_TIMEOUT_MS,
        "Erro no dispositivo: a câmara ligou, mas o vídeo não apareceu em 3 segundos.",
      );

      setCameraOk(true);
      setMicOk(audioTrack.mediaStreamTrack.readyState === "live");
      setState("preflight");
    } catch (error) {
      await fail(error);
    }
  };

  const publish = async () => {
    if (state !== "preflight" || !cameraOk || tracksRef.current.length === 0) return;
    setState("connecting");
    disconnectedByUserRef.current = false;

    try {
      const video = videoRef.current;
      if (!video || video.videoWidth <= 0) {
        throw new Error("Erro no dispositivo: o preview da câmara não está ativo.");
      }

      const { token, url } = await issue({ data: { liveId, canPublish: true } });
      // (4) Log de diagnóstico do token para confirmar validade / expiração.
      try {
        const payload = JSON.parse(atob(token.split(".")[1] ?? ""));
        const now = Math.floor(Date.now() / 1000);
        // eslint-disable-next-line no-console
        console.info("[LivePublisher] livekit token", {
          url,
          iat: payload.iat,
          exp: payload.exp,
          expiresInSec: typeof payload.exp === "number" ? payload.exp - now : null,
          identity: payload.sub,
          room: payload.video?.room,
          canPublish: payload.video?.canPublish,
        });
        if (typeof payload.exp === "number" && payload.exp - now < 30) {
          throw new Error("Erro no dispositivo: token LiveKit já expirou (exp < 30s).");
        }
      } catch (decodeError) {
        // eslint-disable-next-line no-console
        console.warn("[LivePublisher] não foi possível decodificar o token LiveKit", decodeError);
      }
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        publishDefaults: {
          audioPreset: AudioPresets.speech,
          dtx: true,
          red: true,
          // Simulcast desativado em hardware fraco: cada camada extra é um
          // encoder VP8 por software adicional — causa freeze / ecrã preto.
          simulcast: false,
          videoCodec: "vp8",
          videoEncoding: { maxBitrate: 350_000, maxFramerate: 15 },
          degradationPreference: "maintain-framerate",
        },
        videoCaptureDefaults: { resolution: { width: 640, height: 480, frameRate: 15 } },
      });
      roomRef.current = room;
      room.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        if (disconnectedByUserRef.current) return;
        setState("idle");
        onDisconnected?.();
      });

      await withTimeout(room.connect(url, token), PUBLISH_TIMEOUT_MS, "Erro no dispositivo: a ligação ao servidor de vídeo demorou demasiado.");
      const publications = await withTimeout(
        Promise.all(
          tracksRef.current.map((track) =>
            room.localParticipant.publishTrack(track, {
              source: track.kind === Track.Kind.Video ? Track.Source.Camera : Track.Source.Microphone,
              stream: `live-${liveId}`,
            }),
          ),
        ),
        PUBLISH_TIMEOUT_MS,
        "Erro no dispositivo: a transmissão não começou dentro do tempo esperado.",
      );

      const videoPublication = publications.find((publication: LocalTrackPublication) => publication.kind === Track.Kind.Video);
      if (!videoPublication || videoPublication.isMuted || !videoPublication.track) {
        throw new Error("Erro no dispositivo: o vídeo não foi publicado na sala da live.");
      }
      if (room.state !== ConnectionState.Connected) {
        throw new Error("Erro no dispositivo: a sala de vídeo não confirmou ligação ativa.");
      }

      setState("publishing");
      onConnected?.();
      // Bitrate adaptativo: prioriza a voz, degrada o vídeo em rede fraca.
      const publishedVideo = videoPublication.track as LocalVideoTrack;
      adaptiveStopRef.current = startAdaptiveBitrate(publishedVideo, setNet);
    } catch (error) {
      // (3) Log técnico específico da conexão LiveKit para o debug pedido.
      // eslint-disable-next-line no-console
      console.error("[LivePublisher] connectToLiveKit failed", error);
      await fail(error);
    }
  };

  useEffect(() => {
    return () => {
      disconnectedByUserRef.current = true;
      void cleanupRoom();
      void cleanupHardware();
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
        {(state === "idle" || state === "requesting" || state === "error" || state === "unconfigured") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-4 text-center text-white/85">
            {state === "idle" && <><Video /><p className="text-sm">Câmara desligada</p></>}
            {state === "requesting" && <><Loader2 className="animate-spin" /><p className="text-sm">A ligar câmara e microfone…</p></>}
            {state === "error" && <><AlertTriangle className="text-yellow-400" /><p className="text-sm font-medium">Falha ao iniciar vídeo</p><p className="text-[11px] text-white/70">{errorMsg}</p></>}
            {state === "unconfigured" && <><Video /><p className="text-sm">Streaming não configurado</p></>}
          </div>
        )}
        {state === "preflight" && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-1 text-[10px] font-bold text-white">
            <ShieldCheck size={11} /> CÂMARA OK
          </div>
        )}
        {state === "connecting" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/45 text-white">
            <Loader2 className="animate-spin" />
            <p className="text-sm">A publicar transmissão…</p>
          </div>
        )}
        {state === "publishing" && (
          <div className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold text-white">
            <Radio size={11} /> AO VIVO
          </div>
        )}
      </div>

      {(state === "preflight" || state === "connecting") && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
          <div className="flex items-center gap-2 text-xs">
            <CheckCircle2 size={14} className="text-green-500" />
            <span>Câmara ativa no ecrã</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            {micOk ? <CheckCircle2 size={14} className="text-green-500" /> : <Mic size={14} className="text-muted-foreground" />}
            <span>{micOk ? "Microfone ativo" : "Fale para testar o microfone…"}</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-background">
            <div
              className={`h-full transition-[width] duration-75 ${micOk ? "bg-green-500" : "bg-primary"}`}
              style={{ width: `${Math.max(6, Math.round(audioLevel * 100))}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            O estado AO VIVO só é gravado depois de o LiveKit confirmar a publicação do vídeo.
          </p>
        </div>
      )}

      <div className="flex gap-2">
        {state === "publishing" ? (
          <button onClick={stop} className="flex-1 rounded-full bg-destructive px-4 py-3 text-sm font-semibold text-destructive-foreground">
            <VideoOff size={16} className="mr-2 inline" /> Parar transmissão
          </button>
        ) : state === "preflight" ? (
          <>
            <button onClick={stop} className="rounded-full border border-border bg-background px-4 py-3 text-sm font-semibold">
              Cancelar
            </button>
            <button onClick={publish} disabled={!cameraOk} className="flex-1 rounded-full bg-red-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">
              <Radio size={16} className="mr-2 inline" /> Iniciar
            </button>
          </>
        ) : state === "connecting" ? (
          <button disabled className="flex-1 rounded-full bg-primary/60 px-4 py-3 text-sm font-semibold text-primary-foreground">
            <Loader2 size={16} className="mr-2 inline animate-spin" /> A publicar…
          </button>
        ) : (
          <button onClick={preflight} disabled={state === "requesting"} className="flex-1 rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            <Video size={16} className="mr-2 inline" /> Ligar câmara
          </button>
        )}
      </div>
    </div>
  );
}