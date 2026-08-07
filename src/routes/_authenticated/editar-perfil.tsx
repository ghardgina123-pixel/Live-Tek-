import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/editar-perfil")({
  head: () => ({ meta: [{ title: "Editar perfil — Live Teká" }] }),
  component: EditarPerfil,
});

function EditarPerfil() {
  const { t } = useT();
  const { user } = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    if (!user) return;
    // O telefone deixou de ser legível na tabela (protecção de dados pessoais):
    // é obtido pela função `get_own_phone`, que devolve apenas o do próprio utilizador.
    Promise.all([
      supabase.from("profiles").select("display_name, avatar_url").eq("id", user.id).maybeSingle(),
      supabase.rpc("get_own_phone"),
    ]).then(([{ data }, { data: ownPhone }]) => {
      setDisplayName(data?.display_name ?? "");
      setPhone((ownPhone as string | null) ?? "");
      setAvatarUrl(data?.avatar_url ?? "");
      setLoading(false);
    });
  }, [user?.id]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({
      display_name: displayName, phone, avatar_url: avatarUrl,
    }).eq("id", user.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("s_perfil_atualizado"));
    nav({ to: "/perfil" });
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">{t("s_editar_perfil")}</h1>
      </header>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <div><Label>{t("s_email")}</Label><Input value={user?.email ?? ""} disabled /></div>
          <div><Label>{t("s_nome_de_exibicao")}</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>{t("s_telefone")}</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+244 ..." /></div>
          <div><Label>{t("s_url_do_avatar")}</Label><Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." /></div>
          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} className="mr-2" /> {t("s_salvar_alteracoes")}</>}
          </Button>
        </div>
      )}
    </AppShell>
  );
}