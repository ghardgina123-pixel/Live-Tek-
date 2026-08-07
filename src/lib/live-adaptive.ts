import type { LocalVideoTrack } from "livekit-client";

export type NetworkReport = { rttMs: number; lossPct: number; bitrateKbps: number };

export const MAX_BITRATE = 700_000;
export const MIN_BITRATE = 90_000;

/**
 * Decisão pura de bitrate — testável: latência alta ou perdas degradam o
 * vídeo; rede boa recupera devagar. O áudio nunca é alterado.
 */
export function decideBitrate(current: number, net: { rttMs: number; lossPct: number }): number {
  const { rttMs, lossPct } = net;
  if (rttMs > 400 || lossPct > 5) return Math.max(MIN_BITRATE, Math.round(current * 0.6));
  if (rttMs > 200 || lossPct > 2) return Math.max(MIN_BITRATE, Math.round(current * 0.8));
  if (rttMs > 0 && rttMs < 120 && lossPct < 1)
    return Math.min(MAX_BITRATE, Math.round(current * 1.15));
  return current;
}

export type StatsCursor = {
  lastBytes: number;
  lastTs: number;
  lastLost: number;
  lastPackets: number;
};

export function emptyCursor(): StatsCursor {
  return { lastBytes: 0, lastTs: 0, lastLost: 0, lastPackets: 0 };
}

/** Converte entradas WebRTC getStats em RTT / perda / bitrate reais. */
export function parseVideoStats(
  entries: Array<Record<string, number | string | boolean>>,
  cursor: StatsCursor,
): NetworkReport {
  let rttMs = 0;
  let bitrateKbps = 0;
  let lossPct = 0;
  for (const r of entries) {
    if (r["type"] === "outbound-rtp" && r["kind"] === "video") {
      const bytes = Number(r["bytesSent"] ?? 0);
      const ts = Number(r["timestamp"] ?? 0);
      if (cursor.lastTs && ts > cursor.lastTs)
        bitrateKbps = ((bytes - cursor.lastBytes) * 8) / (ts - cursor.lastTs);
      cursor.lastBytes = bytes;
      cursor.lastTs = ts;
      cursor.lastPackets = Number(r["packetsSent"] ?? 0);
      const rtt = Number(r["roundTripTime"] ?? 0);
      if (rtt) rttMs = rtt * 1000;
    }
    if (r["type"] === "remote-inbound-rtp" && r["kind"] === "video") {
      const rtt = Number(r["roundTripTime"] ?? 0);
      if (rtt) rttMs = rtt * 1000;
      const lost = Number(r["packetsLost"] ?? 0);
      const deltaLost = Math.max(0, lost - cursor.lastLost);
      cursor.lastLost = lost;
      if (cursor.lastPackets > 0)
        lossPct = Math.min(100, (deltaLost / Math.max(1, cursor.lastPackets)) * 100);
    }
    if (r["type"] === "candidate-pair" && r["nominated"]) {
      const rtt = Number(r["currentRoundTripTime"] ?? 0);
      if (rtt && !rttMs) rttMs = rtt * 1000;
    }
  }
  return {
    rttMs: Math.round(rttMs),
    lossPct: Number(lossPct.toFixed(1)),
    bitrateKbps: Math.round(bitrateKbps),
  };
}

/**
 * Controlador adaptativo: mede RTT e perda de pacotes do envio de vídeo e
 * reduz o bitrate de vídeo quando a rede da loja degrada — o áudio nunca é
 * tocado, garantindo que a voz do locutor se mantém cristalina e sincronizada.
 */
export function startAdaptiveBitrate(
  videoTrack: LocalVideoTrack,
  onReport: (report: NetworkReport & { targetKbps: number }) => void,
  onChange?: (change: { fromKbps: number; toKbps: number; net: NetworkReport }) => void,
) {
  let current = 350_000;
  let stopped = false;
  const cursor = emptyCursor();

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
      const entries: Array<Record<string, number | string | boolean>> = [];
      stats?.forEach((report) =>
        entries.push(report as unknown as Record<string, number | string | boolean>),
      );
      const net = parseVideoStats(entries, cursor);
      const next = decideBitrate(current, net);
      if (Math.abs(next - current) > 20_000) {
        const from = current;
        await apply(next);
        if (current !== from)
          onChange?.({
            fromKbps: Math.round(from / 1000),
            toKbps: Math.round(current / 1000),
            net,
          });
      }

      onReport({ ...net, targetKbps: Math.round(current / 1000) });
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
