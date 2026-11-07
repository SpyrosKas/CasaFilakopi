import { z } from "zod";
import type { AdminI18n } from "@/lib/admin/i18n";
import { later } from "@/lib/admin/later";
import type { AdminStrings } from "@/lib/admin/strings";
import type {
  CancellationRules,
  CancellationTier,
  PaymentRules,
} from "@/lib/domain/contracts";
import { addDays } from "@/lib/domain/dates";
import { percentOf } from "@/lib/domain/money";
import { calculateRefund } from "@/lib/domain/refund";
import {
  DEFAULT_PAYMENT_RULES,
  parseCancellationTiers,
  parsePaymentRules,
} from "@/lib/domain/settings";

// Yorgos's payment and cancellation rules (D6). lib/domain/settings.ts decides
// what is valid, because a rule it refuses would stop every checkout. This file
// adds only what the screen needs: plain messages and the guest preview.

export interface Rules {
  payment: PaymentRules;
  cancellation: CancellationRules;
}

const MAX_TIERS = 10;

const m = later.admin.rules.errors;

/** Stored longest notice first, as in the seed. */
function sortTiers(tiers: readonly CancellationTier[]): CancellationTier[] {
  return [...tiers].sort((a, b) => b.daysBefore - a.daysBefore);
}

function issuesFrom(parse: () => unknown): z.core.$ZodIssue[] {
  try {
    parse();
    return [];
  } catch (error) {
    if (error instanceof z.ZodError) return error.issues;
    throw error;
  }
}

function paymentMessage(field: PropertyKey | undefined): string {
  if (field === "mode") return m.paymentMode;
  if (field === "deposit") return m.depositPercent;
  if (field === "balanceDaysBefore") return m.balanceDays;
  return m.depositRequired;
}

const TIER_RULE_MESSAGES: Record<string, string> = {
  "Two tiers share the same days before check-in": m.duplicateDays,
  "A tier closer to check-in cannot refund more": m.refundOrder,
};

function tierMessage(issue: z.core.$ZodIssue): string {
  if (issue.path.includes("refundPercent")) return m.tierPercent;
  if (issue.path.includes("daysBefore")) return m.tierDays;
  return TIER_RULE_MESSAGES[issue.message] ?? m.tiersInvalid;
}

/** The form's shape only. The numbers are judged by the domain below. */
const rulesInput = z.strictObject({
  payment: z.strictObject({
    mode: z.string(m.paymentMode),
    // The owner asked for a percentage, so nothing else can be saved here.
    deposit: z
      .strictObject({
        kind: z.literal("percent", m.depositPercent),
        percent: z.number(m.depositPercent),
      })
      .nullable(),
    balanceDaysBefore: z.number(m.balanceDays),
  }),
  cancellation: z.strictObject({
    isNonRefundable: z.boolean(),
    tiers: z
      .array(
        z.strictObject({
          daysBefore: z.number(m.tierDays),
          refundPercent: z.number(m.tierPercent),
        }),
      )
      .max(MAX_TIERS, m.tooManyTiers),
  }),
});

