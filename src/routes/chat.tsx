import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Search, Send, ShieldCheck, ArrowLeft, Loader2, MessageCircle } from "lucide-react";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { StorageImage } from "@/lib/storage";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

const searchSchema = z.object({ c: z.string().uuid().optional() });

export const Route = createFileRoute("/chat")({
  head: () => ({
    meta: [
      { title: "Chat — Live Teká" },
      { name: "description", content: "Converse em tempo real com as lojas do Live Teká." },
    ],
  }),
  validateSearch: searchSchema,
  component: ChatPage,
});

type Conversation = {
  id: string;
  store_id: string;
  customer_id: string;
  last_message_at: string;
  store: { id: string; name: string; logo_url: string | null; owner_id: string } | null;
  customer?: { id: string; display_name: string | null; avatar_url: string | null } | null;
};
type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  created_at: string;
};

function ChatPage() {
  const { user, loading } = useAuth();
  const { t } = useT();
  const navigate = useNavigate();
  const { c: openId } = Route.useSearch();

  if (loading) return <AppShell><div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div></AppShell>;
  if (!user) {
    return (
      <AppShell>
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
          <MessageCircle className="text-primary" size={36} />
          <p className="text-sm text-muted-foreground">{t("login_to_continue")}</p>
          <button onClick={() => navigate({ to: "/login" })} className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground">{t("login")}</button>
        </div>
      </AppShell>
    );
  }

  if (openId) return <ConversationView conversationId={openId} userId={user.id} onBack={() => navigate({ to: "/chat", search: {} })} />;
  return <ConversationList userId={user.id} onOpen={(id) => navigate({ to: "/chat", search: { c: id } })} />;
}

