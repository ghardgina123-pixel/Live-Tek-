import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, MapPin, Truck, BadgeCheck, Clock, XCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LocationCascade, type LocationValue } from "@/components/LocationCascade";
import { toast } from "sonner";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/transportador")({
  head: () => ({ meta: [{ title: "Cadastro de transportador — Live Teká" }] }),
  component: TransportadorPage,
});

type CourierType = "motoboy" | "carro" | "van" | "empresa";
type Status = "pending" | "active" | "rejected" | "suspended";
type Courier = {
  id: string; status: Status; courier_type: CourierType; full_name: string;
  company_name: string | null; document_id: string; driver_license: string | null;
  phone: string; email: string | null;
  vehicle_plate: string | null; vehicle_brand: string | null; vehicle_model: string | null; vehicle_color: string | null;
  country_id: string | null; province_id: string | null; municipality_id: string | null; district_id: string | null; district: string | null; street: string | null;
  lat: number | null; lng: number | null;
  emergency_contact_name: string | null; emergency_contact_phone: string | null;
  notes: string | null; rejection_reason: string | null;
};

const schema = z.object({
  courier_type: z.enum(["motoboy", "carro", "van", "empresa"]),
  full_name: z.string().trim().min(2).max(120),
  company_name: z.string().trim().max(120).optional().or(z.literal("")),
  document_id: z.string().trim().min(3).max(40),
  driver_license: z.string().trim().max(40).optional().or(z.literal("")),
  phone: z.string().trim().min(7).max(20),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  vehicle_plate: z.string().trim().max(20).optional().or(z.literal("")),
  vehicle_brand: z.string().trim().max(40).optional().or(z.literal("")),
  vehicle_model: z.string().trim().max(40).optional().or(z.literal("")),
  vehicle_color: z.string().trim().max(30).optional().or(z.literal("")),
  district: z.string().trim().max(80).optional().or(z.literal("")),
  street: z.string().trim().max(200).optional().or(z.literal("")),
  emergency_contact_name: z.string().trim().max(120).optional().or(z.literal("")),
  emergency_contact_phone: z.string().trim().max(20).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

function TransportadorPage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<Courier | null>(null);
  const [loc, setLoc] = useState<LocationValue>({ country_id: "", province_id: "", municipality_id: "", district_id: "" });
  const [busy, setBusy] = useState(false);
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [form, setForm] = useState({
    courier_type: "motoboy" as CourierType,
    full_name: "", company_name: "", document_id: "", driver_license: "",
    phone: "", email: "",
    vehicle_plate: "", vehicle_brand: "", vehicle_model: "", vehicle_color: "",
    district: "", street: "",
    emergency_contact_name: "", emergency_contact_phone: "", notes: "",
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await (supabase as any).from("couriers").select("*").eq("user_id", user.id).maybeSingle();
      const c = data as Courier | null;
      if (c) {
        setExisting(c);
        setForm({
          courier_type: c.courier_type,
          full_name: c.full_name ?? "", company_name: c.company_name ?? "",
          document_id: c.document_id ?? "", driver_license: c.driver_license ?? "",
          phone: c.phone ?? "", email: c.email ?? "",
          vehicle_plate: c.vehicle_plate ?? "", vehicle_brand: c.vehicle_brand ?? "",
          vehicle_model: c.vehicle_model ?? "", vehicle_color: c.vehicle_color ?? "",
          district: c.district ?? "", street: c.street ?? "",
          emergency_contact_name: c.emergency_contact_name ?? "",
          emergency_contact_phone: c.emergency_contact_phone ?? "",
          notes: c.notes ?? "",
        });
        setLoc({
          country_id: c.country_id ?? "",
          province_id: c.province_id ?? "",
          municipality_id: c.municipality_id ?? "",
          district_id: c.district_id ?? "",
        });
        setCoords({ lat: c.lat, lng: c.lng });
      }
      setLoading(false);
    })();
  }, [user?.id]);

  const captureLocation = () => {
    if (!("geolocation" in navigator)) return toast.error("Geolocalização não suportada");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        toast.success("Localização capturada");
      },
      () => toast.error("Não foi possível obter a localização"),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "Dados inválidos");
    if (form.courier_type !== "motoboy" && !form.vehicle_plate.trim()) {
      return toast.error("Matrícula do veículo é obrigatória");
    }
    setBusy(true);
    const payload: Record<string, unknown> = {
      user_id: user.id,
      courier_type: form.courier_type,
      full_name: form.full_name,
      company_name: form.company_name || null,
      document_id: form.document_id,
      driver_license: form.driver_license || null,
      phone: form.phone,
      email: form.email || null,
      vehicle_plate: form.vehicle_plate || null,
      vehicle_brand: form.vehicle_brand || null,
      vehicle_model: form.vehicle_model || null,
      vehicle_color: form.vehicle_color || null,
      country_id: loc.country_id || null,
      province_id: loc.province_id || null,
      municipality_id: loc.municipality_id || null,
      district_id: loc.district_id || null,
      district: form.district || null,
      street: form.street || null,
      lat: coords.lat,
      lng: coords.lng,
      emergency_contact_name: form.emergency_contact_name || null,
      emergency_contact_phone: form.emergency_contact_phone || null,
      notes: form.notes || null,
    };
    const q = (supabase as any).from("couriers");
    const { error } = existing
      ? await q.update(payload).eq("id", existing.id)
      : await q.insert(payload);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(existing ? "Cadastro atualizado" : "Cadastro enviado para análise");
    if (!existing) location.reload();
  };

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Quero entregar</h1>
          <p className="text-xs text-white/80">Motoboys, transportes e empresas</p>
        </div>
        <Truck size={20} />
      </header>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-primary" /></div>
      ) : (
        <div className="px-5 py-5">
          {existing && (
            <div className={`mb-4 flex items-center gap-2 rounded-xl border p-3 text-xs ${
              existing.status === "active" ? "border-green-500/30 bg-green-500/10 text-green-700"
              : existing.status === "rejected" ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-yellow-500/30 bg-yellow-500/10 text-yellow-700"
            }`}>
              {existing.status === "active" ? <BadgeCheck size={16} /> : existing.status === "rejected" ? <XCircle size={16} /> : <Clock size={16} />}
              <span className="font-semibold">
                {existing.status === "active" && "Cadastro aprovado"}
                {existing.status === "pending" && "Aguardando análise da equipe"}
                {existing.status === "rejected" && `Recusado: ${existing.rejection_reason ?? "sem motivo"}`}
                {existing.status === "suspended" && "Cadastro suspenso"}
              </span>
            </div>
          )}

          <form onSubmit={submit} className="space-y-4">
            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Tipo de transporte</h2>
              <div className="grid grid-cols-4 gap-2">
                {(["motoboy", "carro", "van", "empresa"] as const).map((t) => (
                  <button
                    key={t} type="button"
                    onClick={() => setForm({ ...form, courier_type: t })}
                    className={`rounded-xl border px-2 py-3 text-[11px] font-semibold capitalize ${
                      form.courier_type === t ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                    }`}
                  >{t}</button>
                ))}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Identificação</h2>
              <Field label="Nome completo *"><Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></Field>
              {form.courier_type === "empresa" && (
                <Field label="Nome da empresa"><Input value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} /></Field>
              )}
              <div className="grid grid-cols-2 gap-3">
                <Field label="BI / NIF *"><Input value={form.document_id} onChange={(e) => setForm({ ...form, document_id: e.target.value })} /></Field>
                <Field label="Carta de condução"><Input value={form.driver_license} onChange={(e) => setForm({ ...form, driver_license: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Telefone *"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 …" /></Field>
                <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Veículo</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label={`Matrícula${form.courier_type !== "motoboy" ? " *" : ""}`}><Input value={form.vehicle_plate} onChange={(e) => setForm({ ...form, vehicle_plate: e.target.value })} /></Field>
                <Field label="Cor"><Input value={form.vehicle_color} onChange={(e) => setForm({ ...form, vehicle_color: e.target.value })} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Marca"><Input value={form.vehicle_brand} onChange={(e) => setForm({ ...form, vehicle_brand: e.target.value })} /></Field>
                <Field label="Modelo"><Input value={form.vehicle_model} onChange={(e) => setForm({ ...form, vehicle_model: e.target.value })} /></Field>
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Localização base</h2>
              <LocationCascade value={loc} onChange={setLoc} />
              <Field label="Referência de bairro"><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Detalhes complementares" /></Field>
              <Field label="Rua / Endereço"><Input value={form.street} onChange={(e) => setForm({ ...form, street: e.target.value })} /></Field>

              <div className="rounded-xl border border-border p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold">Localização no mapa</p>
                    <p className="text-[11px] text-muted-foreground">
                      {coords.lat != null && coords.lng != null
                        ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
                        : "Nenhum ponto capturado"}
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={captureLocation}>
                    <MapPin size={14} /> Usar minha localização
                  </Button>
                </div>
                {coords.lat != null && coords.lng != null && (
                  <iframe
                    title="Mapa"
                    className="mt-3 h-44 w-full rounded-lg border border-border"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${coords.lng - 0.01},${coords.lat - 0.01},${coords.lng + 0.01},${coords.lat + 0.01}&layer=mapnik&marker=${coords.lat},${coords.lng}`}
                  />
                )}
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="text-xs font-bold uppercase text-muted-foreground">Contacto de emergência</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome"><Input value={form.emergency_contact_name} onChange={(e) => setForm({ ...form, emergency_contact_name: e.target.value })} /></Field>
                <Field label="Telefone"><Input value={form.emergency_contact_phone} onChange={(e) => setForm({ ...form, emergency_contact_phone: e.target.value })} /></Field>
              </div>
              <Field label="Observações">
                <textarea
                  className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Áreas que cobre, horários, etc."
                />
              </Field>
            </section>

            <Button type="submit" disabled={busy} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : existing ? "Atualizar cadastro" : "Enviar cadastro"}
            </Button>
            <p className="text-center text-[10px] text-muted-foreground">
              Seus dados são usados apenas para validação e contacto. Aprovação em até 48h.
            </p>
          </form>
        </div>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}