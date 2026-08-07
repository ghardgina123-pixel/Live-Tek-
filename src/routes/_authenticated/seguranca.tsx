import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, KeyRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/seguranca")({
  head: () => ({ meta: [{ title: "Segurança — Live Teká" }] }),
  component: Seguranca,
});

function Seguranca() {
  const { t } = useT();
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async () => {
    if (pwd.length < 6) return toast.error(t("s_senha_minima_de_6_caracteres"));
    if (pwd !== pwd2) return toast.error(t("s_as_senhas_nao_coincidem"));
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (error) return toast.error(error.message);
    setPwd(""); setPwd2("");
    toast.success(t("s_senha_atualizada"));
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">{t("s_seguranca_e_privacidade")}</h1>
      </header>
      <div className="space-y-5 px-5 py-5">
        <section className="rounded-2xl border border-border p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><KeyRound size={16} /> {t("s_alterar_senha")}</h2>
          <div className="space-y-3">
            <div><Label>{t("s_nova_senha")}</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
            <div><Label>{t("s_confirme_a_senha")}</Label><Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} /></div>
            <Button onClick={change} disabled={saving} className="w-full">
              {saving ? <Loader2 className="animate-spin" size={16} /> : "Atualizar senha"}
            </Button>
          </div>
        </section>
        <section className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">
          <h2 className="mb-2 text-sm font-bold text-foreground">{t("s_privacidade")}</h2>
          <p>{t("s_seus_dados_sao_usados_apenas_para_operar_a_live")}</p>
        </section>
      </div>
    </AppShell>
  );
}