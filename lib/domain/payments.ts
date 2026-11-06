import type { Cents, IsoDate, PaymentRules } from "./contracts";
import { addDays } from "./dates";
import { percentOf } from "./money";

export interface PaymentSplit {
  dueNowCents: Cents;
  balanceCents: Cents;
  balanceDueOn: IsoDate | null;
}

export interface PaymentSplitInput {
  totalCents: Cents;
  rules: PaymentRules;
  checkIn: IsoDate;
  today: IsoDate;
}

function depositCents(totalCents: Cents, rules: PaymentRules): Cents {
  if (!rules.deposit) throw new Error("Deposit mode needs a deposit rule");
  const deposit =
    rules.deposit.kind === "percent"
      ? percentOf(totalCents, rules.deposit.percent)
      : rules.deposit.amountCents;
  return Math.min(deposit, totalCents);
}

/** The balance is derived, so dueNow + balance always equals the total. */
function split(
  totalCents: Cents,
  dueNowCents: Cents,
  dueOn: IsoDate,
): PaymentSplit {
  const balanceCents = totalCents - dueNowCents;
  return {
    dueNowCents,
    balanceCents,
    balanceDueOn: balanceCents > 0 ? dueOn : null,
  };
}

/**
 * - full: everything now.
 * - deposit: the deposit now, the rest balanceDaysBefore days before check-in.
 *   If that date is before today, everything is due now. A balance due today
 *   has not passed, so it stays a balance.
 * - on_arrival: nothing now, everything on the check-in date. A deposit rule
 *   is ignored in this mode, matching confirm_without_payment.
 */
export function splitPayment({
  totalCents,
  rules,
  checkIn,
  today,
}: PaymentSplitInput): PaymentSplit {
  if (rules.mode === "on_arrival") return split(totalCents, 0, checkIn);
  if (rules.mode === "full") return split(totalCents, totalCents, checkIn);

  const dueOn = addDays(checkIn, -rules.balanceDaysBefore);
  if (dueOn < today) return split(totalCents, totalCents, dueOn);
  return split(totalCents, depositCents(totalCents, rules), dueOn);
}
