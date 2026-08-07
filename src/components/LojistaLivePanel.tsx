import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Send, Users, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { z } from "zod";
import { useT } from "@/lib/i18n";

type Msg = { id: string; sender_id: string; text: string; created_at: string };
type Profile = { display_name: string | null; avatar_url: string | null };

const msgSchema = z.string().trim().min(1).max(500);

/**
 * Painel do lojista para a live activa: chat em tempo real + contador de espetadores.
 * Subscreve exactamente o mesmo canal que o cliente (live_messages, live_viewers)
 * filtrado por live_id, para que a comunicação seja bidireccional.
 */
export function LojistaLivePanel({ liveId }: { liveId: string }) {
  const { t } = useT();
  const { user } = useAuth();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [viewers, setViewers] = useState<number>(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const pendingIds = useRef<Set<string>>(new Set());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushProfiles = useCallback(() => {
    const ids = Array.from(pendingIds.current);
    pendingIds.current.clear();
    flushTimer.current = null;
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
  const queueProfile = useCallback((id: string) => {
    pendingIds.current.add(id);
    if (!flushTimer.current) flushTimer.current = setTimeout(flushProfiles, 250);
  }, [flushProfiles]);

  const refreshViewers = useCallback(async () => {
    const cutoff = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from("live_viewers")
      .select("*", { count: "exact", head: true })
      .eq("live_id", liveId)
      .gte("last_seen_at", cutoff);
    setViewers(count ?? 0);
  }, [liveId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: m } = await supabase.from("live_messages")
        .select("id, sender_id, text, created_at").eq("live_id", liveId)
        .order("created_at", { ascending: true }).limit(100);
      if (cancelled) return;
      const messages = (m as Msg[]) ?? [];
      setMsgs(messages);
      const ids = Array.from(new Set(messages.map((x) => x.sender_id)));
      if (ids.length) {
        const { data: ps } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids);
        if (!cancelled) {
          const map: Record<string, Profile> = {};
          (ps ?? []).forEach((p) => { map[p.id] = { display_name: p.display_name, avatar_url: p.avatar_url }; });
          setProfiles(map);
        }
      }
      await refreshViewers();
      if (!cancelled) setLoading(false);
    })();

    const ch = supabase
      .channel(`lojista-live-${liveId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "live_messages", filter: `live_id=eq.${liveId}` }, (payload) => {
        const m = payload.new as Msg;
        setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-200)));
        setProfiles((p) => { if (!p[m.sender_id]) queueProfile(m.sender_id); return p; });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_viewers", filter: `live_id=eq.${liveId}` }, () => {
        refreshViewers();
      })
      .subscribe();

    const iv = setInterval(refreshViewers, 30_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      supabase.removeChannel(ch);
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, [liveId, queueProfile, refreshViewers]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    return () => cancelAnimationFrame(raf);
  }, [msgs.length]);

  const send = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error(t("s_sessao_expirou"));
    const parsed = msgSchema.safeParse(text);
    if (!parsed.success) return toast.error(t("s_mensagem_invalida"));
    setSending(true);
    const value = parsed.data;
    setText("");
    const { error } = await supabase.from("live_messages").insert({ live_id: liveId, sender_id: user.id, text: value });
    setSending(false);
    if (error) { setText(value); toast.error(error.message); }
  }, [user, text, liveId]);

  const rows = useMemo(() => msgs, [msgs]);

  return (
    <div className="mt-3 grid gap-3 rounded-2xl border border-border bg-muted/30 p-3">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <MessageCircle size={14} className="text-primary" /> {t("s_chat_da_live")}
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-0.5 font-semibold text-foreground shadow-sm">
          <Users size={12} className="text-primary" /> {viewers} <span className="text-muted-foreground">{t("s_espetadores")}</span>
        </span>
      </div>

      <div className="h-64 space-y-1.5 overflow-y-auto rounded-xl bg-background p-2.5 text-sm">
        {loading ? (
          <div className="flex h-full items-center justify-center"><Loader2 className="animate-spin text-primary" size={16} /></div>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">{t("s_sem_mensagens_ainda_aguarde_a_interaccao_dos_cli")}</p>
        ) : (
          rows.map((m) => <Row key={m.id} msg={m} profile={profiles[m.sender_id]} />)
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={send} className="flex items-center gap-2">
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("s_responder_a_audiencia")}
          maxLength={500}
          disabled={!user || sending}
          className="h-10 flex-1 rounded-full"
        />
        <button
          type="submit"
          disabled={!user || !text.trim() || sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
          aria-label={t("s_enviar_mensagem")}
        >
          {sending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

const Row = memo(function Row({ msg, profile }: { msg: Msg; profile?: Profile }) {
  return (
    <div className="flex items-start gap-2">
      <div className="mt-0.5 h-6 w-6 shrink-0 overflow-hidden rounded-full bg-muted">
        {profile?.avatar_url && <img src={profile.avatar_url} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0">
        <span className="mr-1.5 text-[11px] font-bold text-primary">{profile?.display_name ?? t("s_cliente")}</span>
        <span className="text-foreground/90">{msg.text}</span>
      </div>
    </div>
  );
});