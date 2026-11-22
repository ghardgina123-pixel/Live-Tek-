import { describe, it, expect } from "vitest";
import { identitySchema } from "../schemas";

describe("identidade pessoal", () => {
  it("normaliza espaços, traços e minúsculas", () => {
    const r = identitySchema.parse({ nif: "0055 12345-la042", bi: "005512345 la 042" });
    expect(r).toEqual({ nif: "005512345LA042", bi: "005512345LA042" });
  });
  it("recusa BI fora do formato", () => expect(identitySchema.safeParse({ nif: "5000000001", bi: "12345" }).success).toBe(false));
  it("aceita pessoa sem empresa com BI e NIF vazio", () => {
    expect(identitySchema.parse({ nif: "", bi: "005512345LA042" })).toEqual({ nif: "", bi: "005512345LA042" });
  });
  it("aceita NIF empresarial omitido", () => {
    expect(identitySchema.parse({ bi: "005512345LA042" }).nif).toBe("");
  });
  it("aceita NIF empresarial igual ao BI", () => {
    expect(identitySchema.parse({ nif: "005512345LA042", bi: "005512345LA042" })).toEqual({ nif: "005512345LA042", bi: "005512345LA042" });
  });
  it("aceita NIF empresarial diferente do BI", () => {
    expect(identitySchema.parse({ nif: "5000000001", bi: "005512345LA042" })).toEqual({ nif: "5000000001", bi: "005512345LA042" });
  });
  it("exige BI mesmo quando existe NIF empresarial", () => {
    expect(identitySchema.safeParse({ nif: "5000000001", bi: "" }).success).toBe(false);
  });
  it("recusa NIF empresarial preenchido inválido", () => {
    expect(identitySchema.safeParse({ nif: "123", bi: "005512345LA042" }).success).toBe(false);
  });
});
