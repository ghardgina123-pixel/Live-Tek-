import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader2, RefreshCw, Truck, Power, PowerOff, Save, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PanelErrorBoundary } from "@/components/PanelErrorBoundary";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { formatAoa } from "@/lib/commerce";
import {
  listDeliveryTariffs,
  saveDeliveryTariff,
  setDeliveryTariffActive,
  type Tariff,
  type TariffEvent,
  type TariffRule,
} from "@/lib/tariffs.functions";

export const Route = createFileRoute("/_authenticated/admin/tarifario")({
  head: () => ({
    meta: [
      { title: "Admin · Tarifário de entrega — Live Teká" },
      { name: "description", content: "Gestão do tarifário de entrega: tarifa base, preço por km, mínimo, peso, volume e regras por classe logística." },
      { property: "og:title", content: "Admin · Tarifário de entrega — Live Teká" },
      { property: "og:description", content: "Criar, activar e consultar o histórico das tarifas de entrega da Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) throw redirect({ to: "/login" });
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
    if (!(roles ?? []).some((r) => r.role === "admin")) throw redirect({ to: "/perfil" });
  },
  component: AdminTariffs,
  errorComponent: PanelErrorBoundary,
});

const CLASSES = ["pequeno", "medio", "grande"] as const;

type Draft = {
  id: string | null;
  name: string;
  base_fee_aoa: string;
  price_per_km_aoa: string;
  min_fee_aoa: string;
  per_kg_fee_aoa: string;
  included_weight_kg: string;
  per_m3_fee_aoa: string;
  notes: string;
  rules: Record<string, { multiplier: string; min_fee_aoa: string }>;
};

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  base_fee_aoa: "",
  price_per_km_aoa: "",
  min_fee_aoa: "",
  per_kg_fee_aoa: "",
  included_weight_kg: "",
  per_m3_fee_aoa: "",
  notes: "",
  rules: {},
});

function draftFromTariff(t: Tariff): Draft {
  const rules: Draft["rules"] = {};
  for (const r of t.rules ?? []) {
    if (r.load_class) rules[r.load_class] = { multiplier: String(r.multiplier), min_fee_aoa: r.min_fee_aoa == null ? "" : String(r.min_fee_aoa) };
  }
  return {
    id: t.id,
    name: t.name,
    base_fee_aoa: String(t.base_fee_aoa),
    price_per_km_aoa: String(t.price_per_km_aoa),
    min_fee_aoa: String(t.min_fee_aoa),
    per_kg_fee_aoa: String(t.per_kg_fee_aoa),
    included_weight_kg: String(t.included_weight_kg),
    per_m3_fee_aoa: String(t.per_m3_fee_aoa),
    notes: t.notes ?? "",
    rules,
  };
}

function AdminTariffs() {
  const load = useServerFn(listDeliveryTariffs);
  const save = useServerFn(saveDeliveryTariff);
  const toggle = useServerFn(setDeliveryTariffActive);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [events, setEvents] = useState<TariffEvent[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = (await load({ data: undefined as never })) as { tariffs: Tariff[]; events: TariffEvent[] };
      setTariffs(res.tariffs);
      setEvents(res.events);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao carregar tarifário");
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => { void refresh(); }, [refresh]);

  const active = tariffs.find((t) => t.is_active) ?? null;

  const submit = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const rules: TariffRule[] = CLASSES.filter((c) => draft.rules[c]?.multiplier)
        .map((c) => ({
          load_class: c,
          capacity: null,
          multiplier: Number(draft.rules[c]!.multiplier),
          min_fee_aoa: draft.rules[c]!.min_fee_aoa === "" ? null : Number(draft.rules[c]!.min_fee_aoa),
        }));
      await save({
        data: {
          id: draft.id,
          payload: {
            name: draft.name,
            currency: "AOA",
            base_fee_aoa: Number(draft.base_fee_aoa || 0),
            price_per_km_aoa: Number(draft.price_per_km_aoa || 0),
            min_fee_aoa: Number(draft.min_fee_aoa || 0),
            per_kg_fee_aoa: Number(draft.per_kg_fee_aoa || 0),
            included_weight_kg: Number(draft.included_weight_kg || 0),
            per_m3_fee_aoa: Number(draft.per_m3_fee_aoa || 0),
            notes: draft.notes,
          },
          rules,
        },
      });
      toast.success("Tarifa guardada");
      setDraft(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao guardar");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (id: string, activeState: boolean) => {
    try {
      await toggle({ data: { id, active: activeState } });
      toast.success(activeState ? "Tarifa activada" : "Tarifa desactivada");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao alterar estado");
    }
  };

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[720px] px-5 pb-28 pt-4">
        <header className="flex items-center gap-3">
          <Link to="/admin-dashboard" aria-label="Voltar"><ArrowLeft size={20} /></Link>
          <h1 className="flex-1 text-lg font-bold">Tarifário de entrega</h1>
          <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Recarregar">
            <RefreshCw size={16} />
          </Button>
        </header>

        <section className="mt-4 rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <Truck size={16} className="text-primary" />
            <h2 className="text-sm font-bold">Regra em vigor</h2>
          </div>
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary" size={18} /></div>
          ) : active ? (
            <div className="mt-2 text-xs text-muted-foreground">
              <p className="text-sm font-semibold text-foreground">{active.name}</p>
              <p className="mt-1">
                Base {formatAoa(active.base_fee_aoa)} · {formatAoa(active.price_per_km_aoa)}/km · mínimo {formatAoa(active.min_fee_aoa)}
              </p>
              <p>
                Peso: {formatAoa(active.per_kg_fee_aoa)}/kg acima de {active.included_weight_kg} kg · Volume: {formatAoa(active.per_m3_fee_aoa)}/m³
              </p>
              {active.price_per_km_aoa > 0 && (
                <p className="mt-2 rounded-xl bg-amber-500/10 p-2 text-[11px] text-amber-900 dark:text-amber-200">
                  Esta tarifa depende de distância real de rota. Sem rota real, a taxa é marcada como não calculada.
                </p>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              Nenhuma tarifa activa. Mantém-se exactamente a taxa actual por município.
            </p>
          )}
        </section>

        <div className="mt-4 flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">Tarifas</h2>
          <Button size="sm" variant="outline" onClick={() => setDraft(emptyDraft())}>
            <Plus size={14} /> Nova tarifa
          </Button>
        </div>

        {draft && (
          <section className="mt-2 rounded-2xl border border-primary/40 bg-card p-4">
            <h3 className="text-sm font-bold">{draft.id ? "Editar tarifa" : "Nova tarifa"}</h3>
            <div className="mt-3 space-y-2">
              <Field label="Nome" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Tarifa base (Kz)" numeric value={draft.base_fee_aoa} onChange={(v) => setDraft({ ...draft, base_fee_aoa: v })} />
                <Field label="Preço por km (Kz)" numeric value={draft.price_per_km_aoa} onChange={(v) => setDraft({ ...draft, price_per_km_aoa: v })} />
                <Field label="Mínimo (Kz)" numeric value={draft.min_fee_aoa} onChange={(v) => setDraft({ ...draft, min_fee_aoa: v })} />
                <Field label="Preço por kg (Kz)" numeric value={draft.per_kg_fee_aoa} onChange={(v) => setDraft({ ...draft, per_kg_fee_aoa: v })} />
                <Field label="Peso incluído (kg)" numeric value={draft.included_weight_kg} onChange={(v) => setDraft({ ...draft, included_weight_kg: v })} />
                <Field label="Preço por m³ (Kz)" numeric value={draft.per_m3_fee_aoa} onChange={(v) => setDraft({ ...draft, per_m3_fee_aoa: v })} />
              </div>
              <Field label="Notas" value={draft.notes} onChange={(v) => setDraft({ ...draft, notes: v })} />

              <p className="pt-2 text-[11px] font-bold uppercase text-muted-foreground">Regras por classe logística</p>
              {CLASSES.map((c) => (
                <div key={c} className="grid grid-cols-3 items-end gap-2">
                  <span className="pb-2 text-xs font-semibold capitalize">{c}</span>
                  <Field
                    label="Multiplicador"
                    numeric
                    value={draft.rules[c]?.multiplier ?? ""}
                    onChange={(v) => setDraft({ ...draft, rules: { ...draft.rules, [c]: { multiplier: v, min_fee_aoa: draft.rules[c]?.min_fee_aoa ?? "" } } })}
                  />
                  <Field
                    label="Mínimo (Kz)"
                    numeric
                    value={draft.rules[c]?.min_fee_aoa ?? ""}
                    onChange={(v) => setDraft({ ...draft, rules: { ...draft.rules, [c]: { multiplier: draft.rules[c]?.multiplier ?? "1", min_fee_aoa: v } } })}
                  />
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <Button onClick={() => void submit()} disabled={saving || !draft.name.trim()}>
                {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Guardar
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Guardar ou alterar uma tarifa não altera encomendas já criadas: cada encomenda mantém o valor congelado.
            </p>
          </section>
        )}

        <div className="mt-2 space-y-2">
          {tariffs.map((t) => (
            <div key={t.id} className="rounded-2xl border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <p className="flex-1 text-sm font-semibold">{t.name}</p>
                {t.is_active ? <Badge>Activa</Badge> : <Badge variant="secondary">Inactiva</Badge>}
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Base {formatAoa(t.base_fee_aoa)} · {formatAoa(t.price_per_km_aoa)}/km · mín. {formatAoa(t.min_fee_aoa)} · {t.currency}
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setDraft(draftFromTariff(t))}>Editar</Button>
                {t.is_active ? (
                  <Button size="sm" variant="outline" onClick={() => void setActive(t.id, false)}>
                    <PowerOff size={14} /> Desactivar
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void setActive(t.id, true)}>
                    <Power size={14} /> Activar
                  </Button>
                )}
              </div>
            </div>
          ))}
          {!loading && tariffs.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Ainda não existe nenhuma tarifa criada.
            </p>
          )}
        </div>

        <h2 className="mt-5 text-xs font-bold uppercase text-muted-foreground">Histórico</h2>
        <div className="mt-2 space-y-1">
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground">Sem alterações registadas.</p>
          ) : (
            events.map((e) => (
              <p key={e.id} className="rounded-xl bg-muted p-2 text-[11px] text-muted-foreground">
                {new Date(e.created_at).toLocaleString("pt-AO")} · {e.action}
              </p>
            ))
          )}
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange, numeric }: { label: string; value: string; onChange: (v: string) => void; numeric?: boolean }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-muted-foreground">{label}</span>
      <Input
        value={value}
        inputMode={numeric ? "decimal" : undefined}
        onChange={(ev) => {
          const v = ev.target.value;
          if (numeric && v !== "" && !/^\d*([.,]\d*)?$/.test(v)) return;
          onChange(numeric ? v.replace(",", ".") : v);
        }}
      />
    </label>
  );
}
