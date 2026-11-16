import { ConnectionState, ConnectionQuality } from "livekit-client";

export type LiveConnection = "connecting" | "connected" | "unstable" | "reconnecting" | "disconnected";

export function liveConnectionStatus(
  connection: ConnectionState,
  quality?: ConnectionQuality,
  stalled = false,
): LiveConnection {
  if (connection === ConnectionState.Reconnecting || connection === ConnectionState.SignalReconnecting) return "reconnecting";
  if (connection === ConnectionState.Connecting) return "connecting";
  if (connection === ConnectionState.Disconnected) return "disconnected";
  if (stalled || quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) return "unstable";
  return "connected";
}