/**
 * Proteção SSRF — validação de qualquer URL de origem externa antes de o
 * servidor (ou o LiveKit Ingress em nosso nome) lhe tocar.
 *
 * Regras: apenas protocolos permitidos, apenas portas permitidas, nunca
 * loopback/link-local/redes privadas/endpoints de metadados.
 */

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
  "kubernetes.default.svc",
]);

/** IPv4 privado, loopback, link-local, CGNAT, broadcast e metadados. */
function isBlockedIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const p = m.slice(1, 5).map(Number);
  if (p.some((n) => n > 255)) return true;
  const [a, b] = p as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 e 192.0.2.0/24
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast + reservado + broadcast
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (!h.includes(":")) return false;
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fe80") || h.startsWith("fc") || h.startsWith("fd")) return true; // link-local / ULA
  // IPv4 mapeado (::ffff:127.0.0.1)
  const mapped = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped?.[1] && isBlockedIPv4(mapped[1])) return true;
  return false;
}

export function isBlockedHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) return true;
  if (!h.includes(".") && !h.includes(":")) return true; // hostnames sem TLD => rede interna
  return isBlockedIPv4(h) || isBlockedIPv6(h);
}

/**
 * Valida uma URL externa contra SSRF.
 * @param raw URL fornecida pelo utilizador
 * @param protocols protocolos permitidos (com ":")
 * @param ports portas permitidas; vazio = qualquer porta padrão do protocolo
 */
export function guardExternalUrl(
  raw: string,
  protocols: string[] = ["https:"],
  ports: number[] = [443],
): UrlGuardResult {
  const value = (raw ?? "").trim();
  if (!value || value.length > 500) return { ok: false, reason: "URL inválida" };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "URL inválida" };
  }
  if (!protocols.includes(url.protocol)) return { ok: false, reason: "Protocolo não permitido" };
  if (url.username || url.password)
    return { ok: false, reason: "Credenciais embutidas na URL não são permitidas" };
  if (isBlockedHost(url.hostname)) return { ok: false, reason: "Destino de rede não permitido" };
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 0;
  if (ports.length && !ports.includes(port)) return { ok: false, reason: "Porta não permitida" };
  return { ok: true, url };
}
