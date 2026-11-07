import { z } from "zod";

/** Internal normalized identity, NOT an Atlântico wire format or proof of payment. */
export const bankIdentitySchema = z.object({
  withdrawalId: z.string().uuid(),
  kind: z.enum(["store", "affiliate", "courier"]),
  bankReference: z.string().min(1).max(200),
  amountMinor: z.string().regex(/^[1-9]\d*$/).max(24),
  currency: z.literal("AOA"),
  destinationFingerprint: z.string().min(1).max(256),
}).strict();
export type BankIdentity = z.infer<typeof bankIdentitySchema>;

/** Compare only AFTER an official adapter authenticates evidence. Never persists or settles. */
export function sameBankIdentity(expected: unknown, observed: unknown): boolean {
  const a = bankIdentitySchema.safeParse(expected);
  const b = bankIdentitySchema.safeParse(observed);
  if (!a.success || !b.success) return false;
  return a.data.withdrawalId === b.data.withdrawalId && a.data.kind === b.data.kind
    && a.data.bankReference === b.data.bankReference && a.data.amountMinor === b.data.amountMinor
    && a.data.currency === b.data.currency && a.data.destinationFingerprint === b.data.destinationFingerprint;
}