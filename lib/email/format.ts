import type { EmailLocale } from "@/emails/types";
import type {
  CancellationRules,
  CancellationTier,
} from "@/lib/domain/contracts";

const intlLocale = (locale: EmailLocale) =>
  locale === "el" ? "el-GR" : "en-GB";

/** A stay date, which has no time zone: UTC here only keeps the day still. */
export function formatDate(date: string, locale: EmailLocale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatMoney(cents: number, locale: EmailLocale): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** "15:00:00" from the database becomes "15:00". */
export const formatTime = (time: string | null | undefined) =>
  time ? time.slice(0, 5) : null;

function dayCount(days: number, locale: EmailLocale): string {
  if (locale === "el") return days === 1 ? "1 ημέρα" : `${days} ημέρες`;
  return days === 1 ? "1 day" : `${days} days`;
}

const WORDS = {
  night: { en: ["night", "nights"], el: ["νύχτα", "νύχτες"] },
  guest: { en: ["guest", "guests"], el: ["επισκέπτης", "επισκέπτες"] },
};

export const countWord = (
  count: number,
  kind: "night" | "guest",
  locale: EmailLocale,
) => `${count} ${WORDS[kind][locale][count === 1 ? 0 : 1]}`;

function refundWords(percent: number, locale: EmailLocale): string {
  if (locale === "el") {
    return percent === 0
      ? "δεν επιστρέφεται κάποιο ποσό"
      : `επιστρέφεται το ${percent}% της αξίας της κράτησης`;
  }
  return percent === 0
    ? "no refund"
    : `${percent}% of the booking price is refunded`;
}

/** further is the next tier further from arrival, if there is one. */
function tierLine(
  tier: CancellationTier,
  further: CancellationTier | undefined,
  locale: EmailLocale,
): string {
  const refund = refundWords(tier.refundPercent, locale);
  const days = (value: number) => dayCount(value, locale);

  if (further) {
    return locale === "el"
      ? `Ακύρωση λιγότερο από ${days(further.daysBefore)} πριν από την άφιξη: ${refund}.`
      : `Cancelling less than ${days(further.daysBefore)} before arrival: ${refund}.`;
  }
  if (tier.daysBefore === 0) {
    return locale === "el"
      ? `Ακύρωση οποτεδήποτε πριν από την άφιξη: ${refund}.`
      : `Cancelling any time before arrival: ${refund}.`;
  }
  return locale === "el"
    ? `Ακύρωση ${days(tier.daysBefore)} ή περισσότερο πριν από την άφιξη: ${refund}.`
    : `Cancelling ${days(tier.daysBefore)} or more before arrival: ${refund}.`;
}

/**
 * The cancellation terms the guest agreed to, worded from the booking's own
 * snapshot, so later edits in Admin never rewrite what they were promised.
 * Null when the snapshot holds no usable terms: the line then drops out rather
 * than guessing at policy.
 */
export function describeCancellation(
  rules: CancellationRules | null | undefined,
  locale: EmailLocale,
): string | null {
  if (!rules) return null;
  if (rules.isNonRefundable) {
    return locale === "el"
      ? "Για αυτή την κράτηση δεν προβλέπεται επιστροφή χρημάτων σε περίπτωση ακύρωσης."
      : "This booking cannot be refunded if cancelled.";
  }
  if (!Array.isArray(rules.tiers) || rules.tiers.length === 0) return null;
  const tiers = [...rules.tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  return tiers
    .map((tier, index) => tierLine(tier, tiers[index - 1], locale))
    .join("\n");
}
