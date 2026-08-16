import { supabase } from "@/integrations/supabase/client";
import { fromAoa } from "@/lib/currency";
import type { Product } from "@/lib/data";

/**
 * Catálogo real: produtos e lojas vêm sempre da base de dados.
 * Só produtos `approved` de lojas `active` podem ser comprados.
 */

export type CatalogStore = {
  id: string;
  name: string;
  slug: string | null;
  category: string | null;
  partner_type: "retail" | "service";
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  phone: string | null;
  whatsapp: string | null;
  status: string;
};

export type CatalogProduct = {
  id: string;
  store_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_aoa: number;
  stock: number;
  status: string;
};

export function toCartProduct(p: CatalogProduct): Product {
  return {
    id: p.id,
    name: p.name,
    price: fromAoa(p.price_aoa),
    priceAoa: Number(p.price_aoa),
    emoji: "🛍️",
    storeId: p.store_id,
    rating: 0,
    sold: "0",
    description: p.description ?? "",
    image: p.image_url,
  };
}

export async function fetchProduct(id: string): Promise<CatalogProduct | null> {
  const { data } = await supabase
    .from("products")
    .select("id, store_id, name, description, image_url, price_aoa, stock, status")
    .eq("id", id)
    .maybeSingle();
  return (data as CatalogProduct) ?? null;
}

export async function fetchStore(id: string): Promise<CatalogStore | null> {
  const { data } = await supabase
    .from("stores")
    .select("id, name, slug, category, partner_type, description, logo_url, cover_url, phone, whatsapp, status")
    .eq("id", id)
    .maybeSingle();
  return (data as CatalogStore) ?? null;
}

export async function fetchStoreProducts(storeId: string): Promise<CatalogProduct[]> {
  const { data } = await supabase
    .from("products")
    .select("id, store_id, name, description, image_url, price_aoa, stock, status")
    .eq("store_id", storeId)
    .eq("status", "approved")
    .order("created_at", { ascending: false });
  return (data as CatalogProduct[]) ?? [];
}

/** Um produto só é comprável se estiver aprovado, com stock e loja ativa. */
export function isPurchasable(p: CatalogProduct | null, store: CatalogStore | null): boolean {
  return !!p && p.status === "approved" && Number(p.stock) > 0 && store?.status === "active";
}
