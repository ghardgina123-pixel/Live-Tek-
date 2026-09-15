import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  Check,
  Heart,
  Loader2,
  MessageCircle,
  Radio,
  Send,
  Share2,
  ShoppingBag,
  Users,
} from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { StorageImage } from "@/lib/storage";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cartStore } from "@/lib/cart-store";
import { fromAoa, formatPrice, useCurrency } from "@/lib/currency";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

const LivePlayer = lazy(() =>
  import("@/components/LivePlayer").then((module) => ({ default: module.LivePlayer })),
);

export const Route = createFileRoute("/live/$id")({
  head: ({ params }) => ({
    meta: [
      { title: "Live ao vivo — Live Teká" },
      {
        name: "description",
        content: "Assista à transmissão ao vivo, converse e compre na Live Teká.",
      },
      { property: "og:title", content: "Live ao vivo — Live Teká" },
      {
        property: "og:description",
        content: "Assista à transmissão ao vivo, converse e compre na Live Teká.",
      },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: `https://www.livemarketplece.live/live/${params.id}` },
    ],
  }),
  component: LivePage,
});

const msgSchema = z.string().trim().min(1).max(500);

type Live = {
  id: string;
  title: string;
  status: string;
  viewer_count: number;
  store: { id: string; name: string; logo_url: string | null } | null;
};

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_aoa: number;
  image_url: string | null;
  stock: number;
  status: string;
  store_id: string;
};

type LiveProduct = { product: Product | null };
type LiveMsg = { id: string; sender_id: string; text: string; created_at: string };
type PublicProfile = { display_name: string | null; avatar_url: string | null };

