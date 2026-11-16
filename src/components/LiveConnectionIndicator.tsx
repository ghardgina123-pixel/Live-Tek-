import { Loader2, Wifi, WifiOff, AlertTriangle } from "lucide-react";
import type { LiveConnection } from "@/lib/live-connection";

const labels: Record<LiveConnection, string> = {
  connecting: "A conectar…",
  connected: "Conexão ativa",
  unstable: "Conexão instável",
  reconnecting: "A reconectar…",
  disconnected: "Sem conexão",
};

export function LiveConnectionIndicator({ status }: { status: LiveConnection }) {
  const Icon = status === "connected" ? Wifi : status === "unstable" ? AlertTriangle : status === "disconnected" ? WifiOff : Loader2;
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold shadow-sm ${status === "connected" ? "border-border bg-secondary text-secondary-foreground" : "border-destructive/40 bg-background text-destructive"}`}>
      <Icon size={14} className={status === "connecting" || status === "reconnecting" ? "shrink-0 animate-spin motion-reduce:animate-none" : "shrink-0"} />
      <span>{labels[status]}</span>
    </div>
  );
}