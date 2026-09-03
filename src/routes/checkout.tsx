import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, MapPin, ShieldCheck, Check, Plus, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { cartStore, useCart, useCartTotal } from "@/lib/cart-store";
import { formatPrice, fromAoa, useCurrency } from "@/lib/currency";
import { GATEWAY_PENDING_MESSAGE } from "@/lib/commerce";
import { regionStore, useRegion } from "@/lib/region";
import { CurrencySelector } from "@/components/CurrencySelector";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { BrandLogo, getBrand } from "@/lib/payment-brands";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/checkout")({
  head: () => ({
    meta: [
      { title: "Checkout — Live Teká" },
      { name: "description", content: "Finalize a sua compra na Live Teká: escolha o endereço de entrega, o método de pagamento e confirme o pedido em segurança." },
      { property: "og:title", content: "Checkout — Live Teká" },
      { property: "og:description", content: "Escolha endereço e pagamento e confirme o seu pedido na Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
      { property: "og:url", content: "https://www.livemarketplece.live/checkout" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/checkout" }],
  }),

  component: Checkout,
});

type Address = {
  id: string; label: string; street: string; district: string | null; is_default: boolean;
  provinces: { name: string } | null;
  municipalities: { name: string; shipping_fee_aoa: number } | null;
};

type PaymentMethod = {
  id: string;
  method_type: string;
  display_name: string;
  description: string | null;
  icon: string | null;
  requires_proof_upload: boolean;
  is_cash_on_delivery: boolean;
  gateway_configured: boolean;
  sort_order: number;
};

function Checkout() {
  const { t } = useT();
  const nav = useNavigate();
  const { user } = useAuth();
  const items = useCart();
  const subtotal = useCartTotal();
  const currency = useCurrency();
  const [done, setDone] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addrLoading, setAddrLoading] = useState(true);
  const [selectedAddrId, setSelectedAddrId] = useState<string | null>(null);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoading, setMethodsLoading] = useState(true);
  const [selectedMethodId, setSelectedMethodId] = useState<string | null>(null);
  const region = useRegion();
  const countryCode = region.code;

  useEffect(() => {
    if (!user) { setAddrLoading(false); return; }
    supabase.from("addresses")
      .select("id, label, street, district, is_default, provinces(name), municipalities(name, shipping_fee_aoa)")
      .eq("user_id", user.id)
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        const list = (data as Address[]) ?? [];
        setAddresses(list);
        setSelectedAddrId(list.find((a) => a.is_default)?.id ?? list[0]?.id ?? null);
        setAddrLoading(false);
      });
    supabase.from("profiles").select("country_code").eq("id", user.id).maybeSingle()
      .then(({ data }) => {
        if (data?.country_code && data.country_code !== region.code) {
          void regionStore.setCountry(data.country_code);
        }
      });
  }, [user?.id]);

  useEffect(() => {
    setMethodsLoading(true);
    supabase.from("payment_methods")
      .select("id, method_type, display_name, description, icon, requires_proof_upload, is_cash_on_delivery, gateway_configured, sort_order")
      .eq("country_code", countryCode)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .then(({ data }) => {
        const list = (data as PaymentMethod[]) ?? [];
        setMethods(list);
        const usable = list.filter((m) => m.gateway_configured || m.is_cash_on_delivery);
        setSelectedMethodId((prev) => (prev && usable.some((m) => m.id === prev) ? prev : usable[0]?.id ?? null));
        setMethodsLoading(false);
      });
  }, [countryCode]);

  const selectedAddr = addresses.find((a) => a.id === selectedAddrId) ?? null;
  // Só métodos com gateway realmente configurado (ou pagamento na entrega) são operacionais.
  const availableMethods = methods.filter((m) => m.gateway_configured || m.is_cash_on_delivery);
  const pendingMethods = methods.filter((m) => !m.gateway_configured && !m.is_cash_on_delivery);
  const selectedMethod = availableMethods.find((m) => m.id === selectedMethodId) ?? null;
  // Frete oficial em AOA (tabela `municipalities`), convertido pela taxa em vigor.
  const shippingAoa = selectedAddr?.municipalities?.shipping_fee_aoa ?? 0;
  const shippingBrl = fromAoa(Number(shippingAoa));
  const totalBrl = subtotal + shippingBrl;
  // Pagamento na entrega: o pedido fica pendente até a confirmação do recebimento.
  const gatewayPending = !!selectedMethod && !selectedMethod.gateway_configured;
  

  if (done) {
    return (
      <div className="mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-center bg-background px-6 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-glow)]">
          <Check size={40} strokeWidth={3} />
        </div>
        <h1 className="mt-5 text-2xl font-bold">{t("s_pedido_confirmado")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("s_voce_recebera_atualizacoes_pelo_chat_e_e_mail_ob")}</p>
        {orderId && <p className="mt-2 text-xs text-muted-foreground">Pedido nº <span className="font-mono">{orderId.slice(0, 8)}</span></p>}
        {gatewayPending && (
          <p className="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            {GATEWAY_PENDING_MESSAGE} O pedido fica com o estado <b>Aguardando pagamento</b> até a
            transação real ser confirmada.
          </p>
        )}
        <button onClick={() => nav({ to: "/home" })} className="mt-8 h-12 w-full rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">
          Voltar para o início
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen w-full max-w-[480px] bg-background pb-32">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background px-5 py-4">
        <button aria-label="Voltar" onClick={() => history.back()}><ArrowLeft size={20} /></button>
        <h1 className="flex-1 text-lg font-bold">{t("s_finalizar_compra")}</h1>
        <div className="rounded-full bg-muted px-2 py-1 text-xs font-semibold">
          {currency.flag} {currency.code}
        </div>
      </header>

      <section className="px-5 pt-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-bold uppercase text-muted-foreground">{t("s_entregar_em")}</h2>
          <Link to="/enderecos" className="text-xs font-semibold text-primary">{t("s_gerenciar")}</Link>
        </div>
        {addrLoading ? (
          <div className="mt-2 flex justify-center py-4"><Loader2 className="animate-spin text-primary" size={18} /></div>
        ) : addresses.length === 0 ? (
          <Link to="/enderecos" className="mt-2 flex items-center justify-center gap-2 rounded-2xl border border-dashed border-border p-4 text-sm font-semibold text-primary">
            <Plus size={16} /> {t("s_adicionar_endereco_de_entrega")}
          </Link>
        ) : (
          <div className="mt-2 space-y-2">
            {addresses.map((a) => (
              <button
                key={a.id}
                onClick={() => setSelectedAddrId(a.id)}
                className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition ${selectedAddrId === a.id ? "border-primary bg-accent" : "border-border"}`}
              >
                <MapPin size={18} className="mt-0.5 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">{a.label} · {a.street}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.district ? `${a.district}, ` : ""}{a.municipalities?.name} · {a.provinces?.name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-primary">Frete: Kz {Number(a.municipalities?.shipping_fee_aoa ?? 0).toLocaleString("pt-AO")}</p>
                </div>
                <div className={`mt-1 h-4 w-4 shrink-0 rounded-full border-2 ${selectedAddrId === a.id ? "border-primary bg-primary" : "border-border"}`}>
                  {selectedAddrId === a.id && <Check size={10} className="m-auto text-primary-foreground" strokeWidth={3} />}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="px-5 pt-5">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">Itens ({items.length})</h2>
        <ul className="mt-2 space-y-2">
          {items.map(({ product: p, qty }) => (
            <li key={p.id} className="flex items-center gap-3 rounded-xl bg-muted p-2.5">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-card text-2xl">{p.emoji}</div>
              <div className="flex-1 min-w-0">
                <p className="line-clamp-1 text-sm font-medium">{p.name}</p>
                <p className="text-xs text-muted-foreground">Qtd {qty}</p>
              </div>
              <span className="text-sm font-bold">{formatPrice(p.price * qty, currency)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="px-5 pt-5">
        <h2 className="text-xs font-bold uppercase text-muted-foreground">{t("s_forma_de_pagamento")}</h2>
        <div className="mt-2">
          <CurrencySelector variant="row" />
        </div>
        <div className="mt-2 space-y-2">
          {methodsLoading ? (
            <div className="flex justify-center py-4"><Loader2 className="animate-spin text-primary" size={18} /></div>
          ) : availableMethods.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Nenhum método de pagamento disponível para {countryCode}.
            </p>
          ) : (
            availableMethods.map((m) => (
              <PayOption
                key={m.id}
                methodType={m.method_type}
                active={selectedMethodId === m.id}
                onClick={() => setSelectedMethodId(m.id)}
                label={m.display_name}
                desc={m.description ?? ""}
                badge={m.is_cash_on_delivery ? "Pagar na entrega" : null}
              />
            ))
          )}
        </div>
        {pendingMethods.length > 0 && (
          <div className="mt-2 rounded-xl bg-muted p-3 text-[11px] text-muted-foreground">
            {GATEWAY_PENDING_MESSAGE} Indisponíveis até a integração real do gateway:{" "}
            {pendingMethods.map((m) => m.display_name).join(", ")}.
          </div>
        )}
      </section>

      <section className="mx-5 mt-5 rounded-2xl bg-muted p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Produtos ({t("s_subtotal")})</span>
          <span>{formatPrice(subtotal, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Taxa de entrega ({t("s_frete")})</span>
          <span>
            {selectedAddr
              ? <>{formatPrice(shippingBrl, currency)} <span className="text-[11px] text-muted-foreground">({formatAoa(Number(shippingAoa))})</span></>
              : <span className="text-muted-foreground">{t("s_selecione_um_endereco")}</span>}
          </span>
        </div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-bold">
          <span>{t("s_total")}</span><span>{formatPrice(totalBrl, currency)}</span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Total = produtos + taxa de entrega. É este valor que é usado no pagamento.</p>
      </section>

      <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-accent p-3 text-[11px] text-accent-foreground">
        <ShieldCheck size={14} /> {t("s_garantia_live_teka_reembolso_total_se_algo_der_e")}
      </div>

      <div className="fixed bottom-0 left-1/2 w-full max-w-[480px] -translate-x-1/2 border-t border-border bg-background p-3">
        <button
          onClick={async () => {
            if (!user) return toast.error(t("s_faca_login_para_finalizar_a_compra"));
            if (!selectedAddr) return toast.error(t("s_selecione_um_endereco_de_entrega"));
            if (!selectedMethod) return toast.error(t("s_selecione_um_metodo_de_pagamento"));
            const storeIds = Array.from(new Set(items.map((i) => i.product.storeId)));
            if (storeIds.length !== 1) return toast.error(t("s_carrinho_com_lojas_diferentes_nao_e_suportado"));
            setSubmitting(true);
            const { data, error } = await supabase.rpc("create_order_with_items", {
              p_store_id: storeIds[0],
              p_address_id: selectedAddr.id,
              p_items: items.map((i) => ({ product_id: i.product.id, quantity: i.qty })),
              p_payment_method: selectedMethod.method_type,
            });
            setSubmitting(false);
            if (error) return toast.error(error.message || t("s_falha_ao_criar_pedido"));
            setOrderId(data as unknown as string);
            setDone(true);
            cartStore.clear();
            toast.success(t("s_pedido_realizado"));
          }}
          disabled={submitting || !selectedAddr || !selectedMethod || items.length === 0}
          className="flex h-12 w-full items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]"
        >
          {submitting ? <Loader2 className="animate-spin" size={18} /> : <>{selectedMethod?.is_cash_on_delivery ? t("s_confirmar_pedido") : gatewayPending ? "Registar pedido" : t("s_pagar")} {formatPrice(totalBrl, currency)}</>}
        </button>
      </div>
    </div>
  );
}

function PayOption({ active, onClick, methodType, label, desc, badge }: { active: boolean; onClick: () => void; methodType: string; label: string; desc: string; badge?: string | null }) {
  const brand = getBrand(methodType);
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition"
      style={{
        borderColor: active ? brand.bg : "hsl(var(--border))",
        background: active ? brand.tint : "transparent",
        boxShadow: active ? `0 0 0 2px ${brand.ring}` : undefined,
      }}
    >
      <BrandLogo methodType={methodType} />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold">{label}</p>
          {badge && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-primary">{badge}</span>}
        </div>
        <p className="text-[11px] text-muted-foreground">{desc || brand.tagline}</p>
      </div>
      <div
        className="h-5 w-5 rounded-full border-2"
        style={{ borderColor: active ? brand.bg : "hsl(var(--border))", background: active ? brand.bg : "transparent" }}
      >
        {active && <Check size={14} className="m-auto text-white" strokeWidth={3} />}
      </div>
    </button>
  );
}