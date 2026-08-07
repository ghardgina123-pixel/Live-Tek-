import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, BarChart3, Package, ShoppingBag, Menu, Wallet, Radio, Settings, Loader2, Film, Crown } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/lib/i18n";

export type LojistaStore = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected";
  logo_url: string | null;
  cover_url: string | null;
  rejection_reason: string | null;
};

const NAV = [
  { to: "/lojista/dashboard", label: "Visão geral", icon: BarChart3 },
  { to: "/lojista/produtos", label: "Produtos", icon: Package },
  { to: "/lojista/pedidos", label: "Pedidos", icon: ShoppingBag },
  { to: "/lojista/videos", label: "Shorts da loja", icon: Film },
  { to: "/lojista/lives", label: "Lives", icon: Radio },
  { to: "/lojista-crm", label: "CRM Premium", icon: Wallet },
  { to: "/lojista/subscricao", label: "Subscrição", icon: Crown },
] as const;

export function useLojistaStore() {
  const { user } = useAuth();
  const [store, setStore] = useState<LojistaStore | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!user) return;
    supabase
      .from("stores")
      .select("id, name, status, logo_url, cover_url, rejection_reason")
      .eq("owner_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setStore((data as LojistaStore) ?? null);
        setLoading(false);
      });
  }, [user?.id]);
  return { store, loading };
}

export function LojistaShell({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useT();
  const { store, loading } = useLojistaStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    if (loading) return;
    if (!store || store.status !== "active") {
      navigate({ to: "/lojista" });
    }
  }, [loading, store, navigate]);

  if (loading || !store || store.status !== "active") {
    return (
      <AppShell>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="relative z-20 flex items-center gap-3 px-5 pr-16 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <BackButton fallback="/perfil" />
        <Sheet>
          <SheetTrigger asChild>
            <button
              className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 p-3 transition active:scale-95 active:bg-white/30 active:opacity-70"
              style={{ touchAction: "manipulation" }}
              aria-label={t("s_menu_do_lojista")}
            >
              <Menu size={18} />
            </button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[260px] p-0">
            <SheetHeader className="border-b p-4 text-left">
              <SheetTitle className="text-base">{store.name}</SheetTitle>
              <p className="text-xs text-muted-foreground">{t("s_painel_do_lojista")}</p>
            </SheetHeader>
            <nav className="p-2">
              {NAV.map((item) => {
                const active = pathname === item.to || pathname.startsWith(item.to + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-primary text-primary-foreground font-semibold" : "text-foreground hover:bg-accent"}`}
                  >
                    <Icon size={18} />
                    {item.label}
                  </Link>
                );
              })}
              <div className="my-2 border-t" />
              <Link to="/perfil" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent">
                <ArrowLeft size={18} /> {t("s_voltar_ao_perfil")}
              </Link>
              <Link to="/lojista" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent">
                <Settings size={18} /> {t("s_configuracoes_da_loja")}
              </Link>
            </nav>
          </SheetContent>
        </Sheet>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-white/80">{store.name}</p>
          <h1 className="truncate text-lg font-semibold">{title}</h1>
        </div>
        {store.logo_url && (
          <img src={store.logo_url} alt={t("s_logo")} className="h-9 w-9 shrink-0 rounded-full border-2 border-white/50 object-cover" />
        )}
      </header>
      <div className="px-5 py-5">{children}</div>
    </AppShell>
  );
}