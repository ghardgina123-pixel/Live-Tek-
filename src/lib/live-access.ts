/** Category comes from the registered store, never a client-selected plan. */
export function liveAccess(
  partnerType: "retail" | "service" | undefined,
  status: { can_go_live: boolean } | null,
  usage: { unlimited: boolean; limit: number | null; used: number } | null,
) {
  if (partnerType === "retail") return { allowed: true, subscriptionBlocked: false, limitReached: false };
  const subscriptionBlocked = partnerType === "service" && status !== null && !status.can_go_live;
  const limitReached = partnerType === "service" && !!usage && !usage.unlimited && usage.limit !== null && usage.used >= usage.limit;
  return { allowed: partnerType === "service" && status?.can_go_live === true && !limitReached, subscriptionBlocked, limitReached };
}