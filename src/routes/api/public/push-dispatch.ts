import { createFileRoute } from "@tanstack/react-router";

// POST endpoint invoked by Postgres triggers via pg_net to fan-out Web Push
// notifications. Authorization: Bearer <PUSH_WEBHOOK_SECRET>.
//
// Body:
//   { kind: "user",  payload: { user_id, title, body, url, kind } }
//   { kind: "admin", payload: { title, body, url, kind } }

type Payload = {
  user_id?: string;
  title?: string;
  body?: string;
  url?: string;
  kind?: string;
};

export const Route = createFileRoute("/api/public/push-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT || "mailto:admin@livemarketplece.live";
        if (!publicKey || !privateKey) {
          return new Response("Push not configured", { status: 503 });
        }
        const auth = request.headers.get("authorization") ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        // Read the shared secret from vault (single source of truth), not from
        // an env var — the env-var value was previously seeded via a committed
        // migration and has been rotated. Vault holds the current value.
        const { data: vaultRow } = await supabaseAdmin
          .schema("vault" as never)
          .from("decrypted_secrets" as never)
          .select("decrypted_secret")
          .eq("name", "push_webhook_secret")
          .maybeSingle();
        const expected = (vaultRow as { decrypted_secret?: string } | null)?.decrypted_secret;
        if (!expected || !token) {
          return new Response("Unauthorized", { status: 401 });
        }
        const { timingSafeEqual } = await import("crypto");
        const a = Buffer.from(token);
        const b = Buffer.from(expected);
        if (a.length !== b.length || !timingSafeEqual(a, b)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const json = (await request.json()) as { kind: string; payload: Payload };

        // Resolve target user ids
        let userIds: string[] = [];
        if (json.kind === "user" && json.payload?.user_id) {
          userIds = [json.payload.user_id];
        } else if (json.kind === "admin") {
          const { data } = await supabaseAdmin
            .from("user_roles")
            .select("user_id")
            .eq("role", "admin");
          userIds = (data ?? []).map((r) => r.user_id);
        } else {
          return new Response("Bad request", { status: 400 });
        }
        if (!userIds.length) return Response.json({ sent: 0 });

        const { data: subs } = await supabaseAdmin
          .from("push_subscriptions")
          .select("endpoint, p256dh, auth")
          .in("user_id", userIds);
        if (!subs?.length) return Response.json({ sent: 0 });

        const webpush = (await import("web-push")).default;
        webpush.setVapidDetails(subject, publicKey, privateKey);

        const notif = JSON.stringify({
          title: json.payload?.title ?? "Live Teká",
          body: json.payload?.body ?? "",
          url: json.payload?.url ?? "/",
          kind: json.payload?.kind ?? "general",
        });

        const stale: string[] = [];
        let sent = 0;
        await Promise.all(
          subs.map(async (s) => {
            try {
              await webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                notif,
              );
              sent++;
            } catch (err) {
              const status = (err as { statusCode?: number }).statusCode;
              if (status === 404 || status === 410) stale.push(s.endpoint);
            }
          }),
        );
        if (stale.length) {
          await supabaseAdmin.from("push_subscriptions").delete().in("endpoint", stale);
        }
        return Response.json({ sent, pruned: stale.length });
      },
    },
  },
});