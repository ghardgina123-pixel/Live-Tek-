import { describe, expect, it } from "vitest";
import { ConnectionState, ConnectionQuality } from "livekit-client";
import { liveConnectionStatus } from "@/lib/live-connection";

describe("Live connection signals", () => {
  it("shows initial connection", () => expect(liveConnectionStatus(ConnectionState.Connecting)).toBe("connecting"));
  it("shows healthy connection", () => expect(liveConnectionStatus(ConnectionState.Connected, ConnectionQuality.Good)).toBe("connected"));
  it("shows media reconnection", () => expect(liveConnectionStatus(ConnectionState.Reconnecting)).toBe("reconnecting"));
  it("shows signalling reconnection", () => expect(liveConnectionStatus(ConnectionState.SignalReconnecting)).toBe("reconnecting"));
  it("does not claim reconnection after terminal disconnect", () => expect(liveConnectionStatus(ConnectionState.Disconnected)).toBe("disconnected"));
  it("shows poor quality", () => expect(liveConnectionStatus(ConnectionState.Connected, ConnectionQuality.Poor)).toBe("unstable"));
  it("shows lost quality", () => expect(liveConnectionStatus(ConnectionState.Connected, ConnectionQuality.Lost)).toBe("unstable"));
  it("shows stalled video", () => expect(liveConnectionStatus(ConnectionState.Connected, ConnectionQuality.Good, true)).toBe("unstable"));
  it("reconnection takes precedence over stale quality", () => expect(liveConnectionStatus(ConnectionState.Reconnecting, ConnectionQuality.Poor, true)).toBe("reconnecting"));
  it("recovers after video resumes", () => expect(liveConnectionStatus(ConnectionState.Connected, ConnectionQuality.Excellent, false)).toBe("connected"));
});