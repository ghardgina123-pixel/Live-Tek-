import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

// Defense-in-depth: transport and browser-side hardening headers applied to
// every response leaving the app.
const SECURITY_HEADERS: Record<string, string> = {
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "permissions-policy": "geolocation=(self), camera=(self), microphone=(self), payment=(self)",
  "cross-origin-opener-policy": "same-origin",
};

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

let cspCache: string | undefined;

// Content-Security-Policy built from the origins the app really talks to.
function buildContentSecurityPolicy(): string {
  if (cspCache) return cspCache;

  const isDev = process.env.NODE_ENV !== "production";

  const supabaseOrigin =
    originOf(process.env.SUPABASE_URL) ?? originOf(process.env.VITE_SUPABASE_URL);
  const supabaseWs = supabaseOrigin ? supabaseOrigin.replace(/^https:/, "wss:") : null;
  // LiveKit SFU websocket (wss://...) — origin only, credentials stay server-side.
  const livekitWs = originOf(process.env.LIVEKIT_URL);
  const livekitHttps = livekitWs ? livekitWs.replace(/^wss:/, "https:") : null;

  const list = (...values: (string | null | undefined | false)[]) =>
    Array.from(new Set(values.filter(Boolean) as string[])).join(" ");

  const directives: Record<string, string> = {
    "default-src": "'self'",
    // 'unsafe-inline': TanStack Start emits inline hydration/dehydration scripts
    // and the Google Maps loader injects its own script tag.
    "script-src": list(
      "'self'",
      "'unsafe-inline'",
      isDev && "'unsafe-eval'",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
    ),
    // Tailwind/shadcn inject runtime style attributes and inline <style> blocks.
    "style-src": list("'self'", "'unsafe-inline'"),
    "img-src": list(
      "'self'",
      "data:",
      "blob:",
      supabaseOrigin,
      "https://storage.googleapis.com",
      "https://maps.googleapis.com",
      "https://maps.gstatic.com",
      "https://*.googleapis.com",
      "https://*.ggpht.com",
    ),
    "media-src": list("'self'", "data:", "blob:", supabaseOrigin),
    "connect-src": list(
      "'self'",
      "data:",
      "blob:",
      supabaseOrigin,
      supabaseWs,
      livekitWs,
      livekitHttps,
      "wss://*.livekit.cloud",
      "https://*.livekit.cloud",
      "https://oauth.lovable.app",
      "https://open.er-api.com",
      "https://maps.googleapis.com",
      isDev && "ws:",
      isDev && "http://localhost:*",
    ),
    "font-src": list("'self'", "data:"),
    // OAuth broker (web_message flow) and the OpenStreetMap embed used on maps.
    "frame-src": list("'self'", "https://oauth.lovable.app", "https://www.openstreetmap.org"),
    "worker-src": list("'self'", "blob:"),
    "manifest-src": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    // The app is embedded by the Lovable editor preview; block everyone else.
    "frame-ancestors": list("'self'", "https://lovable.dev", "https://*.lovable.app"),
  };

  cspCache = Object.entries(directives)
    .map(([key, value]) => `${key} ${value}`.trim())
    .join("; ");
  return cspCache;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  if (!headers.has("content-security-policy")) {
    headers.set("content-security-policy", buildContentSecurityPolicy());
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}


let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return withSecurityHeaders(await normalizeCatastrophicSsrResponse(response));
    } catch (error) {
      console.error(error);
      return withSecurityHeaders(new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      }));
    }
  },
};
