import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Mail, Lock, User as UserIcon, Phone, ShieldCheck, Loader2, ShoppingBag, Store as StoreIcon, Sparkles, AlertCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";
import { toast } from "sonner";
import { signupSchema } from "@/lib/schemas";
import { checkActionThrottle } from "@/lib/auth-throttle.functions";
import cadastroHero from "@/assets/marketing/cadastro-hero.jpg";

export const Route = createFileRoute("/cadastro")({
  head: () => ({
    meta: [
      { title: "Criar conta — Live Teká" },
      { property: "og:url", content: "https://www.livemarketplece.live/cadastro" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/cadastro" }],
  }),
  component: Signup,
});

function Signup() {
  const nav = useNavigate();
  const [accountType, setAccountType] = useState<"customer" | "seller">("customer");
  const [f, setF] = useState({ name: "", email: "", phone: "", pwd: "" });
  const [busy, setBusy] = useState(false);
  const { t } = useT();
  const [sellerStatus, setSellerStatus] = useState<{ approved_count: number; slots_left: number; fee_required: boolean; fee_aoa: number } | null>(null);

  useEffect(() => {
    let cancel = false;
    supabase.rpc("seller_signup_status").then(({ data }) => {
      if (!cancel && data) setSellerStatus(data as { approved_count: number; slots_left: number; fee_required: boolean; fee_aoa: number });
    });
    return () => { cancel = true; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = signupSchema.safeParse(f);
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos"); return; }
    setBusy(true);
    try {
      const gate = await checkActionThrottle({
        data: { action: "signup", identifier: parsed.data.email },
      });
      if (gate.blocked) {
        setBusy(false);
        toast.error(`Demasiadas tentativas. Tente novamente em ${Math.ceil(gate.retryAfterSeconds / 60)} min.`);
        return;
      }
    } catch {
      // falha do limitador não deve bloquear utilizadores legítimos
    }
    const { error } = await supabase.auth.signUp({
      email: parsed.data.email,
      password: parsed.data.pwd,
      options: {
        emailRedirectTo: window.location.origin + "/home",
        data: { display_name: parsed.data.name, phone: parsed.data.phone ?? "", account_intent: accountType },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    if (accountType === "seller") {
      toast.success("Conta criada! Verifique seu e-mail e depois complete os dados da loja.");
    } else {
      toast.success("Conta criada! Verifique seu e-mail para confirmar.");
    }
    nav({ to: "/login", replace: true });
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-background">
      <header className="flex items-center gap-3 px-5 pt-6 pb-3">
        <Link to="/login" className="text-2xl text-foreground">←</Link>
        <h1 className="text-lg font-semibold">{t("create_account")}</h1>
      </header>
      <form onSubmit={onSubmit} className="flex-1 px-6">
        <div className="relative mb-4 overflow-hidden rounded-2xl shadow-[var(--shadow-soft)]">
          <img
            src={cadastroHero}
            alt="Lojistas angolanos vendendo ao vivo no Live Teká"
            width={1280}
            height={896}
            loading="eager"
            decoding="async"
            className="h-36 w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-3 text-white">
            <p className="text-sm font-bold leading-tight">Junte-se ao Live Teká</p>
            <p className="text-[11px] text-white/85">Compre ou venda ao vivo em Angola.</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Escolha como você quer usar a Live Teká.</p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <TypeCard
            active={accountType === "customer"}
            icon={<ShoppingBag size={20} />}
            title="Sou Cliente"
            desc="Quero comprar"
            onClick={() => setAccountType("customer")}
          />
          <TypeCard
            active={accountType === "seller"}
            icon={<StoreIcon size={20} />}
            title="Sou Lojista"
            desc="Quero vender"
            onClick={() => setAccountType("seller")}
          />
        </div>

        <div className="mt-6 space-y-4">
          <Field icon={<UserIcon size={18} />} placeholder={t("full_name")} value={f.name} onChange={(v) => setF({ ...f, name: v })} required />
          <Field icon={<Mail size={18} />} placeholder={t("email")} type="email" value={f.email} onChange={(v) => setF({ ...f, email: v })} required />
          <Field icon={<Phone size={18} />} placeholder={t("phone")} value={f.phone} onChange={(v) => setF({ ...f, phone: v })} />
          <Field icon={<Lock size={18} />} type="password" placeholder={t("password")} value={f.pwd} onChange={(v) => setF({ ...f, pwd: v })} required />
        </div>
        {accountType === "seller" ? (
          <>
            {sellerStatus && (
              <div className={`mt-5 flex items-start gap-2 rounded-xl p-3 text-xs ${sellerStatus.fee_required ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"}`}>
                {sellerStatus.fee_required ? <AlertCircle size={16} className="mt-0.5 shrink-0" /> : <Sparkles size={16} className="mt-0.5 shrink-0" />}
                <div>
                  <p className="font-bold">
                    {sellerStatus.fee_required
                      ? "As 50 vagas gratuitas foram preenchidas."
                      : `Restam ${sellerStatus.slots_left} de 50 vagas gratuitas.`}
                  </p>
                  <p className="mt-1 leading-relaxed">
                    {sellerStatus.fee_required
                      ? `Será cobrada a Taxa de Inscrição de ${sellerStatus.fee_aoa.toLocaleString("pt-AO")} AOA após criar a conta.`
                      : "As primeiras 50 lojas aprovadas ficam isentas da taxa de adesão. Garanta a sua vaga!"}
                  </p>
                </div>
              </div>
            )}
            <div className="mt-3 flex items-start gap-2 rounded-xl bg-primary/10 p-3 text-xs text-foreground">
              <StoreIcon size={16} className="mt-0.5 shrink-0 text-primary" />
              Após criar a conta você completa os dados da empresa (NIF, endereço, banco e localização no mapa) no painel da loja.
            </div>
          </>
        ) : (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-accent p-3 text-xs text-accent-foreground">
            <ShieldCheck size={16} className="mt-0.5 shrink-0" />
            Seus dados são protegidos. Não compartilhamos com terceiros.
          </div>
        )}
        <Button type="submit" disabled={busy} className="mt-6 h-12 w-full rounded-xl text-base font-semibold shadow-[var(--shadow-glow)]">
          {busy ? <Loader2 className="animate-spin" size={18} /> : accountType === "seller" ? "Criar conta de lojista" : "Criar conta"}
        </Button>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("have_account")} <Link to="/login" className="font-semibold text-primary">{t("login")}</Link>
        </p>
      </form>
    </div>
  );
}

function TypeCard({ active, icon, title, desc, onClick }: { active: boolean; icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start gap-1 rounded-2xl border-2 p-3 text-left transition ${active ? "border-primary bg-primary/5" : "border-border bg-card"}`}
    >
      <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${active ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
        {icon}
      </div>
      <p className="text-sm font-bold">{title}</p>
      <p className="text-[11px] text-muted-foreground">{desc}</p>
    </button>
  );
}

function Field({ icon, value, onChange, placeholder, type = "text", required }: { icon: React.ReactNode; value: string; onChange: (v: string) => void; placeholder: string; type?: string; required?: boolean }) {
  return (
    <div className="relative">
      <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{icon}</div>
      <Input type={type} required={required} className="h-12 pl-10" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}