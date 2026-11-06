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
 * Tiers are a percentage of the booking (D6). What the house keeps is the
 * charge, total minus that percentage. Anything paid above the charge goes
 * back, and anything short of it is still owed.
 *
 * `paidCents` is net of earlier refunds, which makes this repeatable: once the
 * refund is made, paid equals the charge and a second run refunds nothing.
 */
export const calculateRefund: CalculateRefund = ({
  rules,
  checkIn,
  cancelledOn,
  totalCents,
  paidCents,
}) => {
  assertCents(totalCents, "totalCents");
  assertCents(paidCents, "paidCents");
  const daysBefore = daysBetween(cancelledOn, checkIn);
  const tier = rules.isNonRefundable
    ? null
    : applicableTier(rules.tiers, daysBefore);

  const percent = Math.min(Math.max(tier?.refundPercent ?? 0, 0), 100);
  const chargeCents = totalCents - percentOf(totalCents, percent);
  const refundCents = Math.max(paidCents - chargeCents, 0);
  return {
    refundCents,
    retainedCents: paidCents - refundCents,
    stillOwedCents: Math.max(chargeCents - paidCents, 0),
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
