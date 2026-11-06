import type {
  Cents,
  CheckoutPaymentKind,
  IsoDate,
  PaymentRules,
} from "./contracts";
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

const payInFull = (totalCents: Cents): PaymentSplit => ({
  dueNowCents: totalCents,
  balanceCents: 0,
  balanceDueOn: null,
});

/**
 * - full: everything now.
 * - deposit: the deposit now, the rest balanceDaysBefore days before check-in.
 *   0 days means the balance is paid on arrival. Booking on or after that date
 *   pays everything now.
 *
 * The balance is derived, so dueNow + balance always equals the total.
 */
export function splitPayment({
  totalCents,
  rules,
  checkIn,
  today,
}: PaymentSplitInput): PaymentSplit {
  if (rules.mode === "full") return payInFull(totalCents);

  const dueOn = addDays(checkIn, -rules.balanceDaysBefore);
  if (today >= dueOn) return payInFull(totalCents);

  const dueNowCents = depositCents(totalCents, rules);
  if (dueNowCents === totalCents) return payInFull(totalCents);
  return {
    dueNowCents,
    balanceCents: totalCents - dueNowCents,
    balanceDueOn: dueOn,
  };
}

/** What this booking's payment is: nothing left to pay later means full. */
export function paymentKindOf(split: PaymentSplit): CheckoutPaymentKind {
  return split.balanceCents === 0 ? "full" : "deposit";
}
