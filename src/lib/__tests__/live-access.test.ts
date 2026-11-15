import { describe, expect, it } from "vitest";
import { liveAccess } from "@/lib/live-access";

describe("registered category Live access", () => {
  it("Loja without subscription has free unlimited access", () => {
    expect(liveAccess("retail", null, { used: 100000, limit: 10, unlimited: false })).toEqual({ allowed: true, subscriptionBlocked: false, limitReached: false });
  });
  it("Loja with inactive subscription has access", () => {
    expect(liveAccess("retail", { can_go_live: false }, null).allowed).toBe(true);
  });
  it("Serviços without subscription is blocked", () => {
    expect(liveAccess("service", { can_go_live: false }, null)).toEqual({ allowed: false, subscriptionBlocked: true, limitReached: false });
  });
  it("Serviços with active subscription retains access", () => {
    expect(liveAccess("service", { can_go_live: true }, { used: 100, limit: null, unlimited: true }).allowed).toBe(true);
  });
  it("unknown category or unloaded service entitlement fails closed", () => {
    expect(liveAccess(undefined, null, null).allowed).toBe(false);
    expect(liveAccess("service", null, null).allowed).toBe(false);
  });
});