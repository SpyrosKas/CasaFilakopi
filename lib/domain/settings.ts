import { z } from "zod";
import type { CancellationTier, PaymentRules } from "./contracts";

// Shapes match supabase/seed.sql. Parsing fails loudly on a bad setting, since
// a guessed payment or booking rule would be worse than a failed quote.

/** Friday and Saturday nights. 0 is Sunday. */
export const DEFAULT_WEEKEND_DAYS = [5, 6];

/** Used when the payment setting, or any key in it, is missing (D6). */
export const DEFAULT_PAYMENT_RULES: PaymentRules = {
  mode: "full",
  deposit: null,
  balanceDaysBefore: 0,
};

/** Money rounds on basis points, so a finer percentage could not be honoured. */
const hasTwoDecimalsAtMost = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;

const twoDecimals = { message: "At most two decimals" };

const bookingSettingsSchema = z.object({
  /** create_hold refuses less, as a Checkout Session lives 30 minutes. */
  holdMinutes: z.number().int().min(31),
  checkoutSessionMinutes: z.number().int().positive(),
  /** Same-day arrival is refused from this hour on, Athens time. */
  sameDayCutoffHour: z.number().int().min(0).max(24),
  horizonMonths: z.number().int().positive(),
  /** Not in the seed yet. Nights priced at a season's weekend rate. */
  weekendDays: z
    .array(z.number().int().min(0).max(6))
    .default(DEFAULT_WEEKEND_DAYS),
  /** Not in the seed yet. Minimum days between today and check-in. */
  minLeadDays: z.number().int().min(0).default(0),
});

export type BookingSettings = z.output<typeof bookingSettingsSchema>;

const depositSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("percent"),
    percent: z.number().gt(0).lt(100).refine(hasTwoDecimalsAtMost, twoDecimals),
  }),
  z.object({
    kind: z.literal("fixed"),
    amountCents: z.number().int().positive(),
  }),
]);

const paymentRulesSchema = z
  .object({
    mode: z.enum(["full", "deposit"]).default(DEFAULT_PAYMENT_RULES.mode),
    deposit: depositSchema.nullable().default(DEFAULT_PAYMENT_RULES.deposit),
    balanceDaysBefore: z
      .number()
      .int()
      .min(0)
      .default(DEFAULT_PAYMENT_RULES.balanceDaysBefore),
  })
  .refine((rules) => rules.mode !== "deposit" || rules.deposit !== null, {
    message: "Deposit mode needs a deposit rule",
  });

const byDaysDescending = (tiers: CancellationTier[]) =>
  [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);

const tiersSchema = z
  .array(
    z.object({
      daysBefore: z.number().int().min(0),
      refundPercent: z
        .number()
        .min(0)
        .max(100)
        .refine(hasTwoDecimalsAtMost, twoDecimals),
    }),
  )
  .refine(
    (tiers) => new Set(tiers.map((t) => t.daysBefore)).size === tiers.length,
    { message: "Two tiers share the same days before check-in" },
  )
  .refine(
    (tiers) =>
      byDaysDescending(tiers).every(
        (tier, i, sorted) =>
          i === 0 || tier.refundPercent <= sorted[i - 1].refundPercent,
      ),
    { message: "A tier closer to check-in cannot refund more" },
  );

export function parseBookingSettings(value: unknown): BookingSettings {
  return bookingSettingsSchema.parse(value);
}

export function parsePaymentRules(value: unknown): PaymentRules {
  return paymentRulesSchema.parse(value ?? {});
}

export function parseCancellationTiers(value: unknown): CancellationTier[] {
  return tiersSchema.parse(value);
}
