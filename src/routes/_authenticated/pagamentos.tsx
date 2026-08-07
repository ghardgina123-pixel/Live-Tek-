import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, ChevronRight, Check, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { supabase } from "@/integrations/supabase/client";
import { BrandLogo, getBrand } from "@/lib/payment-brands";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/_authenticated/pagamentos")({
  head: () => ({ meta: [{ title: "Métodos de pagamento — Live Teká" }] }),
  component: Pagamentos,
});

type Method = { id: string; display_name: string; description: string | null; method_type: string; is_cash_on_delivery: boolean };
type Account = {
  id: string;
  payment_method_id: string;
  method_type: string;
  label: string | null;
  phone: string | null;
  account_holder: string | null;
  account_number: string | null;
  iban: string | null;
  bank_name: string | null;
  card_brand: string | null;
  card_last4: string | null;
  card_exp: string | null;
};

type FieldKey = "phone" | "account_holder" | "account_number" | "iban" | "bank_name" | "card_number" | "card_exp" | "label";

const ANGOLAN_BANKS = [
  "BAI - Banco Angolano de Investimentos",
  "BFA - Banco de Fomento Angola",
  "BIC - Banco BIC",
  "Atlântico - Banco Millennium Atlântico",
  "BPC - Banco de Poupança e Crédito",
  "BNI - Banco de Negócios Internacional",
  "Standard Bank Angola",
  "SOL - Banco SOL",
  "Keve - Banco Keve",
  "BCI - Banco de Comércio e Indústria",
  "BCGA - Banco Caixa Geral Angola",
  "Yetu - Banco Yetu",
  "VTB Africa",
  "Access Bank Angola",
  "Banco Económico",
  "Outro",
];

// Conta oficial para transferências bancárias — TUSSALA KAKA
const COMPANY_BANK_ACCOUNTS = [
  { bank: "BAI - Banco Angolano de Investimentos", holder: "TUSSALA KAKA - COMÉRCIO E PRESTAÇÃO DE SERVIÇOS (SU), LDA.", iban: "AO06 0040 0000 0000 0000 0000 0" },
  { bank: "BFA - Banco de Fomento Angola", holder: "TUSSALA KAKA - COMÉRCIO E PRESTAÇÃO DE SERVIÇOS (SU), LDA.", iban: "AO06 0006 0000 0000 0000 0000 0" },
];

function categoryOf(methodType: string): "digital" | "compensation" | "local" {
  if (["multicaixa_express", "ekwanza", "unitel_money", "afrimoney", "kwik", "stripe_card"].includes(methodType)) return "digital";
  if (["bank_transfer", "multicaixa_reference"].includes(methodType)) return "compensation";
  return "local";
}

const CATEGORY_META: Record<"digital" | "compensation" | "local", { title: string; subtitle: string }> = {
  digital: { title: "Pagamentos Digitais Imediatos", subtitle: "Confirmação em segundos" },
  compensation: { title: "Pagamentos de Compensação", subtitle: "Transferência ou referência" },
  local: { title: "Pagamento no Local", subtitle: "Ao receber a encomenda" },
};

function fieldsFor(methodType: string): FieldKey[] {
  switch (methodType) {
    case "multicaixa_express":
    case "ekwanza":
    case "unitel_money":
    case "afrimoney":
    case "kwik":
      return ["account_holder", "phone", "label"];
    case "multicaixa_reference":
      return ["account_holder", "label"];
    case "stripe_card":
      return ["account_holder", "card_number", "card_exp", "label"];
    case "bank_transfer":
      return ["account_holder", "bank_name", "iban", "label"];
    case "cash_on_delivery":
      return ["account_holder", "phone", "label"];
    default:
      return ["account_holder", "label"];
  }
}

function displayNameFor(m: Method): string {
  if (m.method_type === "stripe_card") return "Cartão Visa/Mastercard";
  return m.display_name;
}

function descriptionFor(m: Method): string {
  if (m.method_type === "cash_on_delivery") return "Pague com cartão ou TPA ao receber a sua encomenda";
  if (m.method_type === "stripe_card") return "AppyPay em breve — integração local Angola";
  return m.description || getBrand(m.method_type).tagline || "";
}

