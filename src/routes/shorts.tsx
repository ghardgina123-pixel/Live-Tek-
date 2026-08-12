import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Share2, ShoppingBag, Loader2, ArrowLeft, Play, Volume2, VolumeX } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { cartStore } from "@/lib/cart-store";
import { useAuth } from "@/hooks/use-auth";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/shorts")({
  head: () => ({
    meta: [
      { title: "Shorts — Live Teká" },
      { name: "description", content: "Vídeos curtos dos produtos das lojas em destaque no Live Teká." },
    ],
  }),
  component: ShortsFeed,
});

type Short = {
  id: string;
  video_url: string;
  thumbnail_url: string | null;
  caption: string | null;
  product: {
    id: string;
    name: string;
    price_aoa: number;
    image_url: string | null;
    stock: number;
    store_id: string;
    stores: { name: string; logo_url: string | null } | null;
  } | null;
};

function ShortsFeed() {
  const [items, setItems] = useState<Short[] | null>(null);
  // Som ligado por omissão: o browser só permite autoplay com som após um
  // gesto do utilizador, por isso arrancamos em mudo e desmutamos ao 1.º toque.
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const unmute = () => setMuted(false);
    window.addEventListener("pointerdown", unmute, { once: true });
    window.addEventListener("keydown", unmute, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unmute);
      window.removeEventListener("keydown", unmute);
    };
  }, []);

  useEffect(() => {
    supabase
      .from("product_videos")
      .select("id, video_url, thumbnail_url, caption, product:products!inner(id, name, price_aoa, image_url, stock, store_id, stores(name, logo_url))")
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => setItems((data as unknown as Short[]) ?? []));
  }, []);

  if (items === null)
    return <AppShell><div className="flex h-[80vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div></AppShell>;

  if (items.length === 0)
    return (
      <AppShell>
        <div className="flex h-[80vh] flex-col items-center justify-center gap-3 px-8 text-center">
          <Play size={40} className="text-primary" />
          <h2 className="text-lg font-bold">Ainda não há shorts</h2>
          <p className="text-sm text-muted-foreground">Os lojistas em breve vão publicar vídeos curtos dos produtos aqui.</p>
          <Link to="/lojas" className="mt-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">Explorar lojas</Link>
        </div>
      </AppShell>
    );

  return (
    <div className="mx-auto h-screen w-full max-w-[480px] overflow-y-scroll bg-black snap-y snap-mandatory">
      <Link to="/home" className="fixed left-3 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur" aria-label="Voltar">
        <ArrowLeft size={18} />
      </Link>
      <h1 className="sr-only">Shorts — vídeos curtos de produtos das lojas na Live Teká</h1>
      {items.map((s, i) => (
        <ShortCard
          key={s.id}
          short={s}
          index={i}
          muted={muted}
          onToggleMute={() => setMuted((m) => !m)}
        />
      ))}
    </div>
  );
}

