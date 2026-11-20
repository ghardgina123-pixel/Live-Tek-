import { describe, it, expect } from "vitest";
import { pickActiveStore } from "../active-store";

const stores = [
  { id: "a", status: "pending" },
  { id: "b", status: "active" },
  { id: "c", status: "active" },
];

describe("pickActiveStore (vários estabelecimentos por titular)", () => {
  it("usa a loja escolhida pelo titular", () => expect(pickActiveStore(stores, "c")?.id).toBe("c"));
  it("sem escolha, usa a primeira loja ativa", () => expect(pickActiveStore(stores, null)?.id).toBe("b"));
  it("ignora escolha que não pertence ao titular", () => expect(pickActiveStore(stores, "x")?.id).toBe("b"));
  it("sem lojas devolve null", () => expect(pickActiveStore([], "a")).toBeNull());
});
