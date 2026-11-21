import { useEffect, useState } from "react";
import { IdCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { identitySchema } from "@/lib/schemas";

type Status = { registered: boolean; legal_name?: string; nif_masked?: string; bi_masked?: string };

const ERRORS: Record<string, string> = {
  identity_already_registered: "Este NIF ou BI já está associado a outra conta pessoal.",
  identity_invalid: "NIF ou BI inválido.",
  identity_locked: "A identidade já foi registada. Para corrigir, contacte a administração.",
  name_required: "Indique o nome completo.",
};

/** Identidade pessoal (uma por pessoa). Lojas não dependem desta unicidade. */
export function IdentityCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [f, setF] = useState({ name: "", nif: "", bi: "" });
  const [busy, setBusy] = useState(false);
  const load = () => supabase.rpc("my_identity_status").then(({ data }) => setStatus((data as Status) ?? { registered: false }));
  useEffect(() => { load(); }, []);
  if (!status) return null;

  if (status.registered) {
    return (
      <section className="mx-5 mt-4 rounded-2xl bg-card p-4 text-sm shadow-[var(--shadow-soft)]">
        <p className="flex items-center gap-2 font-semibold"><IdCard size={16} className="text-primary" /> Identidade pessoal</p>
        <p className="mt-1 text-muted-foreground">{status.legal_name} · NIF {status.nif_masked} · BI {status.bi_masked}</p>
      </section>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const p = identitySchema.safeParse({ nif: f.nif, bi: f.bi });
    if (!p.success) return toast.error(p.error.issues[0]?.message ?? "Dados inválidos");
    setBusy(true);
    const { data, error } = await supabase.rpc("register_my_identity", { _full_name: f.name, _nif: p.data.nif, _bi: p.data.bi });
    setBusy(false);
    const r = data as { ok: boolean; error?: string } | null;
    if (error || !r?.ok) return toast.error(ERRORS[r?.error ?? ""] ?? "Não foi possível registar a identidade.");
    toast.success("Identidade registada.");
    load();
  };

  return (
    <form onSubmit={submit} className="mx-5 mt-4 space-y-2 rounded-2xl bg-card p-4 text-sm shadow-[var(--shadow-soft)]">
      <p className="flex items-center gap-2 font-semibold"><IdCard size={16} className="text-primary" /> Complete a sua identidade pessoal</p>
      <p className="text-xs text-muted-foreground">Uma conta pessoal por pessoa. Depois de gravados, o NIF e o BI só podem ser corrigidos pela administração.</p>
      <Input placeholder="Nome completo" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <Input placeholder="NIF pessoal" value={f.nif} onChange={(e) => setF({ ...f, nif: e.target.value })} required />
      <Input placeholder="Número do Bilhete de Identidade" value={f.bi} onChange={(e) => setF({ ...f, bi: e.target.value })} required />
      <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" size={16} /> : "Gravar identidade"}</Button>
    </form>
  );
}
