import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Lock, Loader2, Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/nova-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Definir nova palavra-passe — Live Teká" },
      { name: "description", content: "Defina uma nova palavra-passe para a sua conta Live Teká através do link seguro recebido por e-mail." },
      { property: "og:title", content: "Definir nova palavra-passe — Live Teká" },
      { property: "og:description", content: "Defina uma nova palavra-passe para a sua conta Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NovaPassword,
});

function NovaPassword() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwd2, setPwd2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  // O link do e-mail chega como ?token_hash=...&type=recovery (fluxo novo)
  // ou como #access_token=... (fluxo implícito, tratado pelo cliente Supabase).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(window.location.href);
      const tokenHash = url.searchParams.get("token_hash") ?? url.searchParams.get("token");
      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
        if (cancelled) return;
        if (error) { setInvalid(true); setReady(true); return; }
        window.history.replaceState({}, "", "/nova-password");
        setReady(true);
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      setInvalid(!data.session);
      setReady(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwd.length < 8) return toast.error("A palavra-passe deve ter pelo menos 8 caracteres.");
    if (pwd !== pwd2) return toast.error("As palavras-passe não coincidem.");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Palavra-passe atualizada. Entre novamente.");
    await supabase.auth.signOut();
    nav({ to: "/login", replace: true });
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-background px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground">Definir nova palavra-passe</h1>
      {invalid ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            Este link de recuperação é inválido ou já expirou. Peça um novo link.
          </p>
          <Button className="mt-6 h-12 rounded-xl" onClick={() => nav({ to: "/recuperar-password" })}>
            Pedir novo link
          </Button>
        </>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              className="h-12 pl-10 pr-10"
              placeholder="Nova palavra-passe"
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-label={show ? "Ocultar palavra-passe" : "Mostrar palavra-passe"}
            >
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              type={show ? "text" : "password"}
              autoComplete="new-password"
              required
              minLength={8}
              className="h-12 pl-10"
              placeholder="Confirmar palavra-passe"
              value={pwd2}
              onChange={(e) => setPwd2(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="h-12 w-full rounded-xl text-base font-semibold">
            {busy ? <Loader2 className="animate-spin" size={18} /> : "Guardar nova palavra-passe"}
          </Button>
        </form>
      )}
    </div>
  );
}