function LivePage() {
  const { t } = useT();
  const { id } = useParams({ from: "/live/$id" });
  const navigate = useNavigate();
  const currency = useCurrency();
  const { user } = useAuth();
  const [live, setLive] = useState<Live | null | undefined>(undefined);
  const [products, setProducts] = useState<LiveProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [msgs, setMsgs] = useState<LiveMsg[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, PublicProfile>>({});
  const [viewerCount, setViewerCount] = useState(0);
  const [likeCount, setLikeCount] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingProfileIds = useRef<Set<string>>(new Set());
  const profileFlushRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshViewerCount = useCallback(async () => {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from("live_viewers")
      .select("*", { count: "exact", head: true })
      .eq("live_id", id)
      .gte("last_seen_at", cutoff);
    setViewerCount(count ?? 0);
  }, [id]);

  const flushProfileFetch = useCallback(() => {
    const ids = Array.from(pendingProfileIds.current);
    pendingProfileIds.current.clear();
    profileFlushRef.current = null;
    if (!ids.length) return;
    supabase
      .from("public_profiles")
      .select("id, display_name, avatar_url")
      .in("id", ids)
      .then(({ data }) => {
        if (!data?.length) return;
        setProfiles((current) => {
          const next = { ...current };
          data.forEach((profile) => {
            if (profile.id) {
              next[profile.id] = {
                display_name: profile.display_name,
                avatar_url: profile.avatar_url,
              };
            }
          });
          return next;
        });
      });
  }, []);

  const queueProfile = useCallback(
    (senderId: string) => {
      pendingProfileIds.current.add(senderId);
      if (!profileFlushRef.current) profileFlushRef.current = setTimeout(flushProfileFetch, 250);
    },
    [flushProfileFetch],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: liveRow } = await supabase
        .from("lives")
        .select("id, title, status, viewer_count, store:stores(id, name, logo_url)")
        .eq("id", id)
        .maybeSingle();
      if (cancelled) return;
      const nextLive = (liveRow as unknown as Live) ?? null;
      setLive(nextLive);

      const [{ data: liveProducts }, { data: messages }] = await Promise.all([
        supabase
          .from("live_products")
          .select(
            "product:products(id, name, description, price_aoa, image_url, stock, status, store_id)",
          )
          .eq("live_id", id),
        supabase
          .from("live_messages")
          .select("id, sender_id, text, created_at")
          .eq("live_id", id)
          .order("created_at", { ascending: true })
          .limit(100),
      ]);
      if (cancelled) return;
      setProducts((liveProducts as unknown as LiveProduct[]) ?? []);
      const initialMessages = (messages as LiveMsg[]) ?? [];
      setMsgs(initialMessages);
      const senderIds = Array.from(new Set(initialMessages.map((message) => message.sender_id)));
      if (senderIds.length) {
        const { data: profileRows } = await supabase
          .from("public_profiles")
          .select("id, display_name, avatar_url")
          .in("id", senderIds);
        if (cancelled) return;
        const profileMap: Record<string, PublicProfile> = {};
        (profileRows ?? []).forEach((profile) => {
          if (profile.id) {
            profileMap[profile.id] = {
              display_name: profile.display_name,
              avatar_url: profile.avatar_url,
            };
          }
        });
        setProfiles(profileMap);
      }
    })();

    const channel = supabase
      .channel(`live-${id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_messages", filter: `live_id=eq.${id}` },
        (payload) => {
          const message = payload.new as LiveMsg;
          setMsgs((current) =>
            current.some((item) => item.id === message.id)
              ? current
              : [...current, message].slice(-200),
          );
          setProfiles((current) => {
            if (!current[message.sender_id]) queueProfile(message.sender_id);
            return current;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "lives", filter: `id=eq.${id}` },
        (payload) => {
          const updated = payload.new as { status: string; viewer_count: number };
          setLive((current) =>
            current
              ? { ...current, status: updated.status, viewer_count: updated.viewer_count }
              : current,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "live_likes", filter: `live_id=eq.${id}` },
        (payload) => {
          const row = payload.new as { user_id: string };
          setLikeCount((count) => count + 1);
          if (user && row.user_id === user.id) setLiked(true);
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "live_likes", filter: `live_id=eq.${id}` },
        (payload) => {
          const row = payload.old as { user_id: string };
          setLikeCount((count) => Math.max(0, count - 1));
          if (user && row.user_id === user.id) setLiked(false);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_viewers", filter: `live_id=eq.${id}` },
        refreshViewerCount,
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      if (profileFlushRef.current) clearTimeout(profileFlushRef.current);
    };
  }, [id, queueProfile, refreshViewerCount, user]);

  useEffect(() => {
    refreshViewerCount();
    if (!user) return;
    const heartbeat = async () => {
      await supabase.from("live_viewers").upsert(
        { live_id: id, user_id: user.id, last_seen_at: new Date().toISOString() },
        { onConflict: "live_id,user_id" },
      );
    };
    void heartbeat();
    const interval = setInterval(heartbeat, 30_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      void supabase.from("live_viewers").delete().eq("live_id", id).eq("user_id", user.id);
    };
  }, [id, refreshViewerCount, user]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { count } = await supabase
        .from("live_likes")
        .select("*", { count: "exact", head: true })
        .eq("live_id", id);
      if (!cancelled) setLikeCount(count ?? 0);
      if (!user) {
        if (!cancelled) setLiked(false);
        return;
      }
      const { data } = await supabase
        .from("live_likes")
        .select("user_id")
        .eq("live_id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setLiked(Boolean(data));
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user]);

  useEffect(() => {
    let cancelled = false;
    const storeId = live?.store?.id;
    if (!user || !storeId) {
      setFollowing(false);
      return;
    }
    supabase
      .from("store_follows")
      .select("store_id")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setFollowing(Boolean(data));
      });
    return () => {
      cancelled = true;
    };
  }, [live?.store?.id, user]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
    return () => cancelAnimationFrame(frame);
  }, [msgs.length]);

  const toggleLike = useCallback(async () => {
    if (!user) return toast.error(t("s_entre_para_curtir"));
    if (likeBusy) return;
    setLikeBusy(true);
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((count) => Math.max(0, count + (wasLiked ? -1 : 1)));
    const { error } = wasLiked
      ? await supabase.from("live_likes").delete().eq("live_id", id).eq("user_id", user.id)
      : await supabase.from("live_likes").insert({ live_id: id, user_id: user.id });
    if (error) {
      setLiked(wasLiked);
      setLikeCount((count) => Math.max(0, count + (wasLiked ? 1 : -1)));
      toast.error(error.message);
    }
    setLikeBusy(false);
  }, [id, likeBusy, liked, t, user]);

  const toggleFollow = useCallback(async () => {
    const storeId = live?.store?.id;
    if (!user) return toast.error("Entre para acompanhar esta loja.");
    if (!storeId || followBusy) return;
    setFollowBusy(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    const { error } = wasFollowing
      ? await supabase
          .from("store_follows")
          .delete()
          .eq("store_id", storeId)
          .eq("user_id", user.id)
      : await supabase.from("store_follows").insert({ store_id: storeId, user_id: user.id });
    if (error) {
      setFollowing(wasFollowing);
      toast.error(error.message);
    }
    setFollowBusy(false);
  }, [followBusy, following, live?.store?.id, user]);

  const share = useCallback(async () => {
    const url = typeof window !== "undefined" ? window.location.href : `https://www.livemarketplece.live/live/${id}`;
    const title = live?.title ?? "Live Teká";
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({ title, text: `Assiste a live “${title}” agora na Live Teká`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success(t("s_link_copiado"));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(t("s_nao_foi_possivel_partilhar"));
    }
  }, [id, live?.title, t]);

  const send = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (!user) return toast.error(t("s_entre_para_comentar"));
      const parsed = msgSchema.safeParse(text);
      if (!parsed.success) return toast.error(t("s_mensagem_invalida"));
      const message = parsed.data;
      setSending(true);
      setText("");
      const { error } = await supabase
        .from("live_messages")
        .insert({ live_id: id, sender_id: user.id, text: message });
      if (error) {
        setText(message);
        toast.error(error.message);
      }
      setSending(false);
    },
    [id, t, text, user],
  );

  const addProduct = useCallback((product: Product, checkout: boolean) => {
    if (product.status !== "approved" || product.stock <= 0) {
      toast.error("Este produto não está disponível para compra.");
      return;
    }
    cartStore.add(
      {
        id: product.id,
        name: product.name,
        price: fromAoa(product.price_aoa),
        priceAoa: Number(product.price_aoa),
        emoji: "🛍️",
        storeId: product.store_id,
        rating: 0,
        sold: "0",
        description: product.description ?? "",
        image: product.image_url,
      },
      1,
    );
    setSelectedProduct(null);
    if (checkout) void navigate({ to: "/checkout" });
    else toast.success(`${product.name} no carrinho`);
  }, [navigate]);

  const productItems = useMemo(
    () =>
      products
        .map((item) => item.product)
        .filter((product): product is Product => Boolean(product && product.status === "approved")),
    [products],
  );

  if (live === undefined) {
    return (
      <div className="flex h-dvh items-center justify-center bg-secondary">
        <Loader2 className="animate-spin text-primary-foreground" />
      </div>
    );
  }

  if (!live) {
    return (
      <div className="flex h-dvh items-center justify-center bg-secondary px-6 text-center text-secondary-foreground">
        {t("s_live_nao_encontrada")}
      </div>
    );
  }

  return (
    <main className="fixed inset-0 z-40 mx-auto h-dvh w-full max-w-[480px] overflow-hidden bg-secondary text-secondary-foreground shadow-xl">
      <h1 className="sr-only">
        {live.store?.name ? `${live.store.name} ao vivo — ${live.title}` : `${live.title} — Live Teká`}
      </h1>

      <div className="absolute inset-0">
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center bg-secondary">
              <Loader2 className="animate-spin" />
            </div>
          }
        >
          <LivePlayer liveId={live.id} />
        </Suspense>
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-secondary/85 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-secondary via-secondary/55 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-20 flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={() => window.history.back()}
          className="h-10 w-10 shrink-0 rounded-full bg-secondary/55 text-secondary-foreground hover:bg-secondary/75 hover:text-secondary-foreground"
          aria-label={t("s_voltar")}
        >
          <ArrowLeft size={20} />
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border-2 border-primary bg-secondary/70">
            {live.store?.logo_url ? (
              <StorageImage
                bucket="store-assets"
                path={live.store.logo_url}
                alt={live.store.name}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold">
                {live.store?.name?.slice(0, 1).toUpperCase() ?? "L"}
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{live.store?.name ?? "Live Teká"}</p>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold">
              <span className="inline-flex items-center gap-1 rounded-sm bg-live px-1.5 py-0.5 uppercase">
                <Radio size={10} /> {live.status === "live" ? "Live" : live.status}
              </span>
              <span className="inline-flex items-center gap-1 text-secondary-foreground/80">
                <Users size={11} /> {viewerCount}
              </span>
            </div>
          </div>
        </div>

        {live.store && (
          <Button
            type="button"
            size="sm"
            onClick={toggleFollow}
            disabled={followBusy}
            className={
              following
                ? "h-9 shrink-0 border border-secondary-foreground/30 bg-secondary/60 px-2.5 text-xs text-secondary-foreground shadow-none hover:bg-secondary/80"
                : "h-9 shrink-0 bg-primary px-2.5 text-xs text-primary-foreground"
            }
            aria-pressed={following}
          >
            {following && <Check size={14} />}
            {following ? "A acompanhar" : "Acompanhar"}
          </Button>
        )}

        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={share}
          className="h-10 w-10 shrink-0 rounded-full bg-secondary/55 text-secondary-foreground hover:bg-secondary/75 hover:text-secondary-foreground"
          aria-label={t("s_partilhar")}
        >
          <Share2 size={19} />
        </Button>
      </header>

      <aside className="absolute bottom-[calc(7.25rem+env(safe-area-inset-bottom))] right-3 z-20 flex flex-col items-center gap-3">
        <SocialAction
          label={liked ? t("s_remover_gosto") : t("s_gostar")}
          count={likeCount}
          pressed={liked}
          onClick={toggleLike}
        >
          <Heart className={liked ? "fill-live text-live" : "text-secondary-foreground"} />
        </SocialAction>
        <SocialAction
          label="Ver comentários"
          count={msgs.length}
          onClick={() => chatRef.current?.focus()}
        >
          <MessageCircle />
        </SocialAction>
        <SocialAction label={t("s_partilhar")} onClick={share}>
          <Share2 />
        </SocialAction>
      </aside>

      <section className="absolute inset-x-0 bottom-0 z-10 flex max-h-[62dvh] flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mb-2 max-w-[calc(100%-4.5rem)]">
          <p className="text-sm font-bold">{live.store?.name ?? "Live Teká"}</p>
          <p className="line-clamp-2 text-xs leading-relaxed text-secondary-foreground/85">{live.title}</p>
        </div>

        <div
          ref={chatRef}
          tabIndex={-1}
          className="smooth-scroll mb-2 max-h-[24dvh] min-h-0 max-w-[calc(100%-4.5rem)] space-y-1.5 overflow-y-auto overscroll-contain pr-1 outline-none"
          aria-label="Comentários da live"
        >
          {msgs.length === 0 ? (
            <p className="py-2 text-xs text-secondary-foreground/65">
              {t("s_seja_o_primeiro_a_comentar")}
            </p>
          ) : (
            msgs.map((message) => (
              <ChatRow key={message.id} msg={message} profile={profiles[message.sender_id]} />
            ))
          )}
          <div ref={endRef} />
        </div>

        {productItems.length > 0 && (
          <div className="smooth-scroll mb-2 flex max-w-[calc(100%-3.5rem)] gap-2 overflow-x-auto overscroll-x-contain pb-0.5">
            {productItems.map((product) => (
              <Button
                key={product.id}
                type="button"
                variant="ghost"
                onClick={() => setSelectedProduct(product)}
                className="h-14 w-52 shrink-0 justify-start gap-2 rounded-md border border-secondary-foreground/15 bg-secondary/70 p-1.5 text-left text-secondary-foreground shadow-lg hover:bg-secondary/85 hover:text-secondary-foreground"
              >
                <ProductImage product={product} className="h-11 w-11 rounded-sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold">{product.name}</span>
                  <span className="block truncate text-xs font-bold text-primary">
                    {formatPrice(fromAoa(product.price_aoa), currency)}
                  </span>
                </span>
                <ShoppingBag size={16} />
              </Button>
            ))}
          </div>
        )}

        <form onSubmit={send} className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-2">
          <Input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={user ? "Enviar mensagem..." : t("s_entre_para_comentar")}
            maxLength={500}
            disabled={!user || sending}
            className="h-11 min-w-0 rounded-full border-secondary-foreground/20 bg-secondary/65 px-4 text-sm text-secondary-foreground placeholder:text-secondary-foreground/60 focus-visible:ring-primary"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!user || !text.trim() || sending}
            className="h-11 w-11 rounded-full"
            aria-label={t("s_enviar_mensagem")}
          >
            {sending ? <Loader2 className="animate-spin" /> : <Send />}
          </Button>
        </form>
      </section>

      <Sheet open={Boolean(selectedProduct)} onOpenChange={(open) => !open && setSelectedProduct(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto max-h-[78dvh] w-full max-w-[480px] overflow-y-auto rounded-t-lg border-secondary-foreground/10 bg-background px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-5"
        >
          {selectedProduct && (
            <>
              <SheetHeader className="pr-8 text-left">
                <SheetTitle>{selectedProduct.name}</SheetTitle>
              </SheetHeader>
              <div className="mt-4 grid grid-cols-[6rem_minmax(0,1fr)] gap-3">
                <ProductImage product={selectedProduct} className="aspect-square w-24 rounded-md" />
                <div className="min-w-0">
                  <p className="text-lg font-bold text-primary">
                    {formatPrice(fromAoa(selectedProduct.price_aoa), currency)}
                  </p>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                    {selectedProduct.description ?? "Sem descrição."}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {selectedProduct.stock > 0
                      ? `${selectedProduct.stock} em stock`
                      : "Sem stock disponível"}
                  </p>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={selectedProduct.stock <= 0}
                  onClick={() => addProduct(selectedProduct, false)}
                  className="h-11"
                >
                  <ShoppingBag /> Adicionar
                </Button>
                <Button
                  type="button"
                  disabled={selectedProduct.stock <= 0}
                  onClick={() => addProduct(selectedProduct, true)}
                  className="h-11"
                >
                  Comprar
                </Button>
              </div>
              <Button asChild variant="link" className="mt-2 w-full">
                <Link to="/produto/$id" params={{ id: selectedProduct.id }}>
                  Ver detalhes do produto
                </Link>
              </Button>
            </>
          )}
        </SheetContent>
      </Sheet>
    </main>
  );
}

function SocialAction({
  label,
  count,
  pressed,
  onClick,
  children,
}: {
  label: string;
  count?: number;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex w-12 flex-col items-center gap-0.5">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className="h-11 w-11 rounded-full bg-secondary/55 text-secondary-foreground shadow-lg hover:bg-secondary/75 hover:text-secondary-foreground active:scale-95 [&_svg]:h-5 [&_svg]:w-5"
      >
        {children}
      </Button>
      {typeof count === "number" && (
        <span className="text-[10px] font-bold tabular-nums text-secondary-foreground drop-shadow">
          {count}
        </span>
      )}
    </div>
  );
}

function ProductImage({ product, className }: { product: Product; className: string }) {
  return (
    <span className={`shrink-0 overflow-hidden bg-muted ${className}`}>
      {product.image_url ? (
        <StorageImage
          bucket="product-images"
          path={product.image_url}
          alt={product.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-xl">🛍️</span>
      )}
    </span>
  );
}

const ChatRow = memo(function ChatRow({ msg, profile }: { msg: LiveMsg; profile?: PublicProfile }) {
  const { t } = useT();
  return (
    <div className="flex items-start gap-2 text-sm drop-shadow">
      <div className="mt-0.5 h-6 w-6 shrink-0 overflow-hidden rounded-full bg-secondary-foreground/20">
        {profile?.avatar_url && (
          <StorageImage
            bucket="avatars"
            path={profile.avatar_url}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <p className="min-w-0 rounded-md bg-secondary/35 px-2 py-1 leading-snug">
        <span className="mr-1.5 text-[11px] font-bold text-primary">
          {profile?.display_name ?? t("s_usuario")}
        </span>
        <span className="break-words text-secondary-foreground/95">{msg.text}</span>
      </p>
    </div>
  );
});