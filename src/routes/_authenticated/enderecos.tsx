import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Plus, MapPin, Trash2, Loader2, Star } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LocationCascade, type LocationValue } from "@/components/LocationCascade";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/enderecos")({
  head: () => ({ meta: [{ title: "Endereços para entrega — Live Teká" }] }),
  component: AddressesPage,
});

type Address = {
  id: string; label: string; street: string; district: string | null; reference: string | null;
  recipient_name: string | null; phone: string | null; is_default: boolean;
  province_id: string; municipality_id: string;
  provinces: { name: string } | null;
  municipalities: { name: string; shipping_fee_aoa: number } | null;
};

function AddressesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("addresses")
      .select("*, provinces(name), municipalities(name, shipping_fee_aoa)")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: false });
    setItems((data as Address[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user?.id]);

  const setDefault = async (id: string) => {
    if (!user) return;
    await supabase.from("addresses").update({ is_default: false }).eq("user_id", user.id);
    await supabase.from("addresses").update({ is_default: true }).eq("id", id);
    toast.success("Endereço padrão atualizado");
    load();
  };

  const del = async (id: string) => {
    if (!confirm("Excluir este endereço?")) return;
    const { error } = await supabase.from("addresses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Endereço excluído");
    load();
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Endereços para entrega</h1>
          <p className="text-xs text-white/80">Para entrega rápida em Angola</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><Plus size={18} /></button>
          </DialogTrigger>
          <DialogContent className="max-w-[420px]">
            <DialogHeader><DialogTitle>Novo endereço</DialogTitle></DialogHeader>
            <AddressForm onDone={() => { setOpen(false); load(); }} />
          </DialogContent>
        </Dialog>
      </header>

      <div className="px-5 py-4">
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-8 text-center">
            <MapPin className="mx-auto text-muted-foreground" size={28} />
            <p className="mt-3 text-sm font-semibold">Nenhum endereço cadastrado</p>
            <p className="mt-1 text-xs text-muted-foreground">Adicione um endereço para finalizar suas compras</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {items.map((a) => (
              <li key={a.id} className="rounded-2xl border border-border p-4">
                <div className="flex items-start gap-3">
                  <MapPin size={18} className="mt-1 text-primary" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{a.label}</p>
                      {a.is_default && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">Padrão</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">{a.street}{a.district ? `, ${a.district}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{a.municipalities?.name} · {a.provinces?.name}</p>
                    {a.recipient_name && <p className="mt-1 text-[11px] text-muted-foreground">{a.recipient_name} · {a.phone}</p>}
                    <p className="mt-1 text-[11px] font-semibold text-primary">
                      Frete: Kz {Number(a.municipalities?.shipping_fee_aoa ?? 0).toLocaleString("pt-AO")}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  {!a.is_default && (
                    <Button variant="outline" size="sm" onClick={() => setDefault(a.id)}>
                      <Star size={14} /> Tornar padrão
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => del(a.id)}>
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}

function AddressForm({ onDone }: { onDone: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [loc, setLoc] = useState<LocationValue>({ country_id: "", province_id: "", municipality_id: "", district_id: "" });
  const [shippingFee, setShippingFee] = useState<number | null>(null);
  const [form, setForm] = useState({
    label: "Casa", district: "", street: "", reference: "", recipient_name: "", phone: "",
  });

  useEffect(() => {
    if (!loc.municipality_id) { setShippingFee(null); return; }
    supabase.from("municipalities").select("shipping_fee_aoa,name").eq("id", loc.municipality_id).maybeSingle()
      .then(({ data }) => setShippingFee(data ? Number((data as { shipping_fee_aoa: number }).shipping_fee_aoa) : null));
  }, [loc.municipality_id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!loc.province_id || !loc.municipality_id || !form.street.trim()) {
      return toast.error("Província, município e rua são obrigatórios");
    }
    setBusy(true);
    const { count } = await supabase.from("addresses").select("*", { count: "exact", head: true }).eq("user_id", user.id);
    const isFirst = (count ?? 0) === 0;
    const { error } = await supabase.from("addresses").insert({
      user_id: user.id,
      label: form.label || "Casa",
      country_id: loc.country_id || null,
      province_id: loc.province_id,
      municipality_id: loc.municipality_id,
      district_id: loc.district_id || null,
      district: form.district || null,
      street: form.street,
      reference: form.reference || null,
      recipient_name: form.recipient_name || null,
      phone: form.phone || null,
      is_default: isFirst,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Endereço salvo");
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Identificação</Label>
        <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Casa / Trabalho" />
      </div>
      <LocationCascade value={loc} onChange={setLoc} required />
      {shippingFee != null && (
        <div className="rounded-lg bg-accent/50 px-3 py-2 text-[11px] text-accent-foreground">
          Frete estimado: <strong>Kz {shippingFee.toLocaleString("pt-AO")}</strong>
        </div>
      )}
      <div className="space-y-1.5">
        <Label className="text-xs">Rua / Avenida *</Label>
        <Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} placeholder="Rua, número, casa…" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Ponto de referência</Label>
        <Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Perto de…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Destinatário</Label>
          <Input value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Telefone</Label>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 …" />
        </div>
      </div>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : "Salvar endereço"}
      </Button>
    </form>
  );
}