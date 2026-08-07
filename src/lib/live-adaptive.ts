import type { LocalVideoTrack } from "livekit-client";

export type NetworkReport = { rttMs: number; lossPct: number; bitrateKbps: number };

const MAX_BITRATE = 700_000;
const MIN_BITRATE = 90_000;

/**
 * Controlador adaptativo: mede RTT e perda de pacotes do envio de vídeo e
 * reduz o bitrate de vídeo quando a rede da loja degrada — o áudio nunca é
 * tocado, garantindo que a voz do locutor se mantém cristalina e sincronizada.
 */
export function startAdaptiveBitrate(
  videoTrack: LocalVideoTrack,
  onReport: (report: NetworkReport & { targetKbps: number }) => void,
) {
  let current = 350_000;
  let stopped = false;
  let lastBytes = 0;
  let lastTs = 0;
  let lastLost = 0;
  let lastPackets = 0;

  const apply = async (next: number) => {
    const sender = (videoTrack as unknown as { sender?: RTCRtpSender }).sender;
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    params.encodings.forEach((e) => {
      e.maxBitrate = next;
    });
    try {
      await sender.setParameters(params);
      current = next;
    } catch {
      // o browser pode rejeitar a alteração — tentamos no próximo ciclo
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const stats = await videoTrack.getRTCStatsReport();
      let rttMs = 0;
      let bitrateKbps = 0;
      let lossPct = 0;
      stats?.forEach((report) => {
        const r = report as unknown as Record<string, number | string>;
        if (r["type"] === "outbound-rtp" && r["kind"] === "video") {
          const bytes = Number(r["bytesSent"] ?? 0);
          const ts = Number(r["timestamp"] ?? 0);
          if (lastTs && ts > lastTs) bitrateKbps = ((bytes - lastBytes) * 8) / (ts - lastTs);
          lastBytes = bytes;
          lastTs = ts;
          const packets = Number(r["packetsSent"] ?? 0);
          const rtt = Number(r["roundTripTime"] ?? 0);
          if (rtt) rttMs = rtt * 1000;
          lastPackets = packets;
        }
        if (r["type"] === "remote-inbound-rtp" && r["kind"] === "video") {
          const rtt = Number(r["roundTripTime"] ?? 0);
          if (rtt) rttMs = rtt * 1000;
          const lost = Number(r["packetsLost"] ?? 0);
          const deltaLost = Math.max(0, lost - lastLost);
          lastLost = lost;
          if (lastPackets > 0)
            lossPct = Math.min(100, (deltaLost / Math.max(1, lastPackets)) * 100);
        }
        if (r["type"] === "candidate-pair" && r["nominated"]) {
          const rtt = Number(r["currentRoundTripTime"] ?? 0);
          if (rtt && !rttMs) rttMs = rtt * 1000;
        }
      });

      // Latência alta ou perdas → degrada o vídeo; rede boa → recupera devagar.
      let next = current;
      if (rttMs > 400 || lossPct > 5) next = Math.max(MIN_BITRATE, Math.round(current * 0.6));
      else if (rttMs > 200 || lossPct > 2) next = Math.max(MIN_BITRATE, Math.round(current * 0.8));
      else if (rttMs > 0 && rttMs < 120 && lossPct < 1)
        next = Math.min(MAX_BITRATE, Math.round(current * 1.15));
      if (Math.abs(next - current) > 20_000) await apply(next);

      onReport({
        rttMs: Math.round(rttMs),
        lossPct: Number(lossPct.toFixed(1)),
        bitrateKbps: Math.round(bitrateKbps),
        targetKbps: Math.round(current / 1000),
      });
    } catch {
      // estatísticas indisponíveis neste browser
    }
  };

  const iv = setInterval(() => void tick(), 3000);
  return () => {
    stopped = true;
    clearInterval(iv);
  };
}
