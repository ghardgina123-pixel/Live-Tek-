import { createFileRoute, Link } from "@tanstack/react-router";
import { Minus, Plus, Trash2, ShieldCheck, ShoppingBag } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { cartStore, useCart, useCartTotal } from "@/lib/cart-store";
import { formatPrice, useCurrency } from "@/lib/currency";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/carrinho")({
  head: () => ({
    meta: [
      { title: "Carrinho — Live Teká" },
      { name: "description", content: "Reveja os produtos do seu carrinho na Live Teká, confirme quantidades e avance para o checkout com entrega em Angola." },
      { property: "og:title", content: "Carrinho — Live Teká" },
      { property: "og:description", content: "Reveja os produtos do seu carrinho e avance para o checkout na Live Teká." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://www.livemarketplece.live/carrinho" },
    ],
    links: [{ rel: "canonical", href: "https://www.livemarketplece.live/carrinho" }],
  }),

  component: Cart,
});

function Cart() {
  const items = useCart();
  const total = useCartTotal();
  const currency = useCurrency();
  const { t } = useT();

  if (items.length === 0) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center px-6 pt-32 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent">
            <ShoppingBag size={36} className="text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-bold">{t("cart_empty")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("search_placeholder")}</p>
          <Link to="/home" className="mt-6 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">
            {t("continue")}
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="px-5 pt-6 pb-3">
        <div className="flex items-center gap-3">
          <BackButton fallback="/home" className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-foreground" />
          <div>
            <h1 className="text-2xl font-bold">{t("cart_title")}</h1>
            <p className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "item" : "itens"}</p>
          </div>
        </div>
      </header>

      <ul className="space-y-3 px-5">
        {items.map(({ product: p, qty }) => (
          <li key={p.id} className="flex gap-3 rounded-2xl bg-card p-3 shadow-[var(--shadow-soft)]">
            <div className="flex h-20 w-20 items-center justify-center rounded-xl bg-accent text-4xl">{p.emoji}</div>
            <div className="flex-1 min-w-0">
              <p className="line-clamp-2 text-sm font-medium">{p.name}</p>
              <p className="mt-1 text-sm font-bold text-primary">{formatPrice(p.price, currency)}</p>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex items-center gap-2 rounded-full bg-muted">
                  <button aria-label={`Diminuir quantidade de ${p.name}`} onClick={() => cartStore.setQty(p.id, qty - 1)} className="flex h-7 w-7 items-center justify-center"><Minus size={14} /></button>
                  <span className="text-sm font-semibold">{qty}</span>
                  <button aria-label={`Aumentar quantidade de ${p.name}`} onClick={() => cartStore.setQty(p.id, qty + 1)} className="flex h-7 w-7 items-center justify-center"><Plus size={14} /></button>
                </div>
                <button aria-label={`Remover ${p.name} do carrinho`} onClick={() => cartStore.remove(p.id)} className="text-muted-foreground"><Trash2 size={16} /></button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div className="mx-5 mt-5 rounded-2xl bg-muted p-4 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">{t("subtotal")}</span><span>{formatPrice(total, currency)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">{t("delivery_fee")}</span><span className="font-semibold text-primary">Grátis</span></div>
        <div className="mt-2 flex justify-between border-t border-border pt-2 text-base font-bold"><span>{t("total")}</span><span>{formatPrice(total, currency)}</span></div>
      </div>

      <div className="mx-5 mt-3 flex items-center gap-2 rounded-xl bg-accent p-3 text-[11px] text-accent-foreground">
        <ShieldCheck size={14} /> Pagamento seguro com criptografia de ponta a ponta
      </div>

      <div className="px-5 pt-4">
        <Link to="/checkout" className="flex h-12 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow)]">
          Finalizar compra
        </Link>
      </div>
    </AppShell>
  );
}