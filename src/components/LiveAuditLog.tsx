import { useCallback, useEffect, useState } from "react";
import { Download, ScrollText, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

export type LiveEventRow = {
  id: string;
  kind: string;
  level: string;
  message: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const levelTone: Record<string, string> = {
  error: "bg-destructive/15 text-destructive",
  warn: "bg-amber-500/15 text-amber-600",
  info: "bg-muted text-muted-foreground",
};

/** Converte os eventos em CSV para auditoria/exportação. */
export function eventsToCsv(rows: LiveEventRow[]): string {
  const head = ["data", "nivel", "tipo", "mensagem", "detalhes"];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const lines = rows.map((r) =>
    [
      new Date(r.created_at).toISOString(),
      r.level,
      r.kind,
      r.message,
      JSON.stringify(r.metadata ?? {}),
    ]
      .map(esc)
      .join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

/** Registo de auditoria em tempo real das operações da live. */
export function LiveAuditLog({ liveId }: { liveId: string }) {
  const [rows, setRows] = useState<LiveEventRow[] | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("live_events")
      .select("id, kind, level, message, metadata, created_at")
      .eq("live_id", liveId)
      .order("created_at", { ascending: false })
      .limit(100);
    setRows((data as LiveEventRow[]) ?? []);
  }, [liveId]);

  useEffect(() => {
    void load();
    const ch = supabase
      .channel(`live-events-${liveId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_events", filter: `live_id=eq.${liveId}` },
        (payload) =>
          setRows((prev) => [payload.new as LiveEventRow, ...(prev ?? [])].slice(0, 100)),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [liveId, load]);

  const exportCsv = () => {
    const blob = new Blob([eventsToCsv(rows ?? [])], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-live-${liveId.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="mt-3 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <ScrollText size={15} className="text-primary" /> Auditoria da live
        </h3>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Atualizar registo"
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
          </Button>
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={!rows?.length}>
            <Download size={14} className="mr-1" /> CSV
          </Button>
        </div>
      </div>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {rows?.map((e) => (
          <li key={e.id} className="rounded-lg border p-2 text-xs">
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${levelTone[e.level] ?? levelTone["info"]}`}
              >
                {e.kind}
              </span>
              <span className="ml-auto text-[10px] text-muted-foreground">
                {new Date(e.created_at).toLocaleTimeString("pt-PT")}
              </span>
            </div>
            <p className="mt-1">{e.message}</p>
          </li>
        ))}
      </ul>
      {rows?.length === 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">Sem eventos registados.</p>
      )}
    </section>
  );
}
