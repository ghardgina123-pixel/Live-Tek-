import { describe, it, expect } from "vitest";
import { identitySchema } from "../schemas";

describe("identidade pessoal", () => {
  it("normaliza espaços, traços e minúsculas", () => {
    const r = identitySchema.parse({ nif: "0055 12345-la042", bi: "005512345 la 042" });
    expect(r).toEqual({ nif: "005512345LA042", bi: "005512345LA042" });
  });
  it("recusa BI fora do formato", () => expect(identitySchema.safeParse({ nif: "5000000001", bi: "12345" }).success).toBe(false));
});
