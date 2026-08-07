import { describe, expect, it } from "vitest";
import { KEYS } from "@/lib/i18n/keys";
import { DICTS, LANGUAGES, resolveLang } from "@/lib/i18n/languages";

describe("i18n", () => {
  it("tem 20 idiomas registados", () => {
    expect(LANGUAGES).toHaveLength(20);
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(20);
  });

  it("cada idioma traduz todas as chaves, sem valores vazios", () => {
    for (const { code } of LANGUAGES) {
      const dict = DICTS[code];
      for (const key of KEYS) {
        expect(dict[key], `${code}.${key}`).toBeTruthy();
        expect(dict[key].trim().length, `${code}.${key}`).toBeGreaterThan(0);
      }
    }
  });

  it("não expõe chaves de tradução como texto visível", () => {
    for (const { code } of LANGUAGES) {
      for (const key of KEYS) expect(DICTS[code][key]).not.toBe(key);
    }
  });

  it("resolve códigos de idioma do navegador", () => {
    expect(resolveLang("pt-BR")).toBe("pt-BR");
    expect(resolveLang("pt")).toBe("pt-PT");
    expect(resolveLang("en-US")).toBe("en");
    expect(resolveLang("zh-TW")).toBe("zh-Hant");
    expect(resolveLang("zh")).toBe("zh-Hans");
    expect(resolveLang("xx")).toBeNull();
  });
});