function ShortCard({
  short,
  index,
  muted,
  onToggleMute,
}: {
  short: Short;
  index: number;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const { user } = useAuth();
  const [liked, setLiked] = useState(false);
  const [likes, setLikes] = useState(0);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<Array<{ id: string; text: string; user_id: string; created_at: string }>>([]);
  const [commentText, setCommentText] = useState("");
  const [commentsLoaded, setCommentsLoaded] = useState(false);
  const [commentsCount, setCommentsCount] = useState(0);

  // Mantém o elemento sincronizado com o estado global de som.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = 1;
    if (!v.paused) v.play().catch(() => {});
  }, [muted]);

  // Carrega totais (likes + comments) e se o utilizador atual já curtiu.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ count: lc }, { count: cc }] = await Promise.all([
        supabase.from("short_likes").select("*", { count: "exact", head: true }).eq("video_id", short.id),
        supabase.from("short_comments").select("*", { count: "exact", head: true }).eq("video_id", short.id),
      ]);
      if (cancelled) return;
      setLikes(lc ?? 0);
      setCommentsCount(cc ?? 0);
      if (user) {
        const { data } = await supabase.from("short_likes").select("video_id").eq("video_id", short.id).eq("user_id", user.id).maybeSingle();
        if (!cancelled) setLiked(!!data);
      }
    })();
    return () => { cancelled = true; };
  }, [short.id, user?.id]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) { v.play().catch(() => {}); setPlaying(true); }
        else { v.pause(); setPlaying(false); }
      },
      { threshold: 0.6 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);

  const toggleLike = async () => {
    if (!user) return toast.error("Entre para curtir");
    // Optimistic UI
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes((n) => n + (wasLiked ? -1 : 1));
    if (wasLiked) {
      const { error } = await supabase.from("short_likes").delete().eq("video_id", short.id).eq("user_id", user.id);
      if (error) { setLiked(true); setLikes((n) => n + 1); toast.error("Não foi possível remover a curtida"); }
    } else {
      const { error } = await supabase.from("short_likes").insert({ video_id: short.id, user_id: user.id });
      if (error) { setLiked(false); setLikes((n) => n - 1); toast.error("Não foi possível curtir"); }
    }
  };

  const openComments = async () => {
    setCommentsOpen(true);
    if (commentsLoaded) return;
    const { data } = await supabase.from("short_comments").select("id, text, user_id, created_at").eq("video_id", short.id).order("created_at", { ascending: false }).limit(100);
    setComments(data ?? []);
    setCommentsLoaded(true);
  };

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error("Entre para comentar");
    const text = commentText.trim();
    if (!text) return;
    setCommentText("");
    const { data, error } = await supabase.from("short_comments").insert({ video_id: short.id, user_id: user.id, text }).select("id, text, user_id, created_at").single();
    if (error) { setCommentText(text); toast.error(error.message); return; }
    if (data) { setComments((prev) => [data, ...prev]); setCommentsCount((n) => n + 1); }
  };

  const share = async () => {
    const url = `${window.location.origin}/shorts?v=${short.id}`;
    const title = short.product?.name ?? "Live Teká — Shorts";
    const text = short.caption ?? "Confira este vídeo no Live Teká";
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title, text, url });
        return;
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado!");
    } catch {
      toast.error("Não foi possível partilhar");
    }
  };

  const buy = () => {
    if (!short.product) return;
    cartStore.add(
      {
        id: short.product.id,
        name: short.product.name,
        price: Number(short.product.price_aoa),
        emoji: "🛍️",
        storeId: short.product.store_id,
        rating: 5,
        sold: "—",
        description: short.caption ?? "",
      },
      1,
    );
    toast.success("Adicionado ao carrinho 🛒", {
      action: { label: "Ver", onClick: () => (window.location.href = "/carrinho") },
    });
  };

  return (
    <section className="relative h-screen w-full snap-start">
      <video
        ref={videoRef}
        src={short.video_url}
        poster={short.thumbnail_url ?? undefined}
        loop
        muted={muted}
        preload={index < 2 ? "auto" : "metadata"}
        playsInline
        onClick={() => { const v = videoRef.current; if (!v) return; if (v.paused) { v.play().catch(() => {}); setPlaying(true); } else { v.pause(); setPlaying(false); } }}
        className="h-full w-full object-cover"
      />
      {!playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Play size={64} className="text-white/80 drop-shadow-lg" />
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-5 pb-8 text-white">
        <div className="flex items-center gap-2">
          {short.product?.stores?.logo_url ? (
            <img loading="lazy" decoding="async" src={short.product.stores.logo_url} alt="" className="h-8 w-8 rounded-full border border-white/40 object-cover" />
          ) : (
            <div className="h-8 w-8 rounded-full bg-white/20" />
          )}
          <p className="text-sm font-semibold">{short.product?.stores?.name ?? "Loja"}</p>
        </div>
        {short.caption && <p className="mt-2 text-sm text-white/90 line-clamp-2">{short.caption}</p>}
        {short.product && (
          <button
            onClick={buy}
            disabled={short.product.stock <= 0}
            className="mt-3 flex w-full items-center justify-between rounded-2xl bg-primary px-4 py-3 text-left text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50"
          >
            <div className="min-w-0">
              <p className="truncate text-xs opacity-80">{short.product.name}</p>
              <p className="text-base font-bold">Kz {Number(short.product.price_aoa).toLocaleString("pt-AO")}</p>
            </div>
            <span className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs font-semibold backdrop-blur">
              <ShoppingBag size={14} /> {short.product.stock > 0 ? "Comprar agora" : "Esgotado"}
            </span>
          </button>
        )}
      </div>
      <div className="absolute right-3 bottom-32 flex flex-col gap-4 text-white">
        <SideAction
          icon={muted ? <VolumeX size={24} /> : <Volume2 size={24} />}
          label={muted ? "Som off" : "Som on"}
          onClick={onToggleMute}
        />
        <SideAction
          icon={<Heart size={24} className={liked ? "fill-red-500 text-red-500" : ""} />}
          label={likes ? likes.toString() : "Curtir"}
          onClick={toggleLike}
        />
        <SideAction
          icon={<MessageCircle size={24} />}
          label={commentsCount ? commentsCount.toString() : "Comentar"}
          onClick={openComments}
        />
        <SideAction icon={<Share2 size={24} />} label="Partilhar" onClick={share} />
      </div>

      <Sheet open={commentsOpen} onOpenChange={setCommentsOpen}>
        <SheetContent side="bottom" className="flex h-[70vh] flex-col p-0">
          <SheetHeader className="border-b p-4 text-left">
            <SheetTitle>Comentários {commentsCount > 0 && <span className="text-muted-foreground text-sm font-normal">· {commentsCount}</span>}</SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!commentsLoaded && <div className="flex justify-center py-6"><Loader2 className="animate-spin text-primary" /></div>}
            {commentsLoaded && comments.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">Seja o primeiro a comentar 💬</p>
            )}
            {comments.map((c) => (
              <div key={c.id} className="flex items-start gap-2 text-sm">
                <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-muted" />
                <div className="flex-1">
                  <p className="text-xs font-semibold text-primary">Usuário</p>
                  <p className="text-foreground">{c.text}</p>
                </div>
              </div>
            ))}
          </div>
          <form onSubmit={sendComment} className="flex items-center gap-2 border-t bg-background p-3">
            <Input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={user ? "Escreva um comentário…" : "Entre para comentar"}
              maxLength={500}
              disabled={!user}
              className="flex-1"
            />
            <button type="submit" disabled={!user || !commentText.trim()} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-40">
              Enviar
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}

function SideAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick?: () => void }) {
  return (
    <button className="flex flex-col items-center gap-1" aria-label={label} onClick={onClick} type="button">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur">{icon}</span>
      <span className="text-[10px]">{label}</span>
    </button>
  );
}