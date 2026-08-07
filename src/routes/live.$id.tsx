import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Radio, Send, Users, ShoppingBag, Loader2, Heart, Share2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { cartStore } from "@/lib/cart-store";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

// LiveKit é grande: carregar sob demanda só nesta rota.
const LivePlayer = lazy(() => import("@/components/LivePlayer").then((m) => ({ default: m.LivePlayer })));

export const Route = createFileRoute("/live/$id")({
  head: ({ params }) => ({
    meta: [
      { title: "Live — Live Teká" },
      { name: "description", content: "Assista à transmissão ao vivo e compre direto da live." },
      { property: "og:url", content: `https://www.livemarketplece.live/live/${params.id}` },
    ],
  }),
  component: LivePage,
});

const msgSchema = z.string().trim().min(1).max(500);

type Live = {
 id: string; title: string; status: string; viewer_count: number;
  store: { id: string; name: string; logo_url: string | null } | null;
};
type LiveProduct = {
  product: { id: string; name: string; price_aoa: number; image_url: string | null; stock: number; store_id: string } | null;
};
type LiveMsg = { id: string; sender_id: string; text: string; created_at: string };

function LivePage() {
  const { t } = useT();
  const { id } = useParams({ from: "/live/$id" });
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null | undefined>(undefined);
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [msgs, setMsgs] = useState<LiveMsg[]>([]);
  const [text, setText] = useState("");
  const [profiles, setProfiles] = useState<Record<string, { display_name: string | null; avatar_url: string | null }>>({});
  const [viewerCount, setViewerCount] = useState<number>(0);
  const [likeCount, setLikeCount] = useState<number>(0);
  const [liked, setLiked] = useState<boolean>(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingProfileIds = useRef<Set<string>>(new Set());
  const profileFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Busca em lote os perfis pendentes (evita 1 request por mensagem em chats rápidos)
  const flushProfileFetch = useCallback(() => {
    const ids = Array.from(pendingProfileIds.current);
    pendingProfileIds.current.clear();
    profileFlushRef.current = null;
    if (!ids.length) return;
    supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids).then(({ data }) => {
      if (!data?.length) return;
      setProfiles((prev) => {
        const next = { ...prev };
        data.forEach((p) => { next[p.id] = { display_name: p.display_name, avatar_url: p.avatar_url }; });
        return next;
      });
    });
  }, []);
  const queueProfile = useCallback((senderId: string) => {
    pendingProfileIds.current.add(senderId);
    if (!profileFlushRef.current) profileFlushRef.current = setTimeout(flushProfileFetch, 250);
  }, [flushProfileFetch]);

  useEffect(() => {
    (async () => {
      const { data: l } = await supabase.from("lives")
        .select("id, title, status, viewer_count, store:stores(id, name, logo_url)")
        .eq("id", id).maybeSingle();
      setLive((l as unknown as Live) ?? null);
      const { data: lp } = await supabase.from("live_products")
        .select("product:products(id, name, price_aoa, image_url, stock, store_id)")
        .eq("live_id", id);
      setProducts((lp as unknown as LiveProduct[]) ?? []);
      const { data: m } = await supabase.from("live_messages")
        .select("id, sender_id, text, created_at").eq("live_id", id)
        .order("created_at", { ascending: true }).limit(100);
      const messages = (m as LiveMsg[]) ?? [];
      setMsgs(messages);
      const ids = Array.from(new Set(messages.map((x) => x.sender_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids);
        const map: typeof profiles = {};
        (ps ?? []).forEach((p) => { map[p.id] = { display_name: p.display_name, avatar_url: p.avatar_url }; });
        setProfiles(map);
      }
    })();

    const ch = supabase
      .channel(`live-${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_messages", filter: `live_id=eq.${id}` }, (payload) => {
        const m = payload.new as LiveMsg;
        // Mantém só as últimas 200 mensagens em memória (mobile-friendly)
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-200)));
        setProfiles((p) => { if (!p[m.sender_id]) queueProfile(m.sender_id); return p; });
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "lives", filter: `id=eq.${id}` }, (payload) => {
        const updated = payload.new as { status: string; viewer_count: number };
        setLive((prev) => (prev ? { ...prev, status: updated.status, viewer_count: updated.viewer_count } : prev));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_likes", filter: `live_id=eq.${id}` }, (payload) => {
        const row = payload.new as { user_id: string };
        setLikeCount((n) => n + 1);
        if (user && row.user_id === user.id) setLiked(true);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "live_likes", filter: `live_id=eq.${id}` }, (payload) => {
        const row = payload.old as { user_id: string };
        setLikeCount((n) => Math.max(0, n - 1));
        if (user && row.user_id === user.id) setLiked(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_viewers", filter: `live_id=eq.${id}` }, () => {
        // Recalcula a contagem de viewers ativos (últimos 60s) sob demanda.
        refreshViewerCount();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
      if (profileFlushRef.current) clearTimeout(profileFlushRef.current);
    };
  }, [id, queueProfile, user]);

  // ------------ Viewers (presence via heartbeat) ------------
  const refreshViewerCount = useCallback(async () => {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from("live_viewers")
      .select("*", { count: "exact", head: true })
      .eq("live_id", id)
      .gte("last_seen_at", cutoff);
    setViewerCount(count ?? 0);
  }, [id]);

  useEffect(() => {
    refreshViewerCount();
    if (!user) return;
    const beat = async () => {
      await supabase.from("live_viewers").upsert(
        { live_id: id, user_id: user.id, last_seen_at: new Date().toISOString() },
        { onConflict: "live_id,user_id" },
      );
    };
    beat();
    const iv = setInterval(beat, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
      supabase.from("live_viewers").delete().eq("live_id", id).eq("user_id", user.id).then(() => {});
    };
  }, [id, user, refreshViewerCount]);

  // ------------ Likes (contagem + estado do próprio user) ------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("live_likes").select("*", { count: "exact", head: true }).eq("live_id", id);
      if (!cancelled) setLikeCount(count ?? 0);
      if (user) {
        const { data } = await supabase
          .from("live_likes").select("user_id").eq("live_id", id).eq("user_id", user.id).maybeSingle();
        if (!cancelled) setLiked(!!data);
      } else if (!cancelled) {
        setLiked(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, user]);

  const toggleLike = useCallback(async () => {
    if (!user) return toast.error(t("s_entre_para_curtir"));
    if (likeBusy) return;
    setLikeBusy(true);
    const wasLiked = liked;
    // Optimista — o Realtime confirma no INSERT/DELETE de todos os clientes.
    setLiked(!wasLiked);
    setLikeCount((n) => Math.max(0, n + (wasLiked ? -1 : 1)));
    const { error } = wasLiked
      ? await supabase.from("live_likes").delete().eq("live_id", id).eq("user_id", user.id)
      : await supabase.from("live_likes").insert({ live_id: id, user_id: user.id });
    if (error) {
      setLiked(wasLiked);
      setLikeCount((n) => Math.max(0, n + (wasLiked ? 1 : -1)));
      toast.error(error.message);
    }
    setLikeBusy(false);
  }, [user, liked, likeBusy, id]);

  // ------------ Share ------------
  const share = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : `https://www.livemarketplece.live/live/${id}`;
    const title = live?.title ?? "Live Teká";
    const shareText = `Assiste a live "${title}" agora na Live Teká`;
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await (navigator as Navigator).share({ title, text: shareText, url });
        return;
      }
    } catch {
      // usuário cancelou — cai no fallback
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success(t("s_link_copiado"));
    } catch {
      toast.error(t("s_nao_foi_possivel_partilhar"));
    }
  }, [id, live?.title]);

  // Auto-scroll em rAF — evita reflow síncrono a cada mensagem
  useEffect(() => {
    const raf = requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    return () => cancelAnimationFrame(raf);
  }, [msgs.length]);

  const send = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error(t("s_entre_para_comentar"));
    const parsed = msgSchema.safeParse(text);
    if (!parsed.success) return toast.error(t("s_mensagem_invalida"));
    setText("");
    const { error } = await supabase.from("live_messages").insert({ live_id: id, sender_id: user.id, text: parsed.data });
    if (error) { setText(parsed.data); toast.error(error.message); }
  }, [user, text, id]);

  const buy = useCallback((p: NonNullable<LiveProduct["product"]>) => {
    cartStore.add({ id: p.id, name: p.name, price: Number(p.price_aoa), emoji: "🛍️", storeId: p.store_id, rating: 5, sold: "—", description: "" }, 1);
    toast.success(`${p.name} no carrinho`);
  }, []);

  const productItems = useMemo(() => products.filter((lp) => lp.product), [products]);

  if (live === undefined) return <div className="flex h-screen items-center justify-center bg-black"><Loader2 className="animate-spin text-white" /></div>;
  if (!live) return <div className="flex h-screen items-center justify-center bg-black text-white">{t("s_live_nao_encontrada")}</div>;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-black text-white">
      {/* Player area — LiveKit (lazy, isolado do chat) */}
      <div className="relative aspect-[9/16] w-full bg-gradient-to-br from-zinc-900 to-zinc-700">
        <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center"><Loader2 className="animate-spin text-white" /></div>}>
          <LivePlayer liveId={live.id} />
        </Suspense>
        <Link to="/lojas" className="absolute left-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 backdrop-blur" aria-label={t("s_voltar")}><ArrowLeft size={18} /></Link>
        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-[var(--live)] px-3 py-1 text-[10px] font-bold uppercase shadow-lg">
          <Radio size={11} /> {live.status}
        </div>
        <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs backdrop-blur">
          {live.store?.logo_url && <img src={live.store.logo_url} className="h-5 w-5 rounded-full object-cover" alt="" />}
          <span className="font-semibold">{live.store?.name}</span>
        </div>
        <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-full bg-black/50 px-3 py-1 text-xs backdrop-blur">
          <Users size={12} /> {viewerCount}
        </div>
        {/* Ações sociais */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
          <button
            onClick={toggleLike}
            aria-pressed={liked}
            aria-label={liked ? t("s_remover_gosto") : t("s_gostar")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur transition active:scale-95"
          >
            <Heart
              size={22}
              className={liked ? "fill-[var(--live,#ef4444)] text-[var(--live,#ef4444)]" : "text-white"}
            />
          </button>
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-semibold backdrop-blur">
            {likeCount}
          </span>
          <button
            onClick={share}
            aria-label={t("s_partilhar")}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/50 backdrop-blur transition active:scale-95"
          >
            <Share2 size={20} className="text-white" />
          </button>
        </div>
      </div>

      {/* Live products strip */}
      {productItems.length > 0 && (
        <div className="border-y border-white/10 bg-black/60 px-3 py-2">
          <p className="mb-1.5 text-[10px] uppercase tracking-wide text-white/60">{t("s_em_destaque_na_live")}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {productItems.map((lp) => (
              <ProductCard key={lp.product!.id} product={lp.product!} onBuy={buy} />
            ))}
          </div>
        </div>
      )}

      {/* Live chat */}
      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {msgs.length === 0 && <p className="py-6 text-center text-xs text-white/50">{t("s_seja_o_primeiro_a_comentar")}</p>}
        {msgs.map((m) => (
          <ChatRow key={m.id} msg={m} profile={profiles[m.sender_id]} />
        ))}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <form onSubmit={send} className="flex items-center gap-2 border-t border-white/10 bg-black p-2.5">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={user ? t("s_adicione_um_comentario") : t("s_entre_para_comentar")}
          maxLength={500}
          disabled={!user}
          className="h-10 flex-1 rounded-full border-white/20 bg-white/10 text-white placeholder:text-white/50"
        />
        <button type="submit" disabled={!user || !text.trim()} className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

const ProductCard = memo(function ProductCard({ product, onBuy }: { product: NonNullable<LiveProduct["product"]>; onBuy: (p: NonNullable<LiveProduct["product"]>) => void }) {
  return (
    <button onClick={() => onBuy(product)} className="flex w-40 shrink-0 items-center gap-2 rounded-xl bg-white/10 p-2 text-left backdrop-blur">
      <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/10">
        {product.image_url ? <img src={product.image_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-lg">🛍️</div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[11px] font-semibold">{product.name}</p>
        <p className="text-[11px] text-primary">Kz {Number(product.price_aoa).toLocaleString("pt-AO")}</p>
      </div>
      <ShoppingBag size={14} className="shrink-0" />
    </button>
  );
});

const ChatRow = memo(function ChatRow({ msg, profile }: { msg: LiveMsg; profile?: { display_name: string | null; avatar_url: string | null } }) {
  const { t } = useT();
  return (
    <div className="flex items-start gap-2 text-sm">
      <div className="mt-0.5 h-6 w-6 shrink-0 overflow-hidden rounded-full bg-white/20">
        {profile?.avatar_url && <img src={profile.avatar_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0">
        <span className="mr-1.5 text-[11px] font-bold text-primary">{profile?.display_name ?? t("s_usuario")}</span>
        <span className="text-white/90">{msg.text}</span>
      </div>
    </div>
  );
});