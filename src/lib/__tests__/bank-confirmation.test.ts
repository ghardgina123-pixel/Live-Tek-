import { describe, expect, it } from "vitest";
import { sameBankIdentity } from "../bank-confirmation";

const identity = {
  withdrawalId: "00000000-0000-4000-8000-000000000001", kind: "store", bankReference: "FIXTURE-TEST-REF",
  amountMinor: "1000000", currency: "AOA", destinationFingerprint: "FIXTURE-TEST-DESTINATION",
};
describe("Internal comparison only — not the twelve bank tests", () => {
  it("matches the exact identity without confirming a payment", () => expect(sameBankIdentity(identity, { ...identity })).toBe(true));
  it("rejects a different withdrawal", () => expect(sameBankIdentity(identity, { ...identity, withdrawalId: "00000000-0000-4000-8000-000000000002" })).toBe(false));
  it("rejects a different kind", () => expect(sameBankIdentity(identity, { ...identity, kind: "affiliate" })).toBe(false));
  it("rejects a different reference", () => expect(sameBankIdentity(identity, { ...identity, bankReference: "OTHER" })).toBe(false));
  it("rejects different amounts without rounding", () => expect(sameBankIdentity(identity, { ...identity, amountMinor: "1000001" })).toBe(false));
  it("rejects unsupported currency", () => expect(sameBankIdentity(identity, { ...identity, currency: "USD" })).toBe(false));
  it("rejects a different destination", () => expect(sameBankIdentity(identity, { ...identity, destinationFingerprint: "OTHER" })).toBe(false));
  it("rejects unnormalized fractional amounts", () => expect(sameBankIdentity(identity, { ...identity, amountMinor: "1000000.1" })).toBe(false));
  it("rejects client assertions of verification", () => expect(sameBankIdentity(identity, { ...identity, verified: true })).toBe(false));
});