function Pagamentos() {
  const { t } = useT();
  const { user } = useAuth();
  const [items, setItems] = useState<Method[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Method | null>(null);

  const loadAccounts = () => {
    if (!user) return;
    (supabase as any)
      .from("user_payment_accounts")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: Account[] | null }) => setAccounts(data ?? []));
  };

  useEffect(() => {
    supabase.from("payment_methods").select("id, display_name, description, method_type, is_cash_on_delivery")
      .eq("is_active", true).order("sort_order")
      .then(({ data }) => { setItems((data as Method[]) ?? []); setLoading(false); });
    loadAccounts();
     
  }, [user?.id]);

  const accountsByMethod = useMemo(() => {
    const map = new Map<string, Account[]>();
    accounts.forEach((a) => {
      const arr = map.get(a.payment_method_id) ?? [];
      arr.push(a);
      map.set(a.payment_method_id, arr);
    });
    return map;
  }, [accounts]);

  const grouped = useMemo(() => {
    const g: Record<"digital" | "compensation" | "local", Method[]> = { digital: [], compensation: [], local: [] };
    items.forEach((m) => g[categoryOf(m.method_type)].push(m));
    return g;
  }, [items]);

  return (
    <AppShell>
      <header className="flex items-center gap-3 px-5 pt-6 pb-4 text-white" style={{ background: "var(--gradient-brand)" }}>
        <Link to="/perfil" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15"><ArrowLeft size={18} /></Link>
        <h1 className="text-lg font-semibold">{t("s_metodos_de_pagamento")}</h1>
      </header>
      <div className="px-5 py-5">
        <p className="mb-3 text-xs text-muted-foreground">{t("s_toque_num_metodo_para_adicionar_ou_editar_os_seu")}</p>
        {loading ? (
          <div className="flex justify-center py-10"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <div className="space-y-6">
            {(["digital", "compensation", "local"] as const).map((cat) => {
              const list = grouped[cat];
              if (list.length === 0) return null;
              const meta = CATEGORY_META[cat];
              return (
                <section key={cat}>
                  <div className="mb-2 px-1">
                    <h2 className="text-xs font-bold uppercase tracking-wide text-foreground">{meta.title}</h2>
                    <p className="text-[10px] text-muted-foreground">{meta.subtitle}</p>
                  </div>
                  <ul className="space-y-2">
                    {list.map((m) => {
                      const saved = accountsByMethod.get(m.id) ?? [];
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => setActive(m)}
                            className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.99]"
                            style={{ borderColor: getBrand(m.method_type).ring, background: getBrand(m.method_type).tint }}
                          >
                            <BrandLogo methodType={m.method_type} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold">{displayNameFor(m)}</p>
                                {saved.length > 0 && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">
                                    <Check size={10} /> {saved.length}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground line-clamp-1">
                                {saved.length > 0
                                  ? (saved[0].phone || saved[0].iban || (saved[0].card_last4 ? `•••• ${saved[0].card_last4}` : saved[0].label) || t("s_configurado"))
                                  : descriptionFor(m)}
                              </p>
                            </div>
                            {m.is_cash_on_delivery ? (
                              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-bold uppercase">{t("s_na_entrega")}</span>
                            ) : (
                              <ChevronRight size={18} className="text-muted-foreground" />
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <PaymentSheet
        method={active}
        accounts={active ? (accountsByMethod.get(active.id) ?? []) : []}
        userId={user?.id ?? null}
        onClose={() => setActive(null)}
        onChanged={loadAccounts}
      />
    </AppShell>
  );
}

function PaymentSheet({
  method, accounts, userId, onClose, onChanged,
}: {
  method: Method | null;
  accounts: Account[];
  userId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  useEffect(() => {
    setForm({});
  }, [method?.id]);

  if (!method) return null;
  const brand = getBrand(method.method_type);
  const keys = fieldsFor(method.method_type);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!userId) return toast.error(t("s_faca_login_para_continuar"));
    const required = keys.filter((k) => k !== "label");
    for (const k of required) {
      if (!form[k]?.trim()) return toast.error(t("s_preencha_todos_os_campos"));
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      user_id: userId,
      payment_method_id: method.id,
      method_type: method.method_type,
      label: form.label || method.display_name,
      account_holder: form.account_holder || null,
      phone: form.phone || null,
      iban: form.iban || null,
      bank_name: form.bank_name || null,
    };
    if (form.card_number) {
      const digits = form.card_number.replace(/\D/g, "");
      payload.card_last4 = digits.slice(-4);
      payload.card_exp = form.card_exp || null;
      payload.card_brand = digits.startsWith("4") ? "visa" : digits.startsWith("5") ? "mastercard" : "card";
    }
    const { error } = await (supabase as any).from("user_payment_accounts").insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t("s_metodo_configurado"));
    onChanged();
    onClose();
  };

  const remove = async (id: string) => {
    const { error } = await (supabase as any).from("user_payment_accounts").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t("s_removido"));
    onChanged();
  };

  return (
    <Sheet open={!!method} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-3xl p-0">
        <div className="flex items-center gap-3 px-5 pt-5 pb-3 text-white" style={{ background: brand.bg }}>
          <BrandLogo methodType={method.method_type} />
          <div className="flex-1">
            <SheetHeader className="space-y-0 text-left">
              <SheetTitle className="text-base text-white">{displayNameFor(method)}</SheetTitle>
              <SheetDescription className="text-xs text-white/80">
                {descriptionFor(method) || t("s_preencha_os_dados_de_pagamento")}
              </SheetDescription>
            </SheetHeader>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          {method.method_type === "bank_transfer" && (
            <section className="rounded-2xl border border-primary/30 bg-primary/5 p-3">
              <h3 className="text-xs font-bold uppercase text-primary">{t("s_dados_oficiais_para_transferencia")}</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Efetue a transferência para uma das contas abaixo (TUSSALA KAKA - COMÉRCIO E PRESTAÇÃO DE SERVIÇOS, (SU), LDA.):
              </p>
              <ul className="mt-2 space-y-2">
                {COMPANY_BANK_ACCOUNTS.map((c) => (
                  <li key={c.bank} className="rounded-lg bg-white/70 p-2 text-[11px]">
                    <p className="font-semibold">{c.bank}</p>
                    <p className="text-muted-foreground">IBAN: <span className="font-mono">{c.iban}</span></p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {accounts.length > 0 && (
            <section>
              <h3 className="mb-2 text-xs font-bold uppercase text-muted-foreground">{t("s_guardados")}</h3>
              <ul className="space-y-2">
                {accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between rounded-xl border border-border p-3 text-sm">
                    <div>
                      <p className="font-semibold">{a.label || a.account_holder || displayNameFor(method)}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.phone || a.iban || (a.card_last4 ? `•••• ${a.card_last4}` : "")}
                      </p>
                    </div>
                    <button onClick={() => remove(a.id)} className="rounded-lg p-2 text-destructive hover:bg-destructive/10" aria-label={t("s_remover")}>
                      <Trash2 size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase text-muted-foreground">
              {accounts.length > 0 ? t("s_adicionar_outra_conta") : t("s_dados_de_pagamento")}
            </h3>

            {keys.includes("account_holder") && (
              <Field label={t("s_nome_do_titular")} value={form.account_holder ?? ""} onChange={(v) => set("account_holder", v)} placeholder={t("s_nome_completo")} />
            )}
            {keys.includes("phone") && (
              <Field label={t("s_telemovel")} value={form.phone ?? ""} onChange={(v) => set("phone", v)} placeholder="+244 9XX XXX XXX" inputMode="tel" />
            )}
            {keys.includes("iban") && (
              <Field label={t("s_iban")} value={form.iban ?? ""} onChange={(v) => set("iban", v.toUpperCase())} placeholder="AO06 0000 0000 0000 0000 0000 0" />
            )}
            {keys.includes("bank_name") && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("s_banco")}</Label>
                <select
                  value={form.bank_name ?? ""}
                  onChange={(e) => set("bank_name", e.target.value)}
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="">{t("s_selecione_o_banco")}</option>
                  {ANGOLAN_BANKS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}
            {keys.includes("card_number") && (
              <Field label={t("s_numero_do_cartao")} value={form.card_number ?? ""} onChange={(v) => set("card_number", v)} placeholder="0000 0000 0000 0000" inputMode="numeric" />
            )}
            {keys.includes("card_exp") && (
              <Field label={t("s_validade_mm_aa")} value={form.card_exp ?? ""} onChange={(v) => set("card_exp", v)} placeholder={t("s_mm_aa")} inputMode="numeric" />
            )}
            {keys.includes("label") && (
              <Field label={t("s_apelido_opcional")} value={form.label ?? ""} onChange={(v) => set("label", v)} placeholder={t("s_ex_pessoal")} />
            )}

            <Button onClick={save} disabled={saving} className="h-12 w-full text-sm font-semibold">
              {saving ? <Loader2 className="animate-spin" size={18} /> : "Guardar"}
            </Button>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label, value, onChange, placeholder, inputMode,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; inputMode?: "tel" | "numeric" | "text" }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} inputMode={inputMode} className="h-11" />
    </div>
  );
}