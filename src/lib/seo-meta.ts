import { SITE_URL, SITE_NAME } from "@/lib/site";
import { supabase } from "@/integrations/supabase/client";

export const clampTitle = (s: string, max = 60) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export const clampDescription = (s: string, max = 158) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;

export const absoluteUrl = (path: string) => `${SITE_URL}${path}`;

export const titleWithSite = (s: string) => clampTitle(`${s} — ${SITE_NAME}`);

export type SeoProduct = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price_aoa: number;
  store: { id: string; name: string } | null;
};

export async function loadProductSeo(id: string): Promise<SeoProduct | null> {
  try {
    const { data } = await supabase
      .from("products")
      .select("id, name, description, image_url, price_aoa, store:stores(id, name)")
      .eq("id", id)
      .maybeSingle();
    return (data as unknown as SeoProduct) ?? null;
  } catch {
    return null;
  }
}

export type SeoStore = {
  id: string;
  name: string;
  description: string | null;
  logo_url: string | null;
  cover_url: string | null;
  service_category: string | null;
  city: string | null;
  phone: string | null;
};

export async function loadStoreSeo(id: string): Promise<SeoStore | null> {
  try {
    const { data } = await supabase
      .from("stores")
      .select("id, name, description, logo_url, cover_url, service_category, city, phone")
      .eq("id", id)
      .maybeSingle();
    return (data as unknown as SeoStore) ?? null;
  } catch {
    return null;
  }
}

export type SeoProperty = {
  id: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  price_aoa: number;
  listing_type: string;
  property_type: string;
  district: string | null;
  bedrooms: number | null;
  area_m2: number | null;
};

export async function loadPropertySeo(id: string): Promise<SeoProperty | null> {
  try {
    const { data } = await (supabase as any)
      .from("properties")
      .select("id, title, description, cover_url, price_aoa, listing_type, property_type, district, bedrooms, area_m2")
      .eq("id", id)
      .maybeSingle();
    return (data as SeoProperty) ?? null;
  } catch {
    return null;
  }
}