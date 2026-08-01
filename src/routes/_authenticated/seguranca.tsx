import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, KeyRound } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/seguranca")({
  head: () => ({ meta: [{ title: "Segurança — Live Teká" }] }),
  component: Seguranca,
});

function Seguranca() {
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [saving, setSaving] = useState(false);

  const change = async () => {
    if (pwd.length < 6) return toast.error("Senha mínima de 6 caracteres");
    if (pwd !== pwd2) return toast.error("As senhas não coincidem");
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setSaving(false);
    if (error) return toast.error(error.message);
    setPwd(""); setPwd2("");
    toast.success("Senha atualizada");
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Segurança e privacidade</h1>
      </header>
      <div className="space-y-5 px-5 py-5">
        <section className="rounded-2xl border border-border p-4">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold"><KeyRound size={16} /> Alterar senha</h2>
          <div className="space-y-3">
            <div><Label>Nova senha</Label><Input type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} /></div>
            <div><Label>Confirme a senha</Label><Input type="password" value={pwd2} onChange={(e) => setPwd2(e.target.value)} /></div>
            <Button onClick={change} disabled={saving} className="w-full">
              {saving ? <Loader2 className="animate-spin" size={16} /> : "Atualizar senha"}
            </Button>
          </div>
        </section>
        <section className="rounded-2xl border border-border p-4 text-sm text-muted-foreground">
          <h2 className="mb-2 text-sm font-bold text-foreground">Privacidade</h2>
          <p>Seus dados são usados apenas para operar a Live Teká. Nunca os vendemos a terceiros.</p>
        </section>
      </div>
    </AppShell>
  );
}