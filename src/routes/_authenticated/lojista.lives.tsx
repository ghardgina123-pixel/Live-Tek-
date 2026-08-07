import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useState } from "react";
import { Loader2, Radio, Play, Square, Plus, Users, ExternalLink, Trash2 } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
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
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionStatus } from "@/hooks/use-subscription";
import { toast } from "sonner";

const LivePublisher = lazy(() => import("@/components/LivePublisher").then((m) => ({ default: m.LivePublisher })));
const LojistaLivePanel = lazy(() => import("@/components/LojistaLivePanel").then((m) => ({ default: m.LojistaLivePanel })));
const LiveCameraManager = lazy(() => import("@/components/LiveCameraManager").then((m) => ({ default: m.LiveCameraManager })));

function liveErrorMessage(msg: string) {
  if (msg.includes("live_limit_reached")) return "Atingiu o limite de lives do seu plano este mês. Faça upgrade para continuar.";
  if (msg.includes("subscription_inactive")) return "Subscrição inativa. Ative um plano para transmitir em direto.";
  return msg;
}

export const Route = createFileRoute("/_authenticated/lojista/lives")({
  head: () => ({ meta: [{ title: "Lives — Lojista" }] }),
  component: () => (
    <LojistaShell title="Transmissões ao vivo">
      <LivesManager />
    </LojistaShell>
  ),
});

