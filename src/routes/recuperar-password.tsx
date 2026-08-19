import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Loader2, KeyRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/recuperar-password")({
  head: () => ({
    meta: [
      { title: "Recuperar palavra-passe — Live Teká" },
      { name: "description", content: "Receba um link seguro por e-mail para definir uma nova palavra-passe na Live Teká." },
      { property: "og:title", content: "Recuperar palavra-passe — Live Teká" },
      { property: "og:description", content: "Receba um link seguro por e-mail para definir uma nova palavra-passe na Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Recuperar,
});

function Recuperar() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/nova-password`,
    });
    setBusy(false);
    // Nunca revelamos se o e-mail existe.
    if (error && !/rate|limit/i.test(error.message)) {
      setSent(true);
      return;
    }
    if (error) return toast.error(error.message);
    setSent(true);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col bg-background px-6 py-12">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
        <KeyRound size={26} />
      </div>
      <h1 className="mt-4 text-2xl font-bold text-foreground">Recuperar palavra-passe</h1>
      {sent ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Se existir uma conta com esse e-mail, enviámos um link seguro para definir uma nova
          palavra-passe. Verifique também a pasta de spam.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-6">
          <p className="text-sm text-muted-foreground">
            Indique o seu e-mail e receberá um link seguro para criar uma nova palavra-passe.
          </p>
          <div className="relative mt-5">
            <Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={18} />
            <Input
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              required
              className="h-12 pl-10"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy} className="mt-6 h-12 w-full rounded-xl text-base font-semibold">
            {busy ? <Loader2 className="animate-spin" size={18} /> : "Enviar link de recuperação"}
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-8 text-center text-sm font-semibold text-primary">
        Voltar ao login
      </Link>
    </div>
  );
}
