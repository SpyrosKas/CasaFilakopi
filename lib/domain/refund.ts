import type {
  CalculateRefund,
  CancellationRules,
  CancellationTier,
  PaymentRules,
  RulesSnapshot,
} from "./contracts";
import { daysBetween } from "./dates";
import { assertCents, percentOf } from "./money";

function applicableTier(
  tiers: CancellationTier[],
  daysBefore: number,
): CancellationTier | null {
  return tiers.reduce<CancellationTier | null>(
    (best, tier) =>
      tier.daysBefore <= daysBefore &&
      (best === null || tier.daysBefore > best.daysBefore)
        ? tier
        : best,
    null,
  );
}

/**
 * Pure. `cancelledOn` is the Athens date of the cancellation: pass
 * athensDate(now). The tier with the highest daysBefore not above the days
 * remaining applies, so a tier is still in force on its exact day. With no
 * tier in force, such as after check-in, nothing is refunded.
 *
 * The percentage applies to `paidCents`, what the guest has actually paid and
 * not had back. Rounding follows the money rules, and the retained amount is
 * derived, so the two always add up to what was paid.
 */
export const calculateRefund: CalculateRefund = ({
  rules,
  checkIn,
  cancelledOn,
  paidCents,
}) => {
  assertCents(paidCents, "paidCents");
  const daysBefore = daysBetween(cancelledOn, checkIn);
  const tier = rules.isNonRefundable
    ? null
    : applicableTier(rules.tiers, daysBefore);

  const percent = Math.min(Math.max(tier?.refundPercent ?? 0, 0), 100);
  const refundCents = percentOf(paidCents, percent);
  return {
    refundCents,
    retainedCents: paidCents - refundCents,
    appliedTier: tier,
  };
};

/** What create_hold stores on the booking. Later edits never reach it. */
export function buildRulesSnapshot(
  payment: PaymentRules,
  cancellation: CancellationRules,
  now: Date,
): RulesSnapshot {
  return { payment, cancellation, capturedAt: now.toISOString() };
}
