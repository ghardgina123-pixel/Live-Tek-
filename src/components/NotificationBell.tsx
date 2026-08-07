import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, Check, CheckCheck, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pt } from "date-fns/locale";
import { useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { useAuth } from "@/hooks/use-auth";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type UserNotif = {
  id: string;
  user_id: string;
  kind: string;
  title: string | null;
  body: string | null;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

type AdminNotif = {
  id: string;
  kind: string;
  subject: string | null;
  payload: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type Item =
  | { kind: "user"; row: UserNotif }
  | { kind: "admin"; row: AdminNotif };

export function NotificationBell() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userItems, setUserItems] = useState<UserNotif[]>([]);
  const [adminItems, setAdminItems] = useState<AdminNotif[]>([]);

  // Detect admin role
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    supabase.rpc("has_role", { _user_id: user.id, _role: "admin" }).then(({ data }) => {
      setIsAdmin(Boolean(data));
    });
  }, [user?.id]);

  // Initial load
  useEffect(() => {
    if (!user) { setUserItems([]); setAdminItems([]); return; }
    let cancelled = false;
    (async () => {
      const { data: u } = await supabase
        .from("user_notifications")
        .select("id, user_id, kind, title, body, url, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);
      if (!cancelled) setUserItems((u as UserNotif[]) ?? []);
      if (isAdmin) {
        const { data: a } = await supabase
          .from("admin_notifications")
          .select("id, kind, subject, payload, read_at, created_at")
          .order("created_at", { ascending: false })
          .limit(30);
        if (!cancelled) setAdminItems((a as AdminNotif[]) ?? []);
      } else if (!cancelled) {
        setAdminItems([]);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, isAdmin]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const ch = supabase.channel(`notif-${user.id}`);

    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        setUserItems((prev) => [payload.new as UserNotif, ...prev].slice(0, 60));
      },
    ).on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "user_notifications", filter: `user_id=eq.${user.id}` },
      (payload) => {
        const row = payload.new as UserNotif;
        setUserItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
      },
    );

    if (isAdmin) {
      ch.on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "admin_notifications" },
        (payload) => {
          setAdminItems((prev) => [payload.new as AdminNotif, ...prev].slice(0, 60));
        },
      ).on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "admin_notifications" },
        (payload) => {
          const row = payload.new as AdminNotif;
          setAdminItems((prev) => prev.map((n) => (n.id === row.id ? row : n)));
        },
      );
    }

    ch.subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user?.id, isAdmin]);

  const items = useMemo<Item[]>(() => {
    const merged: Item[] = [
      ...userItems.map((row) => ({ kind: "user" as const, row })),
      ...adminItems.map((row) => ({ kind: "admin" as const, row })),
    ];
    merged.sort((a, b) => (a.row.created_at < b.row.created_at ? 1 : -1));
    return merged;
  }, [userItems, adminItems]);

  const unreadCount = useMemo(
    () => items.reduce((n, it) => n + (it.row.read_at ? 0 : 1), 0),
    [items],
  );

  const markOne = useCallback(async (it: Item) => {
    const now = new Date().toISOString();
    if (it.kind === "user") {
      setUserItems((prev) => prev.map((n) => (n.id === it.row.id ? { ...n, read_at: now } : n)));
      await supabase.from("user_notifications").update({ read_at: now }).eq("id", it.row.id);
    } else {
      setAdminItems((prev) => prev.map((n) => (n.id === it.row.id ? { ...n, read_at: now } : n)));
      await supabase.from("admin_notifications").update({ read_at: now }).eq("id", it.row.id);
    }
  }, []);

  const markAll = useCallback(async () => {
    if (!user) return;
    const now = new Date().toISOString();
    const unreadUser = userItems.filter((n) => !n.read_at).map((n) => n.id);
    const unreadAdmin = adminItems.filter((n) => !n.read_at).map((n) => n.id);
    setUserItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    setAdminItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })));
    if (unreadUser.length) {
      await supabase.from("user_notifications").update({ read_at: now }).in("id", unreadUser);
    }
    if (unreadAdmin.length) {
      await supabase.from("admin_notifications").update({ read_at: now }).in("id", unreadAdmin);
    }
  }, [user, userItems, adminItems]);

  const openItem = useCallback(async (it: Item) => {
    await markOne(it);
    setOpen(false);
    const url = it.kind === "user" ? it.row.url ?? "/" : "/admin-dashboard";
    if (url.startsWith("/")) navigate({ to: url as never });
  }, [markOne, navigate]);

  if (!user) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={`Notificações${unreadCount ? `, ${unreadCount} por ler` : ""}`}
          className="relative flex h-10 w-10 items-center justify-center rounded-full bg-background border border-border shadow-sm transition active:scale-95"
        >
          <Bell size={18} className="text-foreground" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--live,#ef4444)] px-1 text-[10px] font-bold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full max-w-sm flex-col gap-0 p-0">
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <SheetTitle className="text-base">{t("notifications_title")}</SheetTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={markAll}
            disabled={unreadCount === 0}
            className="h-8 gap-1 text-xs"
          >
            <CheckCheck size={14} /> Marcar tudo
          </Button>
        </SheetHeader>
        <ScrollArea className="flex-1">
          {items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Sem notificações por agora.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it) => {
                const unread = !it.row.read_at;
                const isAdminItem = it.kind === "admin";
                const title = isAdminItem
                  ? (it.row as AdminNotif).subject ?? it.row.kind
                  : (it.row as UserNotif).title ?? it.row.kind;
                const body = isAdminItem
                  ? String((it.row as AdminNotif).payload?.name ?? (it.row as AdminNotif).payload?.body ?? "")
                  : (it.row as UserNotif).body ?? "";
                return (
                  <li key={`${it.kind}-${it.row.id}`}>
                    <button
                      onClick={() => openItem(it)}
                      className={cn(
                        "flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-muted/60",
                        unread && "bg-muted/30",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          isAdminItem ? "bg-amber-500/15 text-amber-600" : "bg-primary/10 text-primary",
                        )}
                      >
                        {isAdminItem ? <ShieldAlert size={16} /> : <Bell size={16} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn("truncate text-sm", unread ? "font-semibold" : "font-medium")}>
                            {title}
                          </p>
                          {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--live,#ef4444)]" />}
                        </div>
                        {body && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">{body}</p>
                        )}
                        <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          {formatDistanceToNow(new Date(it.row.created_at), { addSuffix: true, locale: pt })}
                        </p>
                      </div>
                      {unread && (
                        <span
                          role="button"
                          aria-label={t("mark_all_read")}
                          onClick={(e) => { e.stopPropagation(); markOne(it); }}
                          className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
                        >
                          <Check size={14} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}