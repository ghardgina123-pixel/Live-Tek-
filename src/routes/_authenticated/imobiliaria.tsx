import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Home as HomeIcon, MapPin, Loader2, Plus, BadgeCheck, Clock, XCircle, Radio, Upload, Calendar } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LocationCascade, type LocationValue } from "@/components/LocationCascade";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/imobiliaria")({
  head: () => ({ meta: [{ title: "Imobiliária — Live Teká" }] }),
  component: ImobiliariaPage,
});

type Agency = {
  id: string; status: "pending" | "active" | "rejected" | "suspended";
  name: string; nif: string; phone: string; email: string | null;
  description: string | null; logo_url: string | null;
  province_id: string | null; municipality_id: string | null;
  district: string | null; street: string | null;
  lat: number | null; lng: number | null;
  rejection_reason: string | null;
};
type Property = {
  id: string; title: string; listing_type: "venda" | "arrendamento";
  property_type: string; price_aoa: number; status: string; cover_url: string | null;
};
type Visit = {
  id: string; preferred_date: string; preferred_time: string | null;
  contact_phone: string; message: string | null; status: string;
  properties: { title: string } | null;
};
type LiveFee = {
  id: string; amount_aoa: number; status: string; payment_method: string | null;
  proof_url: string | null; rejection_reason: string | null; created_at: string;
};

const LIVE_FEE_AOA = 5000;

const agencySchema = z.object({
  name: z.string().trim().min(2).max(120),
  nif: z.string().trim().min(5, "NIF obrigatório").max(40),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  description: z.string().trim().max(800).optional().or(z.literal("")),
});

function ImobiliariaPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [agency, setAgency] = useState<Agency | null>(null);

  const refresh = async () => {
    if (!user) return;
    const { data } = await (supabase as any).from("real_estate_agencies").select("*").eq("owner_id", user.id).maybeSingle();
    setAgency((data as Agency) ?? null);
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user?.id]);

  if (loading) {
    return <AppShell><div className="flex h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-primary" /></div></AppShell>;
  }

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Imobiliária</h1>
          <p className="text-xs text-white/80">{agency ? agency.name : "Cadastre sua imobiliária"}</p>
        </div>
        <HomeIcon size={20} />
      </header>

      {!agency && <AgencyRegistration onCreated={refresh} />}
      {agency && agency.status !== "active" && <AgencyStatusBanner agency={agency} />}
      {agency && agency.status === "active" && <AgencyDashboard agency={agency} />}
    </AppShell>
  );
}

function AgencyStatusBanner({ agency }: { agency: Agency }) {
  const isReject = agency.status === "rejected";
  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent">
        {isReject ? <XCircle className="text-destructive" size={32} /> : <Clock className="text-primary" size={32} />}
      </div>
      <h2 className="text-lg font-bold">{isReject ? "Cadastro rejeitado" : "Aguardando aprovação"}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {isReject
          ? agency.rejection_reason || "Entre em contato com o suporte."
          : "A sua imobiliária está em análise. Receberá uma notificação quando aprovada."}
      </p>
    </div>
  );
}

