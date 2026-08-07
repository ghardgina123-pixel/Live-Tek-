import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Clock, Loader2, MapPin, Upload, XCircle, ImagePlus, Sparkles, AlertCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { LocationCascade, type LocationValue } from "@/components/LocationCascade";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";
import { SERVICE_CATEGORIES } from "@/lib/services";

export const Route = createFileRoute("/_authenticated/lojista/")({
  head: () => ({ meta: [{ title: "Minha Loja — Live Teká" }] }),
  component: LojistaIndex,
});

type Store = {
  id: string;
  name: string;
  status: "pending" | "active" | "rejected";
  rejection_reason: string | null;
};

function LojistaIndex() {
  const { t } = useT();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<Store | null>(null);
  const [status, setStatus] = useState<{ approved_count: number; slots_left: number; fee_required: boolean; fee_aoa: number } | null>(null);
  const navigate = useNavigate();

  const refresh = async () => {
    if (!user) return;
    const [{ data }, { data: st }] = await Promise.all([
      supabase
      .from("stores")
      .select("id, name, status, rejection_reason")
      .eq("owner_id", user.id)
      .maybeSingle(),
      supabase.rpc("seller_signup_status"),
    ]);
    setStore((data as Store) ?? null);
    if (st) setStatus(st as { approved_count: number; slots_left: number; fee_required: boolean; fee_aoa: number });
    setLoading(false);
  };

  useEffect(() => { refresh(); }, [user?.id]);

  useEffect(() => {
    if (!loading && store?.status === "active") {
      navigate({ to: "/lojista/dashboard" });
    }
  }, [loading, store?.status, navigate]);

  if (loading) {
    return (
      <AppShell>
        <div className="flex h-[60vh] items-center justify-center">
          <Loader2 className="animate-spin text-primary" />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-lg font-semibold">{t("s_painel_do_lojista")}</h1>
          <p className="text-xs text-white/80">{store ? store.name : "Cadastre sua loja"}</p>
        </div>
      </header>
      {!store && (
        <section className="px-5 pt-5">
          {status && (
            <div className={`mb-3 rounded-2xl p-4 text-sm shadow-sm ${status.fee_required ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"}`}>
              <div className="flex items-start gap-2">
                {status.fee_required ? <AlertCircle size={18} className="mt-0.5 shrink-0" /> : <Sparkles size={18} className="mt-0.5 shrink-0" />}
                <div>
                  <p className="font-bold">
                    {status.fee_required
                      ? "As 50 vagas gratuitas foram preenchidas."
                      : `Aproveite! Restam ${status.slots_left} de 50 vagas gratuitas.`}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed">
                    {status.fee_required
                      ? `É obrigatório pagar a Taxa de Inscrição de ${status.fee_aoa.toLocaleString("pt-AO")} AOA (via Referência Multicaixa ou IBAN) antes de enviar a sua loja para aprovação.`
                      : "As primeiras 50 lojas a serem aprovadas terão acesso totalmente gratuito e isenção da taxa de adesão. Garanta a sua vaga agora!"}
                  </p>
                </div>
              </div>
            </div>
          )}
          <div className="rounded-2xl bg-card p-5 shadow-[var(--shadow-soft)]">
            <h2 className="text-lg font-bold leading-tight text-foreground">{t("s_abra_a_sua_loja_e_venda_ao_vivo")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Torne-se um vendedor e comece a transmitir os seus produtos para milhares de compradores em toda Angola. Configure a sua loja em minutos.
            </p>
            <p className="mt-3 text-[11px] font-medium text-primary">
              {status?.fee_required
                ? t("s_aprovacao_manual_feita_pela_administracao_apos_c") : t("s_aprovacao_manual_feita_pela_administracao_gratui")}
            </p>
          </div>
        </section>
      )}
      {!store && <StoreRegistration onCreated={refresh} feeRequired={!!status?.fee_required} feeAoa={status?.fee_aoa ?? 9600} />}
      {store?.status === "pending" && <PendingState reason={null} />}
      {store?.status === "rejected" && <PendingState reason={store.rejection_reason} rejected />}
      <PartnersFooter />
    </AppShell>
  );
}

function PartnersFooter() {
  const { t } = useT();
  return (
    <footer className="mx-5 mb-8 mt-4 rounded-2xl bg-secondary p-5 text-center text-xs text-secondary-foreground">
      <p className="font-bold tracking-wide">{t("s_live_teka_parceiros_lojistas")}</p>
      <p className="mt-1 text-[11px] opacity-80">{t("s_vendas_em_direto_para_milhares_de_compradores_em")}</p>
      <div className="mt-3 space-y-1 text-[11px]">
        <p>🌐 <a href="https://www.livemarketplece.live" className="font-semibold underline">www.livemarketplece.live</a></p>
        <p>☎️ Apoio ao lojista: <a href="tel:+244927046161" className="font-semibold underline">+244 927 046 161</a></p>
      </div>
    </footer>
  );
}

function PendingState({ reason, rejected }: { reason: string | null; rejected?: boolean }) {
  const { t } = useT();
  return (
    <div className="px-5 py-10 text-center">
      <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-accent">
        {rejected ? <XCircle className="text-destructive" size={32} /> : <Clock className="text-primary" size={32} />}
      </div>
      <h2 className="text-lg font-bold">{rejected ? t("s_loja_rejeitada") : t("s_aguardando_aprovacao")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {rejected
          ? reason || t("s_sua_loja_foi_rejeitada_entre_em_contato_com_o_su")
          : "Sua loja foi enviada para análise. Você receberá uma notificação assim que for aprovada."}
      </p>
    </div>
  );
}

async function uploadStoreAsset(userId: string, file: File, kind: "logo" | "cover") {
  const ext = file.name.split(".").pop() || "png";
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("store-assets").upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;
  const { data, error } = await supabase.storage.from("store-assets").createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
  if (error) throw error;
  return data.signedUrl;
}

function StoreRegistration({ onCreated, feeRequired, feeAoa }: { onCreated: () => void; feeRequired: boolean; feeAoa: number }) {
  const { t } = useT();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [loc, setLoc] = useState<LocationValue>({ country_id: "", province_id: "", municipality_id: "", district_id: "" });
  const [partnerType, setPartnerType] = useState<"retail" | "service">("retail");
  const [form, setForm] = useState({
    name: "",
    description: "",
    category: "Moda",
    service_category: "salao",
    opening_hours: "",
    whatsapp: "",
    service_tags: "",
    nif: "",
    phone: "",
    bank_name: "",
    bank_account: "",
    bank_holder: "",
  });

  const captureLocation = () => {
    if (!navigator.geolocation) return toast.error(t("s_geolocalizacao_nao_suportada"));
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }); setGeoBusy(false); toast.success(t("s_localizacao_capturada")); },
      (e) => { setGeoBusy(false); toast.error(t("s_nao_foi_possivel_obter_localizacao") + e.message); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    if (!form.name.trim()) return toast.error(t("s_nome_da_loja_e_obrigatorio"));
    if (partnerType === "service" && !form.service_category) return toast.error("Selecione a categoria de serviço");
    if (!form.nif.trim()) return toast.error(t("s_nif_e_obrigatorio"));
    if (!form.bank_name.trim() || !form.bank_account.trim() || !form.bank_holder.trim())
      return toast.error(t("s_dados_bancarios_completos_sao_obrigatorios"));
    if (!loc.province_id || !loc.municipality_id) return toast.error(t("s_selecione_provincia_e_municipio"));
    if (feeRequired && !proofFile) return toast.error(t("s_anexe_o_comprovativo_da_taxa_de_inscricao"));
    setSubmitting(true);
    try {
      let logo_url: string | null = null;
      let cover_url: string | null = null;
      if (logoFile) logo_url = await uploadStoreAsset(user.id, logoFile, "logo");
      if (coverFile) cover_url = await uploadStoreAsset(user.id, coverFile, "cover");

      const slug = form.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const { data: created, error } = await supabase.from("stores").insert({
        owner_id: user.id,
        name: form.name.trim(),
        slug,
        description: form.description || null,
        category: partnerType === "service" ? null : form.category || null,
        partner_type: partnerType,
        service_category: partnerType === "service" ? form.service_category : null,
        opening_hours: partnerType === "service" ? form.opening_hours || null : null,
        whatsapp: partnerType === "service" ? form.whatsapp || null : null,
        service_tags:
          partnerType === "service"
            ? form.service_tags.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
        phone: form.phone || null,
        logo_url,
        cover_url,
        country_id: loc.country_id || null,
        province_id: loc.province_id,
        municipality_id: loc.municipality_id,
        district_id: loc.district_id || null,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      }).select("id").single();
      if (error) throw error;
      if (created?.id) {
        const { error: privErr } = await supabase.from("store_private").insert({
          store_id: created.id,
          nif: form.nif || null,
          bank_name: form.bank_name || null,
          bank_account: form.bank_account || null,
          bank_holder: form.bank_holder || null,
        });
        if (privErr) throw privErr;
        if (feeRequired) {
          let proof_url: string | null = null;
          if (proofFile) {
            const ext = proofFile.name.split(".").pop() || "png";
            const path = `${user.id}/signup-fee-${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("subscription-proofs")
              .upload(path, proofFile, { upsert: true, contentType: proofFile.type });
            if (upErr) throw upErr;
            const { data: signed } = await supabase.storage
              .from("subscription-proofs")
              .createSignedUrl(path, 60 * 60 * 24 * 365 * 5);
            proof_url = signed?.signedUrl ?? null;
          }
          const { error: subErr } = await supabase.from("store_subscriptions").insert({
            store_id: created.id,
            plan: "signup_fee",
            status: "pending",
            price_aoa: feeAoa,
            payment_method: "manual",
            proof_url,
          });
          if (subErr) throw subErr;
        }
      }

      await supabase.from("user_roles").insert({ user_id: user.id, role: "seller" });
      toast.success(feeRequired ? t("s_loja_e_comprovativo_enviados_para_aprovacao") : t("s_loja_enviada_para_aprovacao"));
      onCreated();
      if (partnerType === "service") {
        toast.info("Escolha o plano de serviços para concluir o registo.");
        navigate({ to: "/lojista/subscricao" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erro ao enviar";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4 px-5 py-5">
      <div className="rounded-2xl bg-accent/50 p-4 text-xs text-muted-foreground">
        Preencha os dados completos. Após análise, o seu negócio ficará ativo e você terá acesso ao painel completo.
      </div>

      <h3 className="pt-2 text-xs font-bold uppercase text-muted-foreground">Tipo de negócio</h3>
      <div className="grid grid-cols-2 gap-3">
        {([
          { key: "retail", title: "Vendo produtos", desc: "Loja com catálogo e entregas", emoji: "🛍️" },
          { key: "service", title: "Presto serviços", desc: "Salão, hotel, farmácia, bar…", emoji: "🛠️" },
        ] as const).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setPartnerType(opt.key)}
            className={`rounded-2xl border-2 p-3 text-left transition ${partnerType === opt.key ? "border-primary bg-primary/5" : "border-border bg-card"}`}
          >
            <span className="text-xl">{opt.emoji}</span>
            <p className="mt-1 text-sm font-bold">{opt.title}</p>
            <p className="text-[11px] text-muted-foreground">{opt.desc}</p>
          </button>
        ))}
      </div>

      <h3 className="pt-2 text-xs font-bold uppercase text-muted-foreground">{t("s_identidade_da_loja")}</h3>
      <Field label={t("s_nome_da_loja")}>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t("s_ex_boutique_luanda")} />
      </Field>
      <Field label={t("s_descricao")}>
        <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} />
      </Field>
      {partnerType === "retail" ? (
        <Field label={t("s_categoria")}>
          <select className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {["Moda", "Beleza", "Eletrônicos", "Casa", "Alimentos", "Esportes", "Outros"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
      ) : (
        <>
          <Field label="Categoria de serviço">
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.service_category}
              onChange={(e) => setForm({ ...form, service_category: e.target.value })}
            >
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Horário de funcionamento">
            <Input
              value={form.opening_hours}
              onChange={(e) => setForm({ ...form, opening_hours: e.target.value })}
              placeholder="Seg–Sáb, 08h–19h"
            />
          </Field>
          <Field label="WhatsApp para marcações">
            <Input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="+244 ..." />
          </Field>
          <Field label="Serviços oferecidos (separados por vírgula)">
            <Textarea
              rows={2}
              value={form.service_tags}
              onChange={(e) => setForm({ ...form, service_tags: e.target.value })}
              placeholder="Corte de cabelo, Manicure, Massagem"
            />
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <FileField label={t("s_logo")} file={logoFile} setFile={setLogoFile} icon={<ImagePlus size={14} />} />
        <FileField label={t("s_capa")} file={coverFile} setFile={setCoverFile} icon={<ImagePlus size={14} />} />
      </div>

      <h3 className="pt-2 text-xs font-bold uppercase text-muted-foreground">{t("s_dados_fiscais")}</h3>
      <Field label={t("s_nif")}>
        <Input value={form.nif} onChange={(e) => setForm({ ...form, nif: e.target.value })} />
      </Field>
      <Field label={t("s_telefone")}>
        <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+244 ..." />
      </Field>

      <h3 className="pt-2 text-xs font-bold uppercase text-muted-foreground">{t("s_dados_bancarios_saques")}</h3>
      <Field label={t("s_banco")}>
        <Input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} placeholder={t("s_ex_bai_bfa_bic")} />
      </Field>
      <Field label={t("s_iban_conta")}>
        <Input value={form.bank_account} onChange={(e) => setForm({ ...form, bank_account: e.target.value })} />
      </Field>
      <Field label={t("s_titular")}>
        <Input value={form.bank_holder} onChange={(e) => setForm({ ...form, bank_holder: e.target.value })} />
      </Field>

      <h3 className="pt-2 text-xs font-bold uppercase text-muted-foreground">{t("s_localizacao")}</h3>
      <LocationCascade value={loc} onChange={setLoc} required />
      <Button type="button" variant="outline" onClick={captureLocation} disabled={geoBusy} className="h-11 w-full">
        {geoBusy ? <Loader2 className="animate-spin" /> : <><MapPin size={16} className="mr-2" /> {coords ? t("s_atualizar") : t("s_usar_minha_localizacao")}</>}
      </Button>
      {coords && (
        <p className="text-[11px] text-muted-foreground">Lat: {coords.lat.toFixed(5)} · Lng: {coords.lng.toFixed(5)}</p>
      )}

      {feeRequired && (
        <div className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div>
            <h3 className="text-xs font-bold uppercase text-amber-700 dark:text-amber-300">Taxa de Inscrição — {feeAoa.toLocaleString("pt-AO")} AOA</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pague por Referência Multicaixa ou transferência IBAN e anexe o comprovativo. A sua loja só será enviada à administração após este passo.
            </p>
          </div>
          <FileField label={t("s_comprovativo_de_pagamento")} file={proofFile} setFile={setProofFile} icon={<Upload size={14} />} />
        </div>
      )}

      <Button type="submit" disabled={submitting} className="h-12 w-full">
        {submitting ? <Loader2 className="animate-spin" /> : <><Upload size={16} className="mr-2" /> {t("s_enviar_para_aprovacao")}</>}
      </Button>
    </form>
  );
}

function FileField({ label, file, setFile, icon }: { label: string; file: File | null; setFile: (f: File | null) => void; icon: React.ReactNode }) {
  const { t } = useT();
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <label className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center text-[11px] text-muted-foreground hover:bg-muted/50">
        {file ? (
          <>
            <span className="px-2 truncate max-w-full">{file.name}</span>
            <span className="mt-1 text-[10px] text-primary">{t("s_clique_para_trocar")}</span>
          </>
        ) : (
          <>
            {icon}
            <span className="mt-1">{t("s_selecionar_imagem")}</span>
          </>
        )}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
    </div>
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