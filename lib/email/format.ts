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

/**
 * Mirrors calculateRefund: a tier sets a charge, a share of the booking price.
 * What the guest paid above the charge comes back, and a shortfall is never
 * collected (D24). So "kept" is a ceiling, not an amount the guest must find.
 */
function outcomeWords(refundPercent: number, locale: EmailLocale): string {
  const kept = Math.round((100 - refundPercent) * 100) / 100;
  if (kept <= 0) {
    return locale === "el"
      ? "δεν κρατείται κάποιο ποσό και επιστρέφεται ό,τι έχετε πληρώσει"
      : "nothing is kept, and everything you have paid is refunded";
  }
  if (kept >= 100) {
    return locale === "el"
      ? "κρατούμε ό,τι έχετε πληρώσει, έως το πλήρες ποσό της κράτησης. Δεν οφείλετε κάτι επιπλέον"
      : "we keep what you have paid, up to the full booking price. Nothing further is owed";
  }
  return locale === "el"
    ? `κρατούμε ό,τι έχετε πληρώσει, έως το ${kept}% της αξίας της κράτησης. Ό,τι έχετε πληρώσει πέραν αυτού επιστρέφεται και δεν οφείλετε κάτι επιπλέον`
    : `we keep what you have paid, up to ${kept}% of the booking price. Anything you have paid above that is refunded, and nothing further is owed`;
}

/** further is the next tier further from arrival, if there is one. */
function tierLine(
  tier: CancellationTier,
  further: CancellationTier | undefined,
  locale: EmailLocale,
): string {
  const outcome = outcomeWords(tier.refundPercent, locale);
  const days = (value: number) => dayCount(value, locale);

  if (further) {
    return locale === "el"
      ? `Ακύρωση λιγότερο από ${days(further.daysBefore)} πριν από την άφιξη: ${outcome}.`
      : `Cancelling less than ${days(further.daysBefore)} before arrival: ${outcome}.`;
  }
  if (tier.daysBefore === 0) {
    return locale === "el"
      ? `Ακύρωση οποτεδήποτε πριν από την άφιξη: ${outcome}.`
      : `Cancelling any time before arrival: ${outcome}.`;
  }
  return locale === "el"
    ? `Ακύρωση ${days(tier.daysBefore)} ή περισσότερο πριν από την άφιξη: ${outcome}.`
    : `Cancelling ${days(tier.daysBefore)} or more before arrival: ${outcome}.`;
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
    const outcome = outcomeWords(0, locale);
    return locale === "el"
      ? `Αν ακυρώσετε, ${outcome}.`
      : `If you cancel, ${outcome}.`;
  }
  if (!Array.isArray(rules.tiers) || rules.tiers.length === 0) return null;
  const tiers = [...rules.tiers].sort((a, b) => b.daysBefore - a.daysBefore);
  const lines = tiers.map((tier, index) =>
    tierLine(tier, tiers[index - 1], locale),
  );
  // Past the last tier no tier is in force, which calculateRefund treats as 0%.
  const last = tiers[tiers.length - 1];
  if (last.daysBefore > 0) {
    lines.push(tierLine({ daysBefore: 0, refundPercent: 0 }, last, locale));
  }
  return lines.join("\n");
}
