import { useEffect, useState } from "react";
import { IdCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { identitySchema } from "@/lib/schemas";

type Status = { registered: boolean; legal_name?: string; company_nif_masked?: string | null; bi_masked?: string };

const ERRORS: Record<string, string> = {
  identity_already_registered: "Este BI já está associado a outra conta pessoal.",
  identity_invalid: "BI ou NIF empresarial inválido.",
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
        <p className="mt-1 break-words text-muted-foreground">{status.legal_name} · BI {status.bi_masked}</p>
        {status.company_nif_masked && <p className="mt-1 text-muted-foreground">NIF empresarial {status.company_nif_masked}</p>}
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
      <Input aria-label="Nome completo" placeholder="Nome completo" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      <Input aria-label="NIF empresarial (opcional)" placeholder="NIF empresarial (opcional)" value={f.nif} onChange={(e) => setF({ ...f, nif: e.target.value })} />
      <Input aria-label="Número do Bilhete de Identidade" placeholder="Número do Bilhete de Identidade" value={f.bi} onChange={(e) => setF({ ...f, bi: e.target.value })} required />
      <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" size={16} /> : "Gravar identidade"}</Button>
    </form>
  );
}
