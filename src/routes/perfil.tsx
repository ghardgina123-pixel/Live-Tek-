import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Settings, Package, Heart, MapPin, HelpCircle, LogOut, ChevronRight, BadgeCheck, Store as StoreIcon, Truck, Home as HomeIcon, Shield, Camera, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { CurrencySelector } from "@/components/CurrencySelector";
import { CountrySelect } from "@/components/LocationCascade";
import { SettingsSheet } from "@/components/SettingsSheet";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { signStorageUrl, uploadToBucket } from "@/lib/storage";
import { useT, type TKey } from "@/lib/i18n";

export const Route = createFileRoute("/perfil")({
  head: () => ({
    meta: [
      { title: "Perfil — Live Teká" },
      { name: "description", content: "Gira o seu perfil Live Teká: dados pessoais, endereços de entrega, pedidos, favoritos e definições da conta." },
      { property: "og:title", content: "Perfil — Live Teká" },
      { property: "og:description", content: "Gira dados pessoais, endereços, pedidos e definições da sua conta Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
      { property: "og:url", content: "https://www.livemarketplece.live/perfil" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/perfil" }],
  }),

  component: Perfil,
});

const menu: { icon: typeof Package; key: TKey; badge?: string; to: "/compras" | "/favoritos" | "/ajuda" }[] = [
  { icon: Package, key: "my_orders", badge: "3", to: "/compras" },
  { icon: Heart, key: "favorites", to: "/favoritos" },
  { icon: HelpCircle, key: "help_support", to: "/ajuda" },
];

function Perfil() {
  const { user, signOut } = useAuth();
  const { t } = useT();
  const nav = useNavigate();
  const [isAdmin, setIsAdmin] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [countryId, setCountryId] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    supabase.from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
    supabase.from("profiles").select("avatar_url, country_id").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        // A coluna guarda apenas o caminho: assinamos no momento da leitura.
        signStorageUrl("avatars", data?.avatar_url).then(setAvatarUrl);
        setCountryId((data as { country_id?: string | null } | null)?.country_id ?? null);
      });
  }, [user?.id]);

  const persistCountry = async (id: string) => {
    if (!user) return;
    setCountryId(id);
    const { error } = await supabase.from("profiles").update({ country_id: id || null }).eq("id", user.id);
    if (error) toast.error("Não foi possível salvar o país");
    else toast.success("País atualizado");
  };
  const displayName = (user?.user_metadata?.display_name as string) || user?.email?.split("@")[0] || "Convidado";
  const initials = displayName.slice(0, 2).toUpperCase();
  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem maior que 5MB"); return; }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      await uploadToBucket("avatars", path, file);
      // Guardamos o caminho — nunca uma URL assinada expirável.
      const { error: profErr } = await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
      if (profErr) throw profErr;
      setAvatarUrl(await signStorageUrl("avatars", path));
      toast.success("Foto de perfil atualizada");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao carregar foto");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const handleLogout = async () => {
    await signOut();
    nav({ to: "/login", replace: true });
  };
  return (
    <AppShell>
      <header className="px-5 pt-6 pb-6 text-white" style={{ background: "var(--gradient-brand)" }}>
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t("profile_title")}</h1>
          <SettingsSheet
            trigger={
              <button aria-label={t("settings")} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 backdrop-blur">
                <Settings size={18} />
              </button>
            }
          />
        </div>
        <div className="mt-5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => user && fileRef.current?.click()}
            disabled={!user || uploading}
            aria-label={t("edit_profile")}
            className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-white text-2xl font-bold text-secondary disabled:opacity-70"
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} loading="lazy" decoding="async" className="h-full w-full object-cover" />
            ) : (
              <span>{initials}</span>
            )}
            {user && (
              <span className="absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-white">
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
              </span>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarUpload}
          />
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-bold">{displayName}</p>
              <BadgeCheck size={16} />
            </div>
            <p className="text-xs text-white/80">{user?.email ?? t("login_to_continue")}</p>
            <span className="mt-1 inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold">Cliente Gold</span>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 rounded-2xl bg-white/15 p-3 text-center backdrop-blur">
          <Stat n="12" l={t("my_orders")} />
          <Stat n="48" l={t("favorites")} />
          <Stat n="9" l={t("following")} />
        </div>
      </header>

      <ul className="cv-auto divide-y divide-border px-2">
        {user && isAdmin && (
          <li>
            <Link to="/admin-dashboard" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: "var(--gradient-brand)" }}><Shield size={18} /></div>
              <span className="flex-1 text-sm font-bold text-foreground">{t("admin_panel")}</span>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase text-primary">Admin</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {user && (
          <li>
            <Link to="/lojista" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl text-white" style={{ background: "var(--gradient-brand)" }}><StoreIcon size={18} /></div>
              <span className="flex-1 text-sm font-semibold text-foreground">{t("seller_panel")}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {user && (
          <li>
            <Link to="/transportador" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Truck size={18} /></div>
              <span className="flex-1 text-sm font-semibold text-foreground">{t("courier_panel")}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {user && (
          <li>
            <Link to="/entregador" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-secondary-foreground"><Truck size={18} /></div>
              <span className="flex-1 text-sm font-semibold text-foreground">Minhas entregas</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {user && (
          <li>
            <Link to="/imobiliaria" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><HomeIcon size={18} /></div>
              <span className="flex-1 text-sm font-semibold text-foreground">{t("realestate_panel")}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {user && (
          <li>
            <Link to="/enderecos" className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-foreground"><MapPin size={18} /></div>
              <span className="flex-1 text-sm font-medium text-foreground">{t("addresses")}</span>
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        )}
        {menu.map(({ icon: Icon, key, badge, to }) => (
          <li key={key}>
            <Link to={to} className="flex w-full items-center gap-3 px-3 py-4 text-left">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-foreground"><Icon size={18} /></div>
              <span className="flex-1 text-sm font-medium text-foreground">{t(key)}</span>
              {badge && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">{badge}</span>}
              <ChevronRight size={16} className="text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="px-5 pt-4">
        <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("currency")}</h3>
        <CurrencySelector variant="row" />
      </div>

      {user && (
        <div className="px-5 pt-4">
          <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("country")}</h3>
          <CountrySelect value={countryId} onChange={persistCountry} />
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t("country_default_hint")}
          </p>
        </div>
      )}

      <div className="px-5 pt-3">
        {user ? (
          <button onClick={handleLogout} className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-destructive">
            <LogOut size={16} /> {t("logout")}
          </button>
        ) : (
          <Link to="/login" className="flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-primary">
            {t("login")}
          </Link>
        )}
        <p className="mt-4 text-center text-[10px] text-muted-foreground">Live Teká v1.0 · Feito com 💚</p>
      </div>
    </AppShell>
  );
}

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div>
      <p className="text-lg font-bold">{n}</p>
      <p className="text-[10px] text-white/80">{l}</p>
    </div>
  );
}