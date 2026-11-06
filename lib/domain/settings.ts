import { z } from "zod";
import type { CancellationTier, PaymentRules } from "./contracts";

// Shapes match supabase/seed.sql. Parsing fails loudly on a bad setting, since
// a guessed payment or booking rule would be worse than a failed quote.

/** Friday and Saturday nights. 0 is Sunday. */
export const DEFAULT_WEEKEND_DAYS = [5, 6];

const bookingSettingsSchema = z.object({
  holdMinutes: z.number().int().positive(),
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
    percent: z.number().gt(0).max(100),
  }),
  z.object({
    kind: z.literal("fixed"),
    amountCents: z.number().int().positive(),
  }),
]);

const paymentRulesSchema = z
  .object({
    mode: z.enum(["full", "deposit", "on_arrival"]),
    deposit: depositSchema.nullable().default(null),
    balanceDaysBefore: z.number().int().min(0),
  })
  .refine((rules) => rules.mode !== "deposit" || rules.deposit !== null, {
    message: "Deposit mode needs a deposit rule",
  });

const tiersSchema = z.array(
  z.object({
    daysBefore: z.number().int(),
    refundPercent: z.number().min(0).max(100),
  }),
);

export function parseBookingSettings(value: unknown): BookingSettings {
  return bookingSettingsSchema.parse(value);
}

export function parsePaymentRules(value: unknown): PaymentRules {
  return paymentRulesSchema.parse(value);
}

export function parseCancellationTiers(value: unknown): CancellationTier[] {
  return tiersSchema.parse(value);
}
