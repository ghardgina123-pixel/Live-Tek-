import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Camera, Cctv, Loader2, Plus, Power, RefreshCw, Trash2, Radio, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createLiveCamera,
  deleteLiveCamera,
  listLiveCameras,
  startLiveCamera,
  stopLiveCamera,
  switchLiveCamera,
  type LiveCameraDTO,
} from "@/lib/live-cameras.functions";

const statusLabel: Record<string, string> = {
  idle: "Parada",
  connecting: "A ligar…",
  buffering: "A sincronizar",
  publishing: "A transmitir",
  error: "Erro",
};

const statusTone: Record<string, string> = {
  publishing: "bg-emerald-500/15 text-emerald-600",
  buffering: "bg-amber-500/15 text-amber-600",
  connecting: "bg-amber-500/15 text-amber-600",
  error: "bg-destructive/15 text-destructive",
  idle: "bg-muted text-muted-foreground",
};

/**
 * Multi-cam da live: regista câmaras IP reais da loja (RTSP/ONVIF via Wi-Fi,
 * RTMP ou WHIP) como ingresses LiveKit na mesma sala do telemóvel e permite
 * alternar a fonte apresentada aos espetadores com um clique.
 */
export function LiveCameraManager({ liveId }: { liveId: string }) {
  const list = useServerFn(listLiveCameras);
  const create = useServerFn(createLiveCamera);
  const start = useServerFn(startLiveCamera);
  const stop = useServerFn(stopLiveCamera);
  const remove = useServerFn(deleteLiveCamera);
  const switchTo = useServerFn(switchLiveCamera);

  const [cameras, setCameras] = useState<LiveCameraDTO[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [sourceType, setSourceType] = useState<"rtsp" | "rtmp" | "whip">("rtsp");
  const [sourceUrl, setSourceUrl] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    try {
      const res = await list({ data: { liveId } });
      setCameras(res.cameras);
    } catch (e) {
      setCameras([]);
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("LIVEKIT_NOT_CONFIGURED")) toast.error(msg);
    }
  }, [list, liveId]);

  useEffect(() => {
    void reload();
    const iv = setInterval(() => void reload(), 15_000);
    return () => clearInterval(iv);
  }, [reload]);

  const add = async () => {
    if (!label.trim()) return toast.error("Dê um nome à câmara");
    if (sourceType === "rtsp" && !sourceUrl.trim())
      return toast.error("Indique a URL RTSP da câmara");
    setSaving(true);
    try {
      await create({
        data: { liveId, label: label.trim(), sourceType, sourceUrl: sourceUrl.trim() || undefined },
      });
      toast.success("Câmara ligada à live");
      setOpen(false);
      setLabel("");
      setSourceUrl("");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao adicionar câmara");
    } finally {
      setSaving(false);
    }
  };

  const run = async (id: string, fn: () => Promise<unknown>, okMsg?: string) => {
    setBusyId(id);
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operação falhou");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mt-3 rounded-2xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold">
          <Cctv size={15} className="text-primary" /> Câmaras da live
        </h3>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void reload()}
            aria-label="Atualizar estado"
          >
            <RefreshCw size={14} />
          </Button>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus size={14} className="mr-1" /> Câmara IP
          </Button>
        </div>
      </div>

      {cameras === null && (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-primary" size={16} />
        </div>
      )}

      <ul className="space-y-2">
        {cameras?.map((cam) => (
          <li
            key={cam.id}
            className={`rounded-xl border p-2.5 ${cam.isActive ? "border-primary bg-primary/5" : ""}`}
          >
            <div className="flex items-center gap-2">
              {cam.sourceType === "phone" ? <Camera size={15} /> : <Cctv size={15} />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{cam.label}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {cam.sourceType === "phone"
                    ? "Câmara do telemóvel"
                    : (cam.sourceUrl ?? cam.sourceType.toUpperCase())}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusTone[cam.status] ?? statusTone["idle"]}`}
              >
                {statusLabel[cam.status] ?? cam.status}
              </span>
            </div>

            {cam.lastError && <p className="mt-1 text-[11px] text-destructive">{cam.lastError}</p>}

            {(cam.ingressUrl || cam.streamKey) && cam.sourceType !== "rtsp" && (
              <div className="mt-2 space-y-1 rounded-lg bg-muted/50 p-2 text-[11px]">
                {cam.ingressUrl && <CopyRow label="URL" value={cam.ingressUrl} />}
                {cam.streamKey && <CopyRow label="Chave" value={cam.streamKey} />}
              </div>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant={cam.isActive ? "secondary" : "default"}
                disabled={cam.isActive || busyId === cam.id}
                onClick={() =>
                  void run(
                    cam.id,
                    () => switchTo({ data: { liveId, cameraId: cam.id } }),
                    `Fonte: ${cam.label}`,
                  )
                }
              >
                {busyId === cam.id ? (
                  <Loader2 size={13} className="mr-1 animate-spin" />
                ) : (
                  <Radio size={13} className="mr-1" />
                )}
                {cam.isActive ? "No ar" : "Passar ao ar"}
              </Button>
              {cam.sourceType !== "phone" && (
                <>
                  {cam.ingressId ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === cam.id}
                      onClick={() =>
                        void run(
                          cam.id,
                          () => stop({ data: { cameraId: cam.id } }),
                          "Câmara parada",
                        )
                      }
                    >
                      <Power size={13} className="mr-1" /> Parar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === cam.id}
                      onClick={() =>
                        void run(
                          cam.id,
                          () => start({ data: { cameraId: cam.id } }),
                          "Câmara ligada",
                        )
                      }
                    >
                      <Power size={13} className="mr-1" /> Ligar
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busyId === cam.id}
                    onClick={() =>
                      void run(
                        cam.id,
                        () => remove({ data: { cameraId: cam.id } }),
                        "Câmara removida",
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </Button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {cameras?.length === 0 && (
        <p className="py-2 text-center text-xs text-muted-foreground">Nenhuma câmara registada.</p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ligar câmara externa</DialogTitle>
            <DialogDescription>
              Câmaras IP da loja (RTSP/ONVIF) na mesma rede, ou encoders RTMP/WHIP.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="cam-label">Nome</Label>
              <Input
                id="cam-label"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Câmara de segurança (plano geral)"
              />
            </div>
            <div>
              <Label htmlFor="cam-type">Tipo de fonte</Label>
              <select
                id="cam-type"
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value as typeof sourceType)}
                className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm"
              >
                <option value="rtsp">Câmara IP / ONVIF (RTSP)</option>
                <option value="rtmp">Encoder RTMP</option>
                <option value="whip">Encoder WHIP (WebRTC)</option>
              </select>
            </div>
            {sourceType === "rtsp" && (
              <div>
                <Label htmlFor="cam-url">URL RTSP</Label>
                <Input
                  id="cam-url"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="rtsp://utilizador:senha@192.168.1.50:554/stream1"
                  autoComplete="off"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  A câmara tem de estar acessível a partir da internet (encaminhamento de porta ou
                  DDNS) para o servidor de streaming a poder captar.
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void add()} disabled={saving}>
              {saving && <Loader2 size={14} className="mr-1 animate-spin" />} Ligar câmara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="shrink-0 font-semibold">{label}:</span>
      <span className="truncate font-mono">{value}</span>
      <button
        type="button"
        aria-label={`Copiar ${label}`}
        className="ml-auto shrink-0 text-primary"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          toast.success("Copiado");
        }}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