function AgencyRegistration({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const [loc, setLoc] = useState<LocationValue>({ country_id: "", province_id: "", municipality_id: "", district_id: "" });
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [form, setForm] = useState({
    name: "", nif: "", phone: "", email: "", description: "",
    district: "", street: "",
  });

  const captureLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Geolocalização não suportada");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }); toast.success("Localização capturada"); },
      () => toast.error("Não foi possível obter a localização"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = agencySchema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    setBusy(true);
    const { error } = await (supabase as any).from("real_estate_agencies").insert({
      owner_id: user.id,
      name: form.name, nif: form.nif, phone: form.phone,
      email: form.email || null, description: form.description || null,
      country_id: loc.country_id || null,
      province_id: loc.province_id || null,
      municipality_id: loc.municipality_id || null,
      district_id: loc.district_id || null,
      district: form.district || null, street: form.street || null,
      lat: coords.lat, lng: coords.lng,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Cadastro enviado para análise");
    onCreated();
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
        Apenas empresas registadas (com NIF) podem publicar imóveis. O cadastro é analisado pela equipa.
      </div>
      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">Dados da empresa</h2>
        <Field label="Nome da imobiliária *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NIF *"><Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} /></Field>
          <Field label="Telefone *"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 …" /></Field>
        </div>
        <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Descrição"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Conte sobre a sua imobiliária" /></Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">Localização</h2>
        <LocationCascade value={loc} onChange={setLoc} />
        <Field label="Referência de bairro"><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Detalhes complementares" /></Field>
        <Field label="Rua"><Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></Field>

        <div className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Localização no mapa</p>
            <Button type="button" variant="outline" size="sm" onClick={captureLocation}>
              <MapPin size={14} /> Capturar
            </Button>
          </div>
          {coords.lat != null && coords.lng != null && (
            <iframe title="Mapa" className="mt-3 h-44 w-full rounded-lg border border-border"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng - 0.01},${coords.lat - 0.01},${coords.lng + 0.01},${coords.lat + 0.01}&layer=mapnik&marker=${coords.lat},${coords.lng}`} />
          )}
        </div>
      </section>

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : "Enviar cadastro"}
      </Button>
    </form>
  );
}

function AgencyDashboard({ agency }: { agency: Agency }) {
  const [tab, setTab] = useState<"imoveis" | "visitas" | "lives">("imoveis");
  return (
    <div className="px-5 py-4 space-y-4">
      <div className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-xs text-green-700">
        <BadgeCheck size={16} /> Imobiliária aprovada
      </div>
      <div className="flex gap-2 border-b border-border">
        {(["imoveis", "visitas", "lives"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-2 text-sm font-semibold capitalize ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
            {t === "imoveis" ? "Imóveis" : t === "visitas" ? "Visitas" : "Lives"}
          </button>
        ))}
      </div>
      {tab === "imoveis" && <PropertiesTab agencyId={agency.id} />}
      {tab === "visitas" && <VisitsTab agencyId={agency.id} />}
      {tab === "lives" && <LivesFeeTab agencyId={agency.id} />}
    </div>
  );
}

function PropertiesTab({ agencyId }: { agencyId: string }) {
  const [items, setItems] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("properties").select("*").eq("agency_id", agencyId).order("created_at", { ascending: false });
    setItems((data as Property[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [agencyId]);

  return (
    <div className="space-y-3">
      <Button onClick={() => setShowForm((v) => !v)} className="w-full"><Plus size={16} /> {showForm ? "Fechar" : "Novo imóvel"}</Button>
      {showForm && <NewPropertyForm agencyId={agencyId} onCreated={() => { setShowForm(false); load(); }} />}
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhum imóvel ainda.</p>
      ) : (
        <div className="space-y-2">
          {items.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <div className="h-12 w-16 shrink-0 overflow-hidden rounded-md bg-accent">
                {p.cover_url ? <img src={p.cover_url} alt={p.title} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-2xl">🏠</div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-semibold">{p.title}</p>
                <p className="text-xs text-muted-foreground">{p.listing_type} · {Number(p.price_aoa).toLocaleString("pt-AO")} Kz</p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                p.status === "approved" ? "bg-green-500/15 text-green-700"
                : p.status === "rejected" ? "bg-destructive/15 text-destructive"
                : "bg-yellow-500/15 text-yellow-700"
              }`}>{p.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const propertySchema = z.object({
  title: z.string().trim().min(3).max(160),
  property_type: z.enum(["casa", "apartamento", "terreno", "comercial", "escritorio"]),
  listing_type: z.enum(["venda", "arrendamento"]),
  price_aoa: z.number().positive(),
});

function NewPropertyForm({ agencyId, onCreated }: { agencyId: string; onCreated: () => void }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    title: "", description: "",
    property_type: "casa" as "casa" | "apartamento" | "terreno" | "comercial" | "escritorio",
    listing_type: "venda" as "venda" | "arrendamento",
    price_aoa: "", rent_period: "mensal",
    bedrooms: "", bathrooms: "", area_m2: "", parking_spots: "",
    furnished: false, district: "", street: "",
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const priceNum = Number(form.price_aoa);
    const parsed = propertySchema.safeParse({
      title: form.title, property_type: form.property_type,
      listing_type: form.listing_type, price_aoa: priceNum,
    });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    setBusy(true);
    let coverUrl: string | null = null;
    if (coverFile) {
      const ext = coverFile.name.split(".").pop() || "jpg";
      const path = `${user.id}/${agencyId}/${Date.now()}.${ext}`;
      const up = await supabase.storage.from("property-images").upload(path, coverFile, { upsert: true, contentType: coverFile.type });
      if (up.error) { setBusy(false); return toast.error(up.error.message); }
      const signed = await supabase.storage.from("property-images").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
      if (signed.error) { setBusy(false); return toast.error(signed.error.message); }
      coverUrl = signed.data.signedUrl;
    }
    const { error } = await (supabase as any).from("properties").insert({
      agency_id: agencyId,
      title: form.title, description: form.description || null,
      property_type: form.property_type, listing_type: form.listing_type,
      price_aoa: priceNum,
      rent_period: form.listing_type === "arrendamento" ? form.rent_period : null,
      bedrooms: form.bedrooms ? Number(form.bedrooms) : null,
      bathrooms: form.bathrooms ? Number(form.bathrooms) : null,
      area_m2: form.area_m2 ? Number(form.area_m2) : null,
      parking_spots: form.parking_spots ? Number(form.parking_spots) : null,
      furnished: form.furnished,
      district: form.district || null, street: form.street || null,
      cover_url: coverUrl,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Imóvel enviado para aprovação");
    onCreated();
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border p-4">
      <Field label="Título *"><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value as typeof form.property_type })}>
            <option value="casa">Casa</option>
            <option value="apartamento">Apartamento</option>
            <option value="terreno">Terreno</option>
            <option value="comercial">Comercial</option>
            <option value="escritorio">Escritório</option>
          </select>
        </Field>
        <Field label="Negócio">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            value={form.listing_type} onChange={(e) => setForm({ ...form, listing_type: e.target.value as typeof form.listing_type })}>
            <option value="venda">Venda</option>
            <option value="arrendamento">Arrendamento</option>
          </select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Preço (Kz) *"><Input type="number" value={form.price_aoa} onChange={(e) => setForm({ ...form, price_aoa: e.target.value })} /></Field>
        {form.listing_type === "arrendamento" && (
          <Field label="Período">
            <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.rent_period} onChange={(e) => setForm({ ...form, rent_period: e.target.value })}>
              <option value="mensal">Mensal</option>
              <option value="diario">Diário</option>
            </select>
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Quartos"><Input type="number" value={form.bedrooms} onChange={(e) => setForm({ ...form, bedrooms: e.target.value })} /></Field>
        <Field label="WC"><Input type="number" value={form.bathrooms} onChange={(e) => setForm({ ...form, bathrooms: e.target.value })} /></Field>
        <Field label="Área (m²)"><Input type="number" value={form.area_m2} onChange={(e) => setForm({ ...form, area_m2: e.target.value })} /></Field>
        <Field label="Garagem"><Input type="number" value={form.parking_spots} onChange={(e) => setForm({ ...form, parking_spots: e.target.value })} /></Field>
      </div>
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={form.furnished} onChange={(e) => setForm({ ...form, furnished: e.target.checked })} />
        Mobilado
      </label>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bairro"><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></Field>
        <Field label="Rua"><Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></Field>
      </div>
      <Field label="Descrição"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
      <Field label="Foto de capa">
        <Input type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
      </Field>
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? <Loader2 className="animate-spin" /> : "Publicar imóvel"}
      </Button>
    </form>
  );
}

function VisitsTab({ agencyId }: { agencyId: string }) {
  const [items, setItems] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("property_visit_requests")
      .select("*, properties!inner(title, agency_id)")
      .eq("properties.agency_id", agencyId)
      .order("created_at", { ascending: false });
    setItems((data as Visit[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [agencyId]);

  const updateStatus = async (id: string, status: string) => {
    const { error } = await (supabase as any).from("property_visit_requests").update({ status }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Atualizado");
    load();
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>;
  if (items.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">Nenhum pedido de visita.</p>;

  return (
    <div className="space-y-2">
      {items.map((v) => (
        <div key={v.id} className="rounded-xl border border-border p-3 text-sm">
          <p className="font-semibold">{v.properties?.title ?? "Imóvel"}</p>
          <p className="text-xs text-muted-foreground"><Calendar size={11} className="inline" /> {v.preferred_date} {v.preferred_time ?? ""}</p>
          <p className="text-xs">📞 {v.contact_phone}</p>
          {v.message && <p className="mt-1 text-xs italic">"{v.message}"</p>}
          <div className="mt-2 flex gap-2">
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-bold uppercase">{v.status}</span>
            {v.status === "pending" && (
              <>
                <Button size="sm" variant="outline" onClick={() => updateStatus(v.id, "confirmed")}>Confirmar</Button>
                <Button size="sm" variant="outline" onClick={() => updateStatus(v.id, "rejected")}>Recusar</Button>
              </>
            )}
            {v.status === "confirmed" && <Button size="sm" variant="outline" onClick={() => updateStatus(v.id, "done")}>Marcar como feita</Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

function LivesFeeTab({ agencyId }: { agencyId: string }) {
  const [items, setItems] = useState<LiveFee[]>([]);
  const [loading, setLoading] = useState(true);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [method, setMethod] = useState("multicaixa");
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    const { data } = await (supabase as any).from("agency_live_fees").select("*").eq("agency_id", agencyId).order("created_at", { ascending: false });
    setItems((data as LiveFee[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [agencyId]);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!proofFile) return toast.error("Anexe o comprovativo");
    setBusy(true);
    const ext = proofFile.name.split(".").pop() || "png";
    const path = `${user.id}/${agencyId}/live-${Date.now()}.${ext}`;
    const up = await supabase.storage.from("subscription-proofs").upload(path, proofFile, { upsert: true, contentType: proofFile.type });
    if (up.error) { setBusy(false); return toast.error(up.error.message); }
    const signed = await supabase.storage.from("subscription-proofs").createSignedUrl(path, 60 * 60 * 24 * 365);
    const { error } = await (supabase as any).from("agency_live_fees").insert({
      agency_id: agencyId, amount_aoa: LIVE_FEE_AOA,
      status: "paid", payment_method: method,
      proof_url: signed.data?.signedUrl ?? path,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Comprovativo enviado");
    setProofFile(null);
    load();
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs">
        <p className="font-bold">Taxa por live de imóvel: {LIVE_FEE_AOA.toLocaleString("pt-AO")} Kz</p>
        <p className="mt-1 text-muted-foreground">Cada live transmitida tem uma taxa única. Envie o comprovativo de pagamento e aguarde aprovação. Após aprovado, a live pode ser iniciada.</p>
      </div>
      <form onSubmit={pay} className="space-y-3 rounded-xl border border-border p-4">
        <h3 className="text-sm font-bold flex items-center gap-2"><Radio size={14} /> Pagar nova live</h3>
        <Field label="Método">
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="multicaixa">Multicaixa Express</option>
            <option value="transferencia">Transferência bancária</option>
            <option value="unitel_money">Unitel Money</option>
          </select>
        </Field>
        <Field label="Comprovativo *">
          <Input type="file" accept="image/*,application/pdf" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? <Loader2 className="animate-spin" /> : <><Upload size={14} /> Enviar comprovativo</>}
        </Button>
      </form>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="animate-spin text-primary" /></div>
      ) : items.length === 0 ? (
        <p className="py-4 text-center text-xs text-muted-foreground">Nenhum pagamento ainda.</p>
      ) : (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase text-muted-foreground">Histórico</h4>
          {items.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-xs">
              <div>
                <p className="font-semibold">{Number(f.amount_aoa).toLocaleString("pt-AO")} Kz · {f.payment_method ?? "—"}</p>
                <p className="text-muted-foreground">{new Date(f.created_at).toLocaleDateString("pt-AO")}</p>
                {f.rejection_reason && <p className="text-destructive">{f.rejection_reason}</p>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                f.status === "approved" ? "bg-green-500/15 text-green-700"
                : f.status === "rejected" ? "bg-destructive/15 text-destructive"
                : "bg-yellow-500/15 text-yellow-700"
              }`}>{f.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}