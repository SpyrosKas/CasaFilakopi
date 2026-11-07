import type {
  CancellationOutcome,
  Cents,
  IsoDate,
} from "@/lib/domain/contracts";

// Pure rules for the payment flows, with no database and no Stripe.

/** Stripe refuses a smaller charge in EUR. */
export const MIN_CHARGE_CENTS = 50;

/**
 * Stripe counts its 30-minute minimum from when the Session is created, which
 * is a moment after the hold starts. A Session timed to exactly 30 minutes from
 * the hold would be refused, so it runs 31 from the start of the hold, which
 * is 30 minutes and some seconds for the guest. It also comes from the hold, so
 * a repeated create with the same idempotency key has identical parameters.
 */
const SESSION_MINUTES_FROM_HOLD = 31;

export function sessionExpiresAt(
  holdExpiresAt: string,
  holdMinutes: number,
): number {
  const end = Date.parse(holdExpiresAt);
  const start = end - holdMinutes * 60_000;
  return Math.floor(
    Math.min(start + SESSION_MINUTES_FROM_HOLD * 60_000, end) / 1000,
  );
}

/** Five-minute slots, so two tabs in the same moment share one Session. */
const BALANCE_SLOT_MS = 5 * 60_000;
const BALANCE_SESSION_MINUTES = 36;

export function balanceSlot(now: Date) {
  const slot = Math.floor(now.getTime() / BALANCE_SLOT_MS);
  return {
    slot,
    expiresAt: Math.floor(
      (slot * BALANCE_SLOT_MS + BALANCE_SESSION_MINUTES * 60_000) / 1000,
    ),
  };
}

export type CancelRoute = "direct" | "host" | "closed";

/**
 * Who decides a guest's cancellation.
 *
 * - direct: the guest cancels here, at once. Only when they lose nothing under
 *   the booking's own rules, nothing is in dispute, and the whole refund can go
 *   back by card without anyone handling cash or a bank transfer.
 * - host: it goes to Yorgos as a message. A partial refund is a conversation,
 *   and a stay that has started is his to manage.
 * - closed: nothing to cancel.
 */
export function cancelRoute(input: {
  status: string;
  today: IsoDate;
  checkIn: IsoDate;
  outcome: CancellationOutcome | null;
  disputedCents: Cents;
  manualRefundCents: Cents;
}): CancelRoute {
  const { status, today, checkIn, outcome } = input;
  if (status === "checked_in") return "host";
  if (status !== "confirmed") return "closed";
  if (!outcome || today > checkIn) return "host";
  if (input.disputedCents > 0 || input.manualRefundCents > 0) return "host";
  return outcome.retainedCents === 0 ? "direct" : "host";
}

/** Anything short of the whole promised refund going out counts as delayed. */
export const isRefundDelayed = (
  shortCents: Cents,
  run: { failedCents: Cents; unknownCents: Cents },
) => shortCents > 0 || run.failedCents > 0 || run.unknownCents > 0;

export interface CardPayment {
  id: string;
  method: string;
  status: string;
  amount_cents: number;
  created_at: string;
}

export interface RefundLine {
  payment_id: string;
  status: string;
  amount_cents: number;
}

export interface CardRefundShare {
  paymentId: string;
  amountCents: number;
}

/**
 * Splits a refund across card payments, newest first, never above what a
 * payment still has. Whatever does not fit is `shortCents`, so a caller can
 * refuse rather than send back less than it promised.
 */
export function planCardRefund(
  amountCents: Cents,
  payments: CardPayment[],
  refunds: RefundLine[],
): { shares: CardRefundShare[]; shortCents: Cents } {
  const left = (payment: CardPayment) =>
    payment.amount_cents -
    refunds
      .filter((r) => r.payment_id === payment.id && r.status !== "failed")
      .reduce((total, r) => total + r.amount_cents, 0);

  const shares: CardRefundShare[] = [];
  let remaining = amountCents;
  const cards = payments
    .filter((p) => p.status === "succeeded" && p.method === "card")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const payment of cards) {
    const share = Math.min(left(payment), remaining);
    if (share > 0) {
      shares.push({ paymentId: payment.id, amountCents: share });
      remaining -= share;
    }
  }
  return { shares, shortCents: remaining };
}
