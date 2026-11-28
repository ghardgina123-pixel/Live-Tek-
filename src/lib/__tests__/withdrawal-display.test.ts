import { describe, expect, it } from "vitest";
import { canRequestWithdrawal, maskedBankAccount, withdrawalResult } from "../withdrawal-display";

describe("Withdrawal response and bank privacy", () => {
  it("never treats ok:false as a successful operation", () => {
    expect(withdrawalResult({ ok: false, reason: "bank_confirmation_required" })).toEqual({ ok: false, reason: "bank_confirmation_required" });
    expect(withdrawalResult({ ok: "true" }).ok).toBe(false);
    expect(withdrawalResult(null).ok).toBe(false);
    expect(withdrawalResult({ ok: true, status: "approved" })).toEqual({ ok: true, status: "approved" });
  });
  it("never exposes more than the last four bank characters", () => {
    expect(maskedBankAccount("AO06 0040 0000 0000 1234 5678 9")).toBe("•••• 6789");
    expect(maskedBankAccount("1234")).toBe("••••");
    expect(maskedBankAccount(null)).toBe("Não registado");
  });
  it("refuses an offer below the server minimum of 10,000 AOA, even with sufficient balance", () => {
    expect(canRequestWithdrawal(50000, 9999, 10000, false)).toBe(false);
    expect(canRequestWithdrawal(9999, 200000, 10000, false)).toBe(false);
    expect(canRequestWithdrawal(10000, 200000, 10000, false)).toBe(true);
    expect(canRequestWithdrawal(10000, 200000, 10000, true)).toBe(false);
  });
});