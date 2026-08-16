export type Store = {
  id: string;
  name: string;
  handle: string;
  emoji: string;
  cover: string;
  rating: number;
  followers: string;
  live: boolean;
  viewers?: number;
  category: string;
  tagline: string;
};

export type Product = {
  id: string;
  name: string;
  price: number;
  oldPrice?: number;
  emoji: string;
  storeId: string;
  rating: number;
  sold: string;
  description: string;
  image?: string | null;
  priceAoa?: number;
};

// Demo seed removed at user's request.
// Real catalogue lives in the `stores` and `products` Supabase tables.
export const stores: Store[] = [];
export const products: Product[] = [];

export const findStore = (id: string) => stores.find((s) => s.id === id);
export const findProduct = (id: string) => products.find((p) => p.id === id);
export const productsByStore = (storeId: string) => products.filter((p) => p.storeId === storeId);