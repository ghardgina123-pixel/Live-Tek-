import { describe, expect, it } from "vitest";
import { guardExternalUrl, isBlockedHost } from "@/lib/net-guard";

describe("SSRF guard", () => {
  it("bloqueia loopback, redes privadas e metadados", () => {
    for (const host of [
      "localhost",
      "127.0.0.1",
      "0.0.0.0",
      "10.1.2.3",
      "172.16.0.9",
      "172.31.255.1",
      "192.168.1.50",
      "169.254.169.254",
      "100.64.0.1",
      "::1",
      "[::ffff:127.0.0.1]",
      "fd00::1",
      "camera.local",
      "metadata.google.internal",
      "intranet",
    ]) {
      expect(isBlockedHost(host), host).toBe(true);
    }
  });

  it("permite hosts públicos", () => {
    expect(isBlockedHost("stream.livekit.cloud")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
    expect(isBlockedHost("172.32.0.1")).toBe(false);
  });

  it("rejeita protocolos, portas e credenciais não permitidas", () => {
    expect(guardExternalUrl("rtsp://user:pass@192.168.1.50:554/s").ok).toBe(false);
    expect(guardExternalUrl("http://example.com").ok).toBe(false);
    expect(guardExternalUrl("https://user:pass@example.com").ok).toBe(false);
    expect(guardExternalUrl("https://example.com:8443").ok).toBe(false);
    expect(guardExternalUrl("file:///etc/passwd").ok).toBe(false);
    expect(guardExternalUrl("not a url").ok).toBe(false);
    expect(guardExternalUrl("https://127.0.0.1").ok).toBe(false);
  });

  it("aceita uma URL pública https válida", () => {
    const res = guardExternalUrl("https://api.livekit.io/ingress");
    expect(res.ok).toBe(true);
  });
});