export const rulesSchema = rulesInput.transform((input, ctx): Rules => {
  const refuse = (path: PropertyKey[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  const { payment, cancellation } = input;

  for (const issue of issuesFrom(() => parsePaymentRules(payment))) {
    const field = issue.path[0];
    refuse(["payment", field ?? "deposit"], paymentMessage(field));
  }
  // The domain tolerates this, but it would save a rule nobody meant.
  if (payment.mode === "full" && payment.deposit !== null) {
    refuse(["payment", "deposit"], m.depositNotAllowed);
  }

  const { isNonRefundable, tiers } = cancellation;
  if (isNonRefundable && tiers.length > 0) {
    refuse(["cancellation", "tiers"], m.nonRefundableTiers);
  } else if (!isNonRefundable && tiers.length === 0) {
    refuse(["cancellation", "tiers"], m.noTiers);
  }
  for (const issue of issuesFrom(() => parseCancellationTiers(tiers))) {
    refuse(["cancellation", "tiers"], tierMessage(issue));
  }

  return {
    payment: payment as PaymentRules,
    cancellation: { isNonRefundable, tiers: sortTiers(tiers) },
  };
});

/** Used only until Yorgos saves rules for the first time. */
export const DEFAULT_RULES: Rules = {
  payment: DEFAULT_PAYMENT_RULES,
  cancellation: {
    isNonRefundable: false,
    tiers: [{ daysBefore: 0, refundPercent: 0 }],
  },
};

type GuestWords = AdminStrings["rules"]["guest"];

function depositPercent(rules: PaymentRules): number | null {
  return rules.mode === "deposit" && rules.deposit?.kind === "percent"
    ? rules.deposit.percent
    : null;
}

function describePayment(rules: PaymentRules, g: GuestWords): string[] {
  const percent = depositPercent(rules);
  if (percent === null) return [g.payFull];
  const days = rules.balanceDaysBefore;
  return [
    g.depositPercent(percent),
    days === 0 ? g.balanceOnArrival : g.balance(days),
    ...(days === 0 ? [] : [g.lateBooking]),
  ];
}

interface Band {
  /** "7 to 29 days before you arrive". */
  when: string;
  /** Any day inside this band, to run the refund rules on. */
  daysBefore: number;
}

/** The periods a guest can cancel in, longest notice first. */
function refundBands(rules: CancellationRules, g: GuestWords): Band[] {
  if (rules.isNonRefundable) return [{ when: g.anyTime, daysBefore: 0 }];

  const tiers = sortTiers(rules.tiers);
  if (tiers.length === 1 && tiers[0].daysBefore === 0) {
    return [{ when: g.anyTime, daysBefore: 0 }];
  }

  const bands = tiers.map(({ daysBefore }, index): Band => {
    const shorterThan = tiers[index - 1]?.daysBefore;
    if (index === 0) return { when: g.orMore(daysBefore), daysBefore };
    if (daysBefore === 0) {
      return { when: g.lessThan(shorterThan), daysBefore };
    }
    return { when: g.between(daysBefore, shorterThan - 1), daysBefore };
  });

  // No line for 0 days: from the last line on, nothing is refunded.
  const last = tiers[tiers.length - 1]?.daysBefore;
  if (last > 0) bands.push({ when: g.lessThan(last), daysBefore: 0 });
  return bands;
}

function refundText(
  rules: CancellationRules,
  daysBefore: number,
  g: GuestWords,
): string {
  const tier = rules.isNonRefundable
    ? null
    : (sortTiers(rules.tiers).find((one) => one.daysBefore <= daysBefore) ??
      null);
  const percent = tier?.refundPercent ?? 0;
  if (percent === 100) return g.refundFull;
  if (percent === 0) return g.refundNone;
  return g.refundPart(percent);
}

const EXAMPLE_TOTAL_CENTS = 100_000;
const EXAMPLE_CHECK_IN = "2027-07-20";

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1);

/** Runs the real refund calculation on a sample booking. */
function exampleLines(
  rules: CancellationRules,
  paidCents: number,
  { t, formatRoundEuro }: AdminI18n,
): string[] {
  const g = t.rules.guest;
  return refundBands(rules, g).map(({ when, daysBefore }) => {
    const { refundCents, retainedCents } = calculateRefund({
      rules,
      checkIn: EXAMPLE_CHECK_IN,
      cancelledOn: addDays(EXAMPLE_CHECK_IN, -daysBefore),
      totalCents: EXAMPLE_TOTAL_CENTS,
      paidCents,
    });
    const back = formatRoundEuro(refundCents);
    const kept = formatRoundEuro(retainedCents);

    let outcome: string;
    // D24: a shortfall is not chased, so a guest is never told they owe more.
    if (refundCents === 0) {
      outcome =
        paidCents < EXAMPLE_TOTAL_CENTS ? g.keepNoMore(kept) : g.keep(kept);
    } else {
      outcome = retainedCents === 0 ? g.back(back) : g.backAndKeep(back, kept);
    }
    return `${capitalise(when)}: ${outcome}.`;
  });
}

export interface RulesPreview {
  payment: string[];
  cancellation: string[];
  example: {
    heading: string;
    paidInFull: { heading: string; lines: string[] };
    /** Only when guests can have paid just the deposit. */
    depositOnly: { heading: string; lines: string[] } | null;
  };
}

/** What a guest reads, for the preview on the rules screen. */
export function describeRules(
  payment: PaymentRules,
  cancellation: CancellationRules,
  i18n: AdminI18n,
): RulesPreview {
  const { t, formatRoundEuro } = i18n;
  const g = t.rules.guest;
  const percent = depositPercent(payment);
  const depositCents =
    percent === null ? null : percentOf(EXAMPLE_TOTAL_CENTS, percent);

  return {
    payment: describePayment(payment, g),
    cancellation: refundBands(cancellation, g).map(({ when, daysBefore }) =>
      g.sentence(when, refundText(cancellation, daysBefore, g)),
    ),
    example: {
      heading: g.exampleHeading(formatRoundEuro(EXAMPLE_TOTAL_CENTS)),
      paidInFull: {
        heading: g.examplePaidFull(formatRoundEuro(EXAMPLE_TOTAL_CENTS)),
        lines: exampleLines(cancellation, EXAMPLE_TOTAL_CENTS, i18n),
      },
      depositOnly:
        depositCents === null
          ? null
          : {
              heading: g.exampleDepositOnly(formatRoundEuro(depositCents)),
              lines: exampleLines(cancellation, depositCents, i18n),
            },
    },
  };
}
