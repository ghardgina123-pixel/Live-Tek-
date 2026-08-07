/**
 * Processamento de áudio profissional para as lives:
 * filtro passa-alto (corta ruído grave da loja: frigoríficos, ar condicionado),
 * noise gate adaptativo (silencia quando o locutor não fala) e compressor
 * para manter a voz constante mesmo com microfone Bluetooth de lapela.
 */
export type AudioChain = {
  track: MediaStreamTrack;
  level: () => number;
  setEnabled: (on: boolean) => void;
  close: () => Promise<void>;
};

export function createVoiceChain(source: MediaStreamTrack): AudioChain | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }

  const input = ctx.createMediaStreamSource(new MediaStream([source]));
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 110; // remove ruído ambiente grave
  const presence = ctx.createBiquadFilter();
  presence.type = "peaking";
  presence.frequency.value = 2600; // realça inteligibilidade da voz
  presence.gain.value = 3;
  const gate = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.2;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const destination = ctx.createMediaStreamDestination();

  input.connect(highpass);
  highpass.connect(presence);
  presence.connect(analyser);
  presence.connect(gate);
  gate.connect(compressor);
  compressor.connect(destination);

  const buffer = new Uint8Array(analyser.frequencyBinCount);
  let level = 0;
  let enabled = true;
  let holdUntil = 0;
  const OPEN = 0.055; // limiar de abertura do gate
  const CLOSE = 0.03;
  const HOLD_MS = 350;

  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const v = (buffer[i] - 128) / 128;
      sum += v * v;
    }
    level = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
    if (!enabled) {
      gate.gain.setTargetAtTime(1, ctx.currentTime, 0.02);
      return;
    }
    const now = Date.now();
    if (level > OPEN) holdUntil = now + HOLD_MS;
    const open = level > CLOSE || now < holdUntil;
    gate.gain.setTargetAtTime(open ? 1 : 0.02, ctx.currentTime, open ? 0.01 : 0.08);
  }, 60);

  const track = destination.stream.getAudioTracks()[0];

  return {
    track,
    level: () => level,
    setEnabled: (on: boolean) => {
      enabled = on;
    },
    close: async () => {
      clearInterval(timer);
      try {
        track.stop();
      } catch {
        // noop
      }
      try {
        await ctx.close();
      } catch {
        // noop
      }
    },
  };
}

/** Constraints de captura pensadas para microfones Bluetooth (lapela/headset). */
export function micConstraints(deviceId?: string) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  } as MediaTrackConstraints;
}