function ConversationList({ userId, onOpen }: { userId: string; onOpen: (id: string) => void }) {
  const { t } = useT();
  const [items, setItems] = useState<Conversation[] | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    const { data } = await supabase
      .from("conversations")
      .select("id, store_id, customer_id, last_message_at, store:stores(id, name, logo_url, owner_id)")
      .order("last_message_at", { ascending: false });
    const rows = (data as unknown as Conversation[]) ?? [];
    const customerIds = Array.from(new Set(rows.map((r) => r.customer_id)));
    if (customerIds.length) {
      const { data: profs } = await supabase.from("public_profiles").select("id, display_name, avatar_url").in("id", customerIds);
      const map = new Map((profs ?? []).map((p) => [p.id, p]));
      rows.forEach((r) => { r.customer = (map.get(r.customer_id) as Conversation["customer"]) ?? null; });
    }
    setItems(rows);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("conv-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  const filtered = (items ?? []).filter((c) => {
    const name = c.store?.owner_id === userId ? c.customer?.display_name ?? "Cliente" : c.store?.name ?? "Loja";
    return name.toLowerCase().includes(q.toLowerCase());
  });

  return (
    <AppShell>
      <header className="px-5 pt-6 pb-3">
        <h1 className="text-2xl font-bold">Mensagens</h1>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search_placeholder")} className="h-11 rounded-xl bg-muted pl-10" />
        </div>
      </header>
      {items === null ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <div className="px-6 py-16 text-center text-sm text-muted-foreground">
          Sem conversas ainda. Abra uma loja e toque em <strong>Conversar</strong> para começar.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {filtered.map((c) => {
            const asSeller = c.store?.owner_id === userId;
            const name = asSeller ? (c.customer?.display_name ?? "Cliente") : (c.store?.name ?? "Loja");
            const avatar = asSeller ? c.customer?.avatar_url : c.store?.logo_url;
            const avatarBucket = asSeller ? "avatars" : "store-assets";
            return (
              <li key={c.id}>
                <button onClick={() => onOpen(c.id)} className="flex w-full items-center gap-3 px-5 py-3 text-left">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-accent text-xl">
                    {avatar ? <StorageImage bucket={avatarBucket} path={avatar} alt="" className="h-full w-full object-cover" /> : "🛍️"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-semibold">{name}</p>
                      <span className="text-[10px] text-muted-foreground">{relTime(c.last_message_at)}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{asSeller ? "Cliente" : "Loja"} · toque para abrir</p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </AppShell>
  );
}

function ConversationView({ conversationId, userId, onBack }: { conversationId: string; userId: string; onBack: () => void }) {
  const { t } = useT();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [peerOnline, setPeerOnline] = useState(false);
  const [peerTyping, setPeerTyping] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const presenceRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimeoutRef = useRef<number | null>(null);
  const lastTypingSentRef = useRef(0);

  useEffect(() => {
    (async () => {
      const { data: c } = await supabase
        .from("conversations")
        .select("id, store_id, customer_id, last_message_at, store:stores(id, name, logo_url, owner_id)")
        .eq("id", conversationId)
        .maybeSingle();
      const conv = c as unknown as Conversation | null;
      if (conv) {
        const { data: p } = await supabase.from("public_profiles").select("id, display_name, avatar_url").eq("id", conv.customer_id).maybeSingle();
        conv.customer = (p as Conversation["customer"]) ?? null;
      }
      setConv(conv);
      const { data: m } = await supabase
        .from("messages")
        .select("id, conversation_id, sender_id, text, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true })
        .limit(200);
      setMsgs((m as Message[]) ?? []);
    })();

    const ch = supabase
      .channel(`conv-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const m = payload.new as Message;
          setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs.length]);

  // Presence + typing channel
  useEffect(() => {
    if (!conv) return;
    const channel = supabase.channel(`chat-presence-${conversationId}`, {
      config: { presence: { key: userId } },
    });
    presenceRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, unknown[]>;
        const others = Object.keys(state).filter((k) => k !== userId);
        setPeerOnline(others.length > 0);
      })
      .on("broadcast", { event: "typing" }, (payload) => {
        if (payload.payload?.userId === userId) return;
        setPeerTyping(true);
        if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = window.setTimeout(() => setPeerTyping(false), 2500);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") await channel.track({ online_at: new Date().toISOString() });
      });
    return () => {
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current);
      supabase.removeChannel(channel);
      presenceRef.current = null;
    };
  }, [conversationId, userId, conv?.id]);

  const sendTyping = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1500) return;
    lastTypingSentRef.current = now;
    presenceRef.current?.send({ type: "broadcast", event: "typing", payload: { userId } });
  };

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setSending(true);
    setInput("");
    const { error } = await supabase.from("messages").insert({ conversation_id: conversationId, sender_id: userId, text });
    setSending(false);
    if (error) { toast.error("Não foi possível enviar"); setInput(text); }
  };

  const asSeller = conv?.store?.owner_id === userId;
  const name = asSeller ? (conv?.customer?.display_name ?? "Cliente") : (conv?.store?.name ?? "Loja");
  const avatar = asSeller ? conv?.customer?.avatar_url : conv?.store?.logo_url;
  const avatarBucket = asSeller ? "avatars" : "store-assets";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-4 py-3">
        <button onClick={onBack} aria-label="Voltar"><ArrowLeft size={20} /></button>
        <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-accent text-xl">
          {avatar ? <StorageImage bucket={avatarBucket} path={avatar} alt="" className="h-full w-full object-cover" /> : "🛍️"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="text-[11px]" aria-live="polite">
            {peerTyping ? (
              <span className="text-primary">a escrever…</span>
            ) : peerOnline ? (
              <span className="text-primary">● online</span>
            ) : (
              <span className="text-muted-foreground">offline</span>
            )}
          </p>
        </div>
      </header>
      <div className="flex-1 space-y-3 px-4 py-4">
        <div className="mx-auto flex max-w-[80%] items-center gap-1.5 rounded-full bg-accent px-3 py-1 text-[11px] text-accent-foreground">
          <ShieldCheck size={12} /> Conversa protegida pelo Live Teká
        </div>
        {msgs.map((m) => {
          const mine = m.sender_id === userId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted text-foreground"}`}>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
                <p className={`mt-0.5 text-[10px] ${mine ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <form onSubmit={send} className="sticky bottom-0 flex items-center gap-2 border-t border-border bg-background p-3">
        <Input
          value={input}
          onChange={(e) => { setInput(e.target.value); sendTyping(); }}
          placeholder={t("chat_placeholder")}
          maxLength={4000}
          aria-label="Mensagem"
          className="h-11 flex-1 rounded-full bg-muted"
        />
        <button type="submit" disabled={sending || !input.trim()} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-glow)] disabled:opacity-50">
          {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
        </button>
      </form>
    </div>
  );
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}