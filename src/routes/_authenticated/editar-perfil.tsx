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

export const Route = createFileRoute("/_authenticated/editar-perfil")({
  head: () => ({ meta: [{ title: "Editar perfil — Live Teká" }] }),
  component: EditarPerfil,
});

function EditarPerfil() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("display_name, phone, avatar_url").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        setDisplayName(data?.display_name ?? "");
        setPhone(data?.phone ?? "");
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
    toast.success("Perfil atualizado");
    nav({ to: "/perfil" });
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">Editar perfil</h1>
      </header>
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
      ) : (
        <div className="space-y-4 px-5 py-5">
          <div><Label>Email</Label><Input value={user?.email ?? ""} disabled /></div>
          <div><Label>Nome de exibição</Label><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></div>
          <div><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+244 ..." /></div>
          <div><Label>URL do avatar</Label><Input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." /></div>
          <Button onClick={save} disabled={saving} className="w-full">
            {saving ? <Loader2 className="animate-spin" size={16} /> : <><Save size={16} className="mr-2" /> Salvar alterações</>}
          </Button>
        </div>
      )}
    </AppShell>
  );
}