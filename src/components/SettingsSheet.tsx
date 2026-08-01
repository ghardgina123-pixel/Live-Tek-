import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription,
} from "@/components/ui/sheet";
import {
  User as UserIcon, MapPin, ShieldCheck, Languages, ShoppingBag, Heart, CreditCard,
  Users, Store as StoreIcon, Package, ClipboardList, Wallet, Sparkles, HelpCircle,
  FileText, LogOut, ChevronRight, ShieldAlert,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

type Props = { trigger: React.ReactNode };

export function SettingsSheet({ trigger }: Props) {
  const { user, signOut } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [hasStore, setHasStore] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    supabase.from("stores").select("id").eq("owner_id", user.id).maybeSingle()
      .then(({ data }) => setHasStore(!!data));
    supabase.from("user_roles").select("role").eq("user_id", user.id)
      .then(({ data }) => setIsAdmin((data ?? []).some((r) => r.role === "admin")));
  }, [open, user?.id]);

  const handleLogout = async () => {
    setOpen(false);
    await signOut();
    nav({ to: "/login", replace: true });
  };

  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent side="right" className="w-[88vw] max-w-[400px] overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3">
          <SheetTitle>Configurações</SheetTitle>
          <SheetDescription className="text-xs">
            {user?.email ?? "Faça login para acessar"}
          </SheetDescription>
        </SheetHeader>

        <Section title="Minha conta">
          <Row icon={UserIcon} label="Editar perfil" to="/editar-perfil" onClick={close} />
          <Row icon={MapPin} label="Endereços para entrega" to="/enderecos" onClick={close} />
          <Row icon={ShieldCheck} label="Segurança e privacidade" to="/seguranca" onClick={close} />
          <Row icon={Languages} label="Idioma, região e moeda" to="/idioma" onClick={close} />
        </Section>

        <Section title="Como cliente">
          <Row icon={ShoppingBag} label="Minhas compras" to="/compras" onClick={close} badge="3" />
          <Row icon={Heart} label="Favoritos" to="/favoritos" onClick={close} />
          <Row icon={CreditCard} label="Métodos de pagamento" to="/pagamentos" onClick={close} />
          <Row icon={Users} label="Afiliados" to="/afiliados" onClick={close} />
        </Section>

        <Section title="Como lojista">
          {hasStore ? (
            <>
              <Row icon={StoreIcon} label="Minha loja" to="/lojista" onClick={close} />
              <Row icon={Package} label="Meus produtos" to="/lojista" onClick={close} />
              <Row icon={ClipboardList} label="Pedidos recebidos" to="/lojista" onClick={close} />
              <Row icon={Wallet} label="Financeiro / Saques" to="/lojista" onClick={close} />
              <Row icon={Sparkles} label="CRM Premium" to="/lojista-crm" onClick={close} badge="PRO" badgeTone="premium" />
            </>
          ) : (
            <Row icon={StoreIcon} label="Quero vender / Registrar loja" to="/lojista" onClick={close} />
          )}
        </Section>

        <Section title="Suporte">
          <Row icon={HelpCircle} label="Ajuda e suporte" to="/ajuda" onClick={close} />
          <Row icon={FileText} label="Termos e privacidade" to="/termos" onClick={close} />
        </Section>

        {isAdmin && (
          <Section title="Administração">
            <Row icon={ShieldAlert} label="Aprovar CRM Premium" to="/admin-crm" onClick={close} />
          </Section>
        )}

        <div className="px-4 pb-8 pt-2">
          {user ? (
            <button
              onClick={handleLogout}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-destructive"
            >
              <LogOut size={16} /> Sair da conta
            </button>
          ) : (
            <Link
              to="/login"
              onClick={close}
              className="flex h-11 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              Entrar
            </Link>
          )}
          <p className="mt-4 text-center text-[10px] text-muted-foreground">Live Teká v1.0 · Feito com 💚</p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-2 pt-3">
      <h3 className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border rounded-xl bg-card">{children}</ul>
    </div>
  );
}

function Row({
  icon: Icon, label, to, onClick, badge, badgeTone,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  to?: string;
  onClick?: () => void;
  badge?: string;
  badgeTone?: "premium" | "default";
}) {
  const inner = (
    <div className="flex w-full items-center gap-3 px-3 py-3 text-left">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <Icon size={16} />
      </div>
      <span className="flex-1 text-sm font-medium text-foreground">{label}</span>
      {badge && (
        <span
          className={
            badgeTone === "premium"
              ? "rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[9px] font-bold text-white"
              : "rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground"
          }
        >
          {badge}
        </span>
      )}
      <ChevronRight size={14} className="text-muted-foreground" />
    </div>
  );
  if (to) {
    return (
      <li>
        <Link to={to} onClick={onClick} className="block">{inner}</Link>
      </li>
    );
  }
  return (
    <li>
      <button onClick={onClick} className="block w-full">{inner}</button>
    </li>
  );
}