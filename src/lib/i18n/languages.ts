import type { Dict } from "./keys";
import { ptPT } from "./locales/pt-PT";
import { ptAO } from "./locales/pt-AO";
import { ptBR } from "./locales/pt-BR";
import { en } from "./locales/en";
import { es } from "./locales/es";
import { fr } from "./locales/fr";
import { de } from "./locales/de";
import { it } from "./locales/it";
import { nl } from "./locales/nl";
import { ar } from "./locales/ar";
import { zhHans } from "./locales/zh-Hans";
import { zhHant } from "./locales/zh-Hant";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { ru } from "./locales/ru";
import { hi } from "./locales/hi";
import { tr } from "./locales/tr";
import { sw } from "./locales/sw";
import { zu } from "./locales/zu";
import { af } from "./locales/af";

export type LangCode =
  | "pt-PT" | "pt-AO" | "pt-BR" | "en" | "es" | "fr" | "de" | "it" | "nl" | "ar"
  | "zh-Hans" | "zh-Hant" | "ja" | "ko" | "ru" | "hi" | "tr" | "sw" | "zu" | "af";

export type LanguageMeta = {
  code: LangCode;
  /** Nome no próprio idioma. */
  native: string;
  /** Nome em português (referência interna). */
  label: string;
  flag: string;
  locale: string;
  dir: "ltr" | "rtl";
};

export const LANGUAGES: readonly LanguageMeta[] = [
  { code: "pt-PT",   native: "Português (Portugal)", label: "Português (Portugal)", flag: "🇵🇹", locale: "pt-PT", dir: "ltr" },
  { code: "pt-AO",   native: "Português (Angola)",   label: "Português (Angola)",   flag: "🇦🇴", locale: "pt-AO", dir: "ltr" },
  { code: "pt-BR",   native: "Português (Brasil)",   label: "Português (Brasil)",   flag: "🇧🇷", locale: "pt-BR", dir: "ltr" },
  { code: "en",      native: "English",              label: "Inglês",               flag: "🇬🇧", locale: "en-GB", dir: "ltr" },
  { code: "es",      native: "Español",              label: "Espanhol",             flag: "🇪🇸", locale: "es-ES", dir: "ltr" },
  { code: "fr",      native: "Français",             label: "Francês",              flag: "🇫🇷", locale: "fr-FR", dir: "ltr" },
  { code: "de",      native: "Deutsch",              label: "Alemão",               flag: "🇩🇪", locale: "de-DE", dir: "ltr" },
  { code: "it",      native: "Italiano",             label: "Italiano",             flag: "🇮🇹", locale: "it-IT", dir: "ltr" },
  { code: "nl",      native: "Nederlands",           label: "Holandês",             flag: "🇳🇱", locale: "nl-NL", dir: "ltr" },
  { code: "ar",      native: "العربية",               label: "Árabe",                flag: "🇸🇦", locale: "ar-SA", dir: "rtl" },
  { code: "zh-Hans", native: "简体中文",              label: "Chinês (Simplificado)", flag: "🇨🇳", locale: "zh-CN", dir: "ltr" },
  { code: "zh-Hant", native: "繁體中文",              label: "Chinês (Tradicional)",  flag: "🇹🇼", locale: "zh-TW", dir: "ltr" },
  { code: "ja",      native: "日本語",                label: "Japonês",              flag: "🇯🇵", locale: "ja-JP", dir: "ltr" },
  { code: "ko",      native: "한국어",                label: "Coreano",              flag: "🇰🇷", locale: "ko-KR", dir: "ltr" },
  { code: "ru",      native: "Русский",              label: "Russo",                flag: "🇷🇺", locale: "ru-RU", dir: "ltr" },
  { code: "hi",      native: "हिन्दी",                  label: "Hindi",                flag: "🇮🇳", locale: "hi-IN", dir: "ltr" },
  { code: "tr",      native: "Türkçe",               label: "Turco",                flag: "🇹🇷", locale: "tr-TR", dir: "ltr" },
  { code: "sw",      native: "Kiswahili",            label: "Suaíli",               flag: "🇰🇪", locale: "sw-KE", dir: "ltr" },
  { code: "zu",      native: "isiZulu",              label: "Zulu",                 flag: "🇿🇦", locale: "zu-ZA", dir: "ltr" },
  { code: "af",      native: "Afrikaans",            label: "Africâner",            flag: "🇿🇦", locale: "af-ZA", dir: "ltr" },
] as const;

export const DICTS: Record<LangCode, Dict> = {
  "pt-PT": ptPT, "pt-AO": ptAO, "pt-BR": ptBR, en, es, fr, de, it, nl, ar,
  "zh-Hans": zhHans, "zh-Hant": zhHant, ja, ko, ru, hi, tr, sw, zu, af,
};

export const DEFAULT_LANG: LangCode = "pt-AO";

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === "string" && value in DICTS;
}

/** Resolve o idioma a partir de um código livre (ex.: "pt", "pt-br", "en-US"). */
export function resolveLang(input?: string | null): LangCode | null {
  if (!input) return null;
  const raw = input.trim();
  if (isLangCode(raw)) return raw;
  const lower = raw.toLowerCase();
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === lower || l.locale.toLowerCase() === lower);
  if (exact) return exact.code;
  const base = lower.split(/[-_]/)[0];
  if (base === "pt") return lower.includes("br") ? "pt-BR" : lower.includes("ao") ? "pt-AO" : "pt-PT";
  if (base === "zh") return /hant|tw|hk|mo/.test(lower) ? "zh-Hant" : "zh-Hans";
  const byBase = LANGUAGES.find((l) => l.code === base);
  return byBase ? byBase.code : null;
}
