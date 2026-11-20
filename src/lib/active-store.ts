// Loja ativa do titular (um titular pode ter várias lojas). Apenas preferência de interface:
// o acesso continua decidido pela base de dados (owner_id = auth.uid()).
const key = (userId: string) => `lt-active-store:${userId}`;
export const ACTIVE_STORE_EVENT = "lt-active-store";

export function getActiveStoreId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage.getItem(key(userId)); } catch { return null; }
}

export function setActiveStoreId(userId: string, storeId: string) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key(userId), storeId); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(ACTIVE_STORE_EVENT, { detail: storeId }));
}

export function pickActiveStore<T extends { id: string; status: string }>(stores: T[], savedId: string | null): T | null {
  if (!stores.length) return null;
  return stores.find((s) => s.id === savedId) ?? stores.find((s) => s.status === "active") ?? stores[0];
}
