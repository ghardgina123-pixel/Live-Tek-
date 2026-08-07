import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Loader2, Trash2, Pencil, Clock, CheckCircle2, XCircle } from "lucide-react";
import { LojistaShell, useLojistaStore } from "@/components/LojistaShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { productSchema } from "@/lib/schemas";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/lojista/produtos")({
  head: () => ({ meta: [{ title: "Produtos — Lojista" }] }),
  component: ShellPage,
});

type Product = {
  id: string;
  name: string;
  description: string | null;
  price_aoa: number;
  stock: number;
  status: string;
  image_url: string | null;
  rejection_reason: string | null;
};

function Produtos() {
  const { t } = useT();
  const { store } = useLojistaStore();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);

  const load = async () => {
    if (!store) return;
    const { data } = await supabase.from("products").select("*").eq("store_id", store.id).order("created_at", { ascending: false });
    setItems((data as Product[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [store?.id]);

  const del = async (id: string) => {
    if (!confirm("Excluir este produto?")) return;
    const { error } = await supabase.from("products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("s_produto_excluido"));
    load();
  };

  if (!store) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold">{items.length} produto(s)</h2>
        <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={() => setEditing(null)}><Plus size={16} /> {t("s_novo")}</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[420px]">
            <DialogHeader><DialogTitle>{editing ? t("s_editar_produto") : t("s_novo_produto")}</DialogTitle></DialogHeader>
            <ProductForm storeId={store.id} initial={editing} onDone={() => { setOpen(false); setEditing(null); load(); }} />
          </DialogContent>
        </Dialog>
      </div>
      {loading ? (
        <ul className="space-y-2" aria-busy="true" aria-label={t("s_carregando_produtos")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <Empty label={t("s_nenhum_produto_adicione_o_primeiro")} />
      ) : (
        <ul className="space-y-2">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-accent text-xl overflow-hidden">
                {p.image_url ? <img src={p.image_url} alt="" className="h-full w-full object-cover" /> : "📦"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-muted-foreground">Kz {Number(p.price_aoa).toLocaleString("pt-AO")} · Estoque {p.stock}</p>
                <StatusBadge status={p.status} />
                {p.status === "rejected" && p.rejection_reason && (
                  <p className="mt-1 text-[10px] text-destructive">Motivo: {p.rejection_reason}</p>
                )}
              </div>
              <button onClick={() => { setEditing(p); setOpen(true); }} className="text-muted-foreground p-1" aria-label={t("s_editar")}><Pencil size={16} /></button>
              <button onClick={() => del(p.id)} className="text-destructive p-1" aria-label={t("s_excluir")}><Trash2 size={16} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProductForm({ storeId, initial, onDone }: { storeId: string; initial: Product | null; onDone: () => void }) {
  const { t } = useT();
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    price_aoa: initial ? String(initial.price_aoa) : "",
    stock: initial ? String(initial.stock) : "1",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceAoa = Number(form.price_aoa);
    const stock = Number(form.stock);
    const parsed = productSchema.safeParse({ name: form.name, description: form.description, price_aoa: priceAoa, stock });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? t("s_dados_invalidos"));
    setBusy(true);
    try {
      let image_url = initial?.image_url ?? null;
      if (imageFile) {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) throw new Error("Não autenticado");
        const ext = imageFile.name.split(".").pop() || "png";
        const path = `${u.user.id}/${storeId}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("product-images").upload(path, imageFile, { upsert: true, contentType: imageFile.type });
        if (upErr) throw upErr;
        const { data: signed, error: sErr } = await supabase.storage.from("product-images").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
        if (sErr) throw sErr;
        image_url = signed.signedUrl;
      }
      const payload = {
        name: parsed.data.name,
        description: parsed.data.description || null,
        price_aoa: parsed.data.price_aoa,
        price_brl: Math.round((parsed.data.price_aoa / 175) * 100) / 100,
        stock: parsed.data.stock,
        image_url,
      };
      if (initial) {
        const { error } = await supabase.from("products").update({ ...payload, status: "pending", rejection_reason: null }).eq("id", initial.id);
        if (error) throw error;
        toast.success(t("s_produto_atualizado_reenviado_para_aprovacao"));
      } else {
        const { error } = await supabase.from("products").insert({ ...payload, store_id: storeId });
        if (error) throw error;
        toast.success(t("s_produto_enviado_para_aprovacao"));
      }
      onDone();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Erro");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label={t("s_nome_2")}><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
      <Field label={t("s_descricao")}><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("s_preco_kz")}><Input type="number" step="1" value={form.price_aoa} onChange={(e) => setForm({ ...form, price_aoa: e.target.value })} /></Field>
        <Field label={t("s_estoque")}><Input type="number" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
      </div>
      <Field label={t("s_imagem")}>
        <Input type="file" accept="image/*" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">{busy ? <Loader2 className="animate-spin" /> : initial ? t("s_salvar_alteracoes") : t("s_cadastrar")}</Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
    pending: { label: "Aguardando", cls: "bg-yellow-100 text-yellow-800", icon: Clock },
    approved: { label: "Aprovado", cls: "bg-green-100 text-green-800", icon: CheckCircle2 },
    rejected: { label: "Rejeitado", cls: "bg-red-100 text-red-800", icon: XCircle },
  };
  const s = map[status] || { label: status, cls: "bg-muted text-foreground", icon: Clock };
  const Icon = s.icon;
  return <span className={`mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}><Icon size={10} /> {s.label}</span>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-xl border border-dashed border-border py-10 text-center text-xs text-muted-foreground">{label}</div>;
}

function ShellPage() {
  const { t } = useT();
  return (
    <LojistaShell title={t("s_produtos")}>
      <Produtos />
    </LojistaShell>
  );
}