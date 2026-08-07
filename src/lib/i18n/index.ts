import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Dict, TKey } from "./keys";
import {
  DEFAULT_LANG, DICTS, LANGUAGES, isLangCode, resolveLang,
  type LangCode, type LanguageMeta,
} from "./languages";

export { LANGUAGES, DEFAULT_LANG, resolveLang, isLangCode };
export type { LangCode, LanguageMeta, TKey, Dict };

const STORAGE_KEY = "lm:lang";

let current: LangCode = DEFAULT_LANG;
let hydrated = false;
const listeners = new Set<() => void>();

function meta(code: LangCode): LanguageMeta {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}

function applyDocument(code: LangCode) {
  if (typeof document === "undefined") return;
  const m = meta(code);
  document.documentElement.lang = m.locale;
  document.documentElement.dir = m.dir;
}

function emit(code: LangCode) {
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* noop */ }
  applyDocument(code);
  listeners.forEach((l) => l());
}

/** Guarda a preferência na conta do utilizador (restaurada em qualquer dispositivo). */
async function persistRemote(code: LangCode) {
  try {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    await supabase.from("profiles").update({ language_code: code }).eq("id", data.user.id);
  } catch { /* offline: fica só o valor local */ }
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  let initial: LangCode | null = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLangCode(saved)) initial = saved;
  } catch { /* noop */ }
  if (!initial) initial = resolveLang(navigator.language) ?? DEFAULT_LANG;
  emit(initial);
  // A conta é a fonte de verdade quando existe sessão.
  void (async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase
      .from("profiles").select("language_code").eq("id", data.user.id).maybeSingle();
    const remote = resolveLang((profile as { language_code?: string | null } | null)?.language_code);
    if (remote && remote !== current) emit(remote);
    else if (!remote) void persistRemote(current);
  })();
}

export const langStore = {
  get: () => current,
  subscribe(listener: () => void) {
    hydrate();
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  /** Altera o idioma de imediato (sem reiniciar) e sincroniza local + conta. */
  async set(code: string) {
    const next = resolveLang(code);
    if (!next || next === current) return;
    emit(next);
    await persistRemote(next);
  },
  /** Reaplica a preferência guardada na conta (chamado após login). */
  async syncFromAccount() {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    const { data: profile } = await supabase
      .from("profiles").select("language_code").eq("id", data.user.id).maybeSingle();
    const remote = resolveLang((profile as { language_code?: string | null } | null)?.language_code);
    if (remote) emit(remote);
    else await persistRemote(current);
  },
};

export function useLang(): LangCode {
  const code = useSyncExternalStore(langStore.subscribe, () => current, () => DEFAULT_LANG);
  useEffect(() => { hydrate(); }, []);
  return code;
}

export type Translate = (key: TKey, vars?: Record<string, string | number>) => string;

function interpolate(text: string, vars?: Record<string, string | number>) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/**
 * Hook de tradução. `t("cart_empty")` devolve sempre texto real:
 * idioma activo → português (Angola) → português (Portugal).
 */
export function useT() {
  const lang = useLang();
  const info = meta(lang);
  const t = useCallback<Translate>(
    (key, vars) => {
      const dict: Dict = DICTS[lang] ?? DICTS[DEFAULT_LANG];
      const value = dict[key] ?? DICTS[DEFAULT_LANG][key] ?? DICTS["pt-PT"][key];
      return interpolate(value ?? String(key), vars);
    },
    [lang],
  );
  return {
    t,
    lang,
    locale: info.locale,
    dir: info.dir,
    languageName: info.native,
    setLang: (code: string) => langStore.set(code),
  };
}

/** Tradução fora de componentes (validações, toasts em callbacks). */
export function translate(key: TKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[current] ?? DICTS[DEFAULT_LANG];
  return interpolate(dict[key] ?? DICTS[DEFAULT_LANG][key], vars);
}

/** Compatibilidade com o seletor antigo. */
export const LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.native]),
);