type Live = {
  id: string;
  title: string;
  status: "scheduled" | "live" | "ended";
  viewer_count: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

function LivesManager() {
  const { store } = useLojistaStore();
  const [lives, setLives] = useState<Live[] | null>(null);
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const storeId = store?.id;
  const { status: subStatus, usage, reload: reloadSub } = useSubscriptionStatus(storeId);
  const limitReached = !!usage && !usage.unlimited && usage.limit !== null && usage.used >= usage.limit;
  const canGoLive = (subStatus ? subStatus.can_go_live : true) && !limitReached;
  const blocked = subStatus ? !subStatus.can_go_live : false;

  const load = async (sid: string) => {
    const { data } = await supabase
      .from("lives")
      .select("id, title, status, viewer_count, started_at, ended_at, created_at")
      .eq("store_id", sid)
      .order("created_at", { ascending: false })
      .limit(20);
    setLives((data as Live[]) ?? []);
  };

  useEffect(() => {
    if (!storeId) return;
    load(storeId);
    const ch = supabase
      .channel(`lojista-lives-${storeId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "lives", filter: `store_id=eq.${storeId}` }, () => load(storeId))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [storeId]);

  const makeRoom = () => `store-${storeId!.slice(0, 8)}-${Date.now().toString(36)}`;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !title.trim()) return;
    if (!canGoLive) return toast.error("Subscrição inativa. Ative um plano para transmitir.");
    if (limitReached) return toast.error("Atingiu o limite de lives do seu plano este mês.");
    setCreating(true);
    const { data, error } = await supabase
      .from("lives")
      .insert({ store_id: storeId, title: title.trim(), livekit_room: makeRoom(), status: "scheduled" })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      await reloadSub();
      return toast.error(liveErrorMessage(error.message));
    }
    setTitle("");
    toast.success("Live criada. A preparar câmara…");
    if (data?.id) {
      if (storeId) await load(storeId);
      prepareLive(data.id);
    }
  };

  const quickCreate = async () => {
    if (!storeId) return;
    if (!canGoLive) return toast.error("Subscrição inativa. Ative um plano para transmitir.");
    if (limitReached) return toast.error("Atingiu o limite de lives do seu plano este mês.");
    setCreating(true);
    const defaultTitle = `Live de ${store?.name ?? "loja"}`;
    const { data, error } = await supabase
      .from("lives")
      .insert({ store_id: storeId, title: defaultTitle, livekit_room: makeRoom(), status: "scheduled" })
      .select("id")
      .single();
    setCreating(false);
    if (error) {
      await reloadSub();
      return toast.error(liveErrorMessage(error.message));
    }
    toast.success("Live criada. A preparar câmara…");
    if (data?.id) {
      if (storeId) await load(storeId);
      prepareLive(data.id);
    }
  };

  // Prepara a live: apenas abre o painel de transmissão. O estado só passa
  // a "live" DEPOIS de a publicação LiveKit ter sido bem-sucedida (rollback
  // automático se a câmara/microfone falhar).
  const prepareLive = (id: string) => {
    setConfirmId(null);
    setActiveId(id);
  };

  const markLive = async (id: string) => {
    const { error } = await supabase
      .from("lives")
      .update({ status: "live", started_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
  };

  const rollbackLive = async (id: string, reason: string) => {
    await supabase
      .from("lives")
      .update({ status: "scheduled", started_at: null })
      .eq("id", id);
    toast.error(reason || "Não foi possível iniciar a transmissão.");
  };

  const endLive = async (id: string) => {
    const { error } = await supabase.from("lives").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    if (activeId === id) setActiveId(null);
  };

  const deleteLive = async (id: string) => {
    setDeleting(true);
    const { error } = await supabase.from("lives").delete().eq("id", id);
    setDeleting(false);
    setDeleteId(null);
    if (error) return toast.error(error.message);
    if (activeId === id) setActiveId(null);
    toast.success("Live apagada");
    if (storeId) load(storeId);
  };

  const activeLive = lives?.find((l) => l.id === activeId) ?? null;

  return (
    <div className="space-y-6">
      {/* Criar nova live */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Plus size={18} className="text-primary" />
          <h2 className="text-sm font-semibold">Nova transmissão</h2>
        </div>
        {blocked && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-muted-foreground">
            A sua subscrição está inativa. Ative um plano para iniciar lives.{" "}
            <Link to="/lojista/subscricao" className="font-semibold text-primary underline">Ver planos</Link>
          </div>
        )}
        {usage && !blocked && (
          <div className="mb-3 rounded-xl border border-border bg-muted/40 p-3 text-xs">
            <p className="font-medium">
              Lives usadas este mês: {usage.used}
              {usage.unlimited ? " (plano sem limite)" : ` de ${usage.limit ?? 0}`}
            </p>
            {!usage.unlimited && (
              <p className="mt-0.5 text-muted-foreground">
                Restantes: {usage.remaining ?? 0}.{" "}
                {limitReached && (
                  <Link to="/lojista/subscricao" className="font-semibold text-primary underline">
                    Faça upgrade para criar mais lives
                  </Link>
                )}
              </p>
            )}
          </div>
        )}
        <Button
          onClick={quickCreate}
          disabled={creating || blocked}
          className="w-full"
          size="lg"
        >
          {creating ? <Loader2 className="animate-spin" size={18} /> : <><Radio size={18} className="mr-2" /> Criar live</>}
        </Button>
        <form onSubmit={create} className="mt-4 space-y-3 border-t border-border pt-4">
          <div>
            <Label htmlFor="live-title" className="text-xs">Título personalizado (opcional)</Label>
            <Input
              id="live-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Coleção nova de Verão"
              maxLength={120}
              className="mt-1"
            />
          </div>
          <Button type="submit" disabled={!title.trim() || creating || blocked} variant="outline" className="w-full">
            {creating ? <Loader2 className="animate-spin" size={16} /> : "Criar live com título"}
          </Button>
        </form>
      </section>

      {/* Painel de transmissão da live activa */}
      {activeLive && (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">{activeLive.title}</h2>
              <p className="text-[11px] text-muted-foreground">Estado: {statusLabel(activeLive.status)}</p>
            </div>
            {activeLive.status !== "live" ? (
              <span className="text-[11px] text-muted-foreground">Clique em “Iniciar câmara” abaixo</span>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => endLive(activeLive.id)}>
                <Square size={14} className="mr-1" /> Encerrar
              </Button>
            )}
          </div>
          <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>}>
            <LivePublisher
              liveId={activeLive.id}
              onConnected={() => markLive(activeLive.id)}
              onDisconnected={() => {
                if (activeLive.status === "live") endLive(activeLive.id);
              }}
              onError={(msg) => rollbackLive(activeLive.id, msg)}
            />
          </Suspense>
          <Suspense fallback={<div className="mt-3 flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={16} /></div>}>
            <LiveCameraManager liveId={activeLive.id} />
          </Suspense>
          <Suspense fallback={<div className="mt-3 flex justify-center py-6"><Loader2 className="animate-spin text-primary" size={16} /></div>}>
            <LojistaLivePanel liveId={activeLive.id} />
          </Suspense>
          <Link to="/live/$id" params={{ id: activeLive.id }} className="mt-3 inline-flex items-center gap-1 text-xs text-primary underline">
            Ver como espetador <ExternalLink size={11} />
          </Link>
        </section>
      )}

      {/* Lista */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Minhas lives</h2>
          <span className="text-xs text-muted-foreground">{lives?.length ?? 0} sessão(ões)</span>
        </div>
        {lives === null ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : lives.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            Nenhuma live criada. Crie a sua primeira transmissão acima.
          </div>
        ) : (
          <ul className="space-y-2">
            {lives.map((l) => (
              <li key={l.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${l.status === "live" ? "bg-red-500 text-white" : "bg-muted text-muted-foreground"}`}>
                  <Radio size={16} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{l.title}</p>
                  <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{statusLabel(l.status)}</span>
                    {l.status === "live" && <><span>·</span><span className="flex items-center gap-1"><Users size={10} /> {l.viewer_count}</span></>}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {l.status === "scheduled" && (
                    <>
                      <Button size="sm" onClick={() => prepareLive(l.id)}>
                        <Play size={12} className="mr-1" /> Iniciar
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleteId(l.id)} aria-label="Apagar live">
                        <Trash2 size={12} />
                      </Button>
                    </>
                  )}
                  {l.status === "live" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => setActiveId(l.id)}>
                        Painel
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => endLive(l.id)}>
                        <Square size={12} className="mr-1" /> Parar
                      </Button>
                    </>
                  )}
                  {l.status === "ended" && (
                    <Button size="sm" variant="outline" onClick={() => setDeleteId(l.id)} aria-label="Apagar live">
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={!!confirmId} onOpenChange={(open) => { if (!open) setConfirmId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Preparar transmissão ao vivo?</DialogTitle>
            <DialogDescription>
              Vamos abrir o painel de câmara. A live só ficará pública depois de a câmara ligar com sucesso — se falhar, o estado é revertido automaticamente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmId(null)}>Cancelar</Button>
            <Button onClick={() => confirmId && prepareLive(confirmId)}>
              <Radio size={14} className="mr-2" /> Preparar câmara
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apagar esta live?</DialogTitle>
            <DialogDescription>
              A live e todo o histórico associado (mensagens, produtos destacados) serão removidos definitivamente. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={() => deleteId && deleteLive(deleteId)} disabled={deleting}>
              {deleting ? <Loader2 className="animate-spin" size={14} /> : <><Trash2 size={14} className="mr-2" /> Apagar</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function statusLabel(s: Live["status"]) {
  if (s === "live") return "AO VIVO";
  if (s === "scheduled") return "Agendada";
  return "Encerrada";
}