import { z } from "zod";
import type {
  CancellationRules,
  CancellationTier,
  DepositRule,
  PaymentRules,
} from "@/lib/domain/contracts";
import { t } from "@/lib/admin/strings";

// Yorgos's payment and cancellation rules (D6). Shapes match
// lib/domain/contracts.ts and supabase/seed.sql. These checks run on the
// server for every save and also drive the preview in the browser.

const MAX_DAYS = 365;
const MAX_DEPOSIT_CENTS = 1_000_000;
const MAX_TIERS = 10;

const m = t.rules.errors;

const depositSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("percent"),
    percent: z
      .int(m.depositPercent)
      .min(1, m.depositPercent)
      .max(99, m.depositPercent),
  }),
  z.strictObject({
    kind: z.literal("fixed"),
    amountCents: z
      .int(m.depositAmount)
      .min(100, m.depositAmount)
      .max(MAX_DEPOSIT_CENTS, m.depositAmount),
  }),
]);

export const paymentRulesSchema = z
  .strictObject({
    mode: z.enum(["full", "deposit", "on_arrival"], m.paymentMode),
    deposit: depositSchema.nullable(),
    balanceDaysBefore: z
      .int(m.balanceDays)
      .min(0, m.balanceDays)
      .max(MAX_DAYS, m.balanceDays),
  })
  .superRefine((rules, ctx) => {
    if (rules.mode === "deposit" && rules.deposit === null) {
      ctx.addIssue({
        code: "custom",
        path: ["deposit"],
        message: m.depositRequired,
      });
    }
    if (rules.mode !== "deposit" && rules.deposit !== null) {
      ctx.addIssue({
        code: "custom",
        path: ["deposit"],
        message: m.depositNotAllowed,
      });
    }
  }) satisfies z.ZodType<PaymentRules>;

const tierSchema = z.strictObject({
  daysBefore: z.int(m.tierDays).min(0, m.tierDays).max(MAX_DAYS, m.tierDays),
  refundPercent: z
    .int(m.tierPercent)
    .min(0, m.tierPercent)
    .max(100, m.tierPercent),
});

/** Stored longest notice first, as in the seed. */
function sortTiers(tiers: readonly CancellationTier[]): CancellationTier[] {
  return [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
}

function tierProblem(tiers: readonly CancellationTier[]): string | null {
  if (tiers.length === 0) return m.noTiers;
  const sorted = sortTiers(tiers);
  if (new Set(sorted.map((tier) => tier.daysBefore)).size !== sorted.length) {
    return m.duplicateDays;
  }
  // Without a line for 0 days, a late cancellation would match no tier.
  if (sorted[sorted.length - 1].daysBefore !== 0) return m.needZeroTier;
  // Cancelling later must never pay back more than cancelling earlier.
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].refundPercent >= sorted[i - 1].refundPercent) {
      return m.refundOrder;
    }
  }
  return null;
}

export const cancellationRulesSchema = z
  .strictObject({
    isNonRefundable: z.boolean(),
    tiers: z.array(tierSchema).max(MAX_TIERS, m.tooManyTiers),
  })
  .superRefine((rules, ctx) => {
    const problem = rules.isNonRefundable
      ? rules.tiers.length > 0
        ? m.nonRefundableTiers
        : null
      : tierProblem(rules.tiers);
    if (problem) {
      ctx.addIssue({ code: "custom", path: ["tiers"], message: problem });
    }
  })
  .transform((rules): CancellationRules => ({
    ...rules,
    tiers: sortTiers(rules.tiers),
  }));

export const rulesSchema = z.strictObject({
  payment: paymentRulesSchema,
  cancellation: cancellationRulesSchema,
});

export type RulesInput = z.input<typeof rulesSchema>;

/** Used only until Yorgos saves rules for the first time. */
export const DEFAULT_RULES: RulesInput = {
  payment: { mode: "full", deposit: null, balanceDaysBefore: 14 },
  cancellation: {
    isNonRefundable: false,
    tiers: [{ daysBefore: 0, refundPercent: 0 }],
  },
};

/** "150" or "150.50" to whole cents, without floating point. */
export function eurosToCents(input: string): number | null {
  const match = /^(\d{1,6})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function centsToEuros(cents: number): string {
  const euros = Math.floor(cents / 100);
  const rest = cents % 100;
  return rest === 0
    ? String(euros)
    : `${euros}.${String(rest).padStart(2, "0")}`;
}

const g = t.rules.guest;

function depositSentence(deposit: DepositRule): string {
  return deposit.kind === "percent"
    ? g.depositPercent(deposit.percent)
    : g.depositFixed(centsToEuros(deposit.amountCents));
}

function describePayment(rules: PaymentRules): string[] {
  if (rules.mode === "full") return [g.payFull];
  if (rules.mode === "on_arrival") return [g.payOnArrival];
  return [
    rules.deposit ? depositSentence(rules.deposit) : g.depositMissing,
    g.balance(rules.balanceDaysBefore),
  ];
}

function describeRefund(percent: number): string {
  if (percent === 100) return g.refundFull;
  if (percent === 0) return g.refundNone;
  return g.refundPart(percent);
}

function describeCancellation(rules: CancellationRules): string[] {
  if (rules.isNonRefundable) return [g.nonRefundable];
  const tiers = sortTiers(rules.tiers);
  if (tiers.length === 1 && tiers[0].daysBefore === 0) {
    return [g.anyTime(describeRefund(tiers[0].refundPercent))];
  }
  return tiers.map((tier, index) => {
    const refund = describeRefund(tier.refundPercent);
    if (index === 0) return g.orMore(tier.daysBefore, refund);
    const longer = tiers[index - 1].daysBefore;
    if (tier.daysBefore === 0) return g.lessThan(longer, refund);
    return g.between(tier.daysBefore, longer - 1, refund);
  });
}

/** The sentences a guest reads, for the preview on the rules screen. */
export function describeRules(
  payment: PaymentRules,
  cancellation: CancellationRules,
): { payment: string[]; cancellation: string[] } {
  return {
    payment: describePayment(payment),
    cancellation: describeCancellation(cancellation),
  };
}
