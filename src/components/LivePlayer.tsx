import { useCallback, useEffect, useRef, useState } from "react";
import { Room, RoomEvent, ConnectionState, Track, type RemoteTrack, type RemoteTrackPublication, type RemoteParticipant } from "livekit-client";
import { Loader2, Video, WifiOff, AlertTriangle } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { issueLiveKitToken } from "@/lib/livekit.functions";
import { supabase } from "@/integrations/supabase/client";

type Props = { liveId: string };

type State = "connecting" | "reconnecting" | "live" | "waiting" | "error" | "unconfigured";

/**
 * Player LiveKit isolado do chat — falhas/reconexões aqui não
 * bloqueiam o restante da UI (chat e produtos continuam reativos).
 */
export function LivePlayer({ liveId }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioHostRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<Room | null>(null);
  // Multi-cam: mantemos todas as fontes subscritas e apenas trocamos a que
  // está anexada ao <video>, para que a alternância seja instantânea e sem
  // interromper a transmissão nem o áudio do locutor.
  const videoTracksRef = useRef<Map<string, RemoteTrack>>(new Map());
  const activeIdentityRef = useRef<string | null>(null);
  const [state, setState] = useState<State>("connecting");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const issue = useServerFn(issueLiveKitToken);

  const attachActive = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const map = videoTracksRef.current;
    if (map.size === 0) {
      setState((s) => (s === "error" || s === "unconfigured" ? s : "waiting"));
      return;
    }
    const wanted = activeIdentityRef.current;
    const track = (wanted && map.get(wanted)) || map.values().next().value;
    if (!track) return;
    // detach() de outros tracks evita dois vídeos a decodificar no mesmo elemento
    map.forEach((t) => { if (t !== track) t.detach(video); });
    track.attach(video);
    void video.play().catch(() => undefined);
    setState("live");
  }, []);

  useEffect(() => {
    let cancelled = false;
    const room = new Room({
      adaptiveStream: true, // mobile-friendly: ajusta resolução à viewport
      dynacast: true,
    });
    roomRef.current = room;

    const onSubscribed = (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        videoTracksRef.current.set(participant.identity, track);
        attachActive();
      } else if (track.kind === Track.Kind.Audio && audioHostRef.current) {
        // Todas as fontes de áudio ficam activas: a voz do locutor (microfone
        // Bluetooth do telemóvel) continua audível mesmo com a câmara da loja no ar.
        const el = track.attach() as HTMLAudioElement;
        el.autoplay = true;
        el.dataset["identity"] = participant.identity;
        audioHostRef.current.appendChild(el);
      }
    };
    const onUnsubscribed = (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) {
        videoTracksRef.current.delete(participant.identity);
        track.detach().forEach((el) => { if (el !== videoRef.current) el.remove(); });
        attachActive();
      } else {
        track.detach().forEach((el) => el.remove());
      }
    };
    const onStateChange = (s: ConnectionState) => {
      if (cancelled) return;
      if (s === ConnectionState.Reconnecting) setState("reconnecting");
      else if (s === ConnectionState.Connected) {
        setState(videoTracksRef.current.size > 0 ? "live" : "waiting");
      } else if (s === ConnectionState.Disconnected) setState("reconnecting");
    };
    const onMetadata = (metadata: string | undefined) => {
      if (!metadata) return;
      try {
        const parsed = JSON.parse(metadata) as { activeIdentity?: string };
        if (parsed.activeIdentity) {
          activeIdentityRef.current = parsed.activeIdentity;
          attachActive();
        }
      } catch {
        // metadados não-JSON — ignorar
      }
    };

    room
      .on(RoomEvent.TrackSubscribed, onSubscribed)
      .on(RoomEvent.TrackUnsubscribed, onUnsubscribed)
      .on(RoomEvent.RoomMetadataChanged, onMetadata)
      .on(RoomEvent.ConnectionStateChanged, onStateChange);

    (async () => {
      try {
        const { data: liveRow } = await supabase.from("lives").select("active_identity").eq("id", liveId).maybeSingle();
        if (liveRow?.active_identity) activeIdentityRef.current = liveRow.active_identity;
        const { token, url } = await issue({ data: { liveId, canPublish: false } });
        if (cancelled) return;
        await room.connect(url, token, { autoSubscribe: true });
        if (cancelled) return;
        onMetadata(room.metadata);
        setState(videoTracksRef.current.size > 0 ? "live" : "waiting");
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("LIVEKIT_NOT_CONFIGURED")) {
          setState("unconfigured");
        } else {
          setErrorMsg(msg);
          setState("error");
        }
      }
    })();

    // Realtime: o lojista alterna a câmara → a live actualiza active_identity.
    const ch = supabase
      .channel(`live-cam-${liveId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lives", filter: `id=eq.${liveId}` }, (payload) => {
        const next = (payload.new as { active_identity?: string | null }).active_identity ?? null;
        if (next && next !== activeIdentityRef.current) {
          activeIdentityRef.current = next;
          attachActive();
        }
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
      videoTracksRef.current.clear();
      room.disconnect().catch(() => {});
      roomRef.current = null;
    };
  }, [liveId, issue, attachActive]);

  return (
    <>
      <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-cover" />
      <div ref={audioHostRef} className="hidden" aria-hidden />
      {state !== "live" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 text-center text-white/85">
          {state === "connecting" && <><Loader2 className="animate-spin" /> <p className="text-sm">Conectando ao stream…</p></>}
          {state === "reconnecting" && <><WifiOff /> <p className="text-sm">Reconectando…</p><p className="text-[11px] text-white/60">Sua conexão oscilou. O chat continua ativo.</p></>}
          {state === "waiting" && <><Video /> <p className="text-sm">Aguardando o lojista iniciar a transmissão</p></>}
          {state === "error" && <><AlertTriangle className="text-yellow-400" /><p className="text-sm">Falha no stream</p><p className="text-[11px] text-white/60">{errorMsg}</p></>}
          {state === "unconfigured" && <><Video /><p className="text-sm">Streaming não configurado</p><p className="text-[11px] text-white/60">Adicione as credenciais LiveKit nos secrets.</p></>}
        </div>
      )}
    </>
  );
}