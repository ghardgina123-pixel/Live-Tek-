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
import { useT } from "@/lib/i18n";

type Props = { trigger: React.ReactNode };

export function SettingsSheet({ trigger }: Props) {
  const { t } = useT();
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
          <SheetTitle>{t("s_configuracoes")}</SheetTitle>
          <SheetDescription className="text-xs">
            {user?.email ?? t("s_faca_login_para_acessar")}
          </SheetDescription>
        </SheetHeader>

        <Section title={t("s_minha_conta")}>
          <Row icon={UserIcon} label={t("s_editar_perfil")} to="/editar-perfil" onClick={close} />
          <Row icon={MapPin} label={t("s_enderecos_para_entrega")} to="/enderecos" onClick={close} />
          <Row icon={ShieldCheck} label={t("s_seguranca_e_privacidade")} to="/seguranca" onClick={close} />
          <Row icon={Languages} label={t("s_idioma_regiao_e_moeda")} to="/idioma" onClick={close} />
        </Section>

        <Section title={t("s_como_cliente")}>
          <Row icon={ShoppingBag} label={t("s_minhas_compras")} to="/compras" onClick={close} badge="3" />
          <Row icon={Heart} label={t("s_favoritos")} to="/favoritos" onClick={close} />
          <Row icon={CreditCard} label={t("s_metodos_de_pagamento")} to="/pagamentos" onClick={close} />
          <Row icon={Users} label={t("s_afiliados")} to="/afiliados" onClick={close} />
        </Section>

        <Section title={t("s_como_lojista")}>
          {hasStore ? (
            <>
              <Row icon={StoreIcon} label={t("s_minha_loja")} to="/lojista" onClick={close} />
              <Row icon={Package} label={t("s_meus_produtos")} to="/lojista" onClick={close} />
              <Row icon={ClipboardList} label={t("s_pedidos_recebidos")} to="/lojista" onClick={close} />
              <Row icon={Wallet} label={t("s_financeiro_saques")} to="/lojista" onClick={close} />
              <Row icon={Sparkles} label={t("s_crm_premium")} to="/lojista-crm" onClick={close} badge="PRO" badgeTone="premium" />
            </>
          ) : (
            <Row icon={StoreIcon} label={t("s_quero_vender_registrar_loja")} to="/lojista" onClick={close} />
          )}
        </Section>

        <Section title={t("s_suporte")}>
          <Row icon={HelpCircle} label={t("s_ajuda_e_suporte")} to="/ajuda" onClick={close} />
          <Row icon={FileText} label={t("s_termos_e_privacidade")} to="/termos" onClick={close} />
        </Section>

        {isAdmin && (
          <Section title={t("s_administracao")}>
            <Row icon={ShieldAlert} label={t("s_aprovar_crm_premium")} to="/admin-crm" onClick={close} />
          </Section>
        )}

        <div className="px-4 pb-8 pt-2">
          {user ? (
            <button
              onClick={handleLogout}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-destructive"
            >
              <LogOut size={16} /> {t("s_sair_da_conta")}
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
          <p className="mt-4 text-center text-[10px] text-muted-foreground">{t("s_live_teka_v1_0_feito_com")}</p>
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
              ? "rounded-full bg-gradient-to-r from-amber-400 to-orange-500 px-2 py-0.5 text-[9px] font-bold text-white" : "rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground"
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