import {
  balanceOf,
  cancellationOutcome,
  planRefund,
  summariseMoney,
} from "@/lib/admin/stays";
import type {
  CancellationOutcome,
  PriceBreakdown,
} from "@/lib/domain/contracts";
import { athensDate } from "@/lib/domain/dates";
import { sumCents } from "@/lib/domain/money";
import { alertHost } from "./alerts";
import { loadBookingMoney, settleBalanceSessions } from "./balance";
import { queue, rpc, type PaymentDeps } from "./deps";
import { cancelRoute, planCardRefund, type CancelRoute } from "./policy";
import { refundShares } from "./refunds";
import { guestTokenSchema } from "./schemas";

// What a guest can do with their private link (T4.9). Every function starts
// from the token, never a booking id from the browser, so a token can only
// reach its own booking. A wrong, expired or malformed token gives null, and
// nothing in the answer says which.

export interface TokenBooking {
  id: string;
  reference: string | null;
  status: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  guest_name: string | null;
  guest_email: string | null;
  price_breakdown: PriceBreakdown;
  total_cents: number;
  due_now_cents: number;
  rules_snapshot: unknown;
  locale: string;
}

export async function bookingForToken(
  deps: PaymentDeps,
  token: string,
): Promise<TokenBooking | null> {
  if (!guestTokenSchema.safeParse(token).success) return null;
  const { data, error } = await deps.db.rpc("booking_for_token", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return (data as TokenBooking | null) ?? null;
}

export interface GuestView {
  booking: TokenBooking;
  paidCents: number;
  /** Zero on anything cancelled or closed: nothing is ever asked for (D24). */
  balanceCents: number;
  refundedCents: number;
  cancel: {
    route: CancelRoute;
    outcome: CancellationOutcome | null;
  };
}

const CLOSED = ["cancelled", "refunded", "expired", "no_show"];

export async function loadGuestView(
  deps: PaymentDeps,
  token: string,
): Promise<GuestView | null> {
  const booking = await bookingForToken(deps, token);
  if (!booking) return null;

  const { payments, refunds } = await loadBookingMoney(deps, booking.id);
  const money = summariseMoney(payments, refunds);
  const today = athensDate(deps.now());
  const outcome = cancellationOutcome({
    snapshot: booking.rules_snapshot,
    checkIn: booking.check_in,
    cancelledOn: today,
    totalCents: booking.total_cents,
    paidCents: money.paidCents,
  });
  const plan = outcome
    ? planRefund(outcome.refundCents, payments, refunds)
    : null;

  return {
    booking,
    paidCents: Math.max(money.paidCents + money.disputedCents, 0),
    refundedCents: money.refundedCents,
    balanceCents: CLOSED.includes(booking.status)
      ? 0
      : balanceOf(money, booking.total_cents),
    cancel: {
      outcome,
      route: cancelRoute({
        status: booking.status,
        today,
        checkIn: booking.check_in,
        outcome,
        disputedCents: money.disputedCents,
        manualRefundCents: plan
          ? sumCents(plan.manual.map((row) => row.amountCents))
          : 0,
      }),
    },
  };
}

export type GuestCancelResult =
  | { kind: "not_found" }
  | { kind: "cancelled"; refundCents: number; refundDelayed: boolean }
  /** The rules or the money changed since the page loaded. */
  | { kind: "moved" }
  /** Yorgos decides this one. */
  | { kind: "needs_host" }
  | { kind: "closed" };

/**
 * Cancels at once only when the guest loses nothing, so no judgement is needed:
 * anything else is a conversation with Yorgos, sent by messageHost below. The
 * booking is cancelled first and refunded second. If the refund fails the dates
 * are open and the amount shows on Yorgos's "money to give back".
 */
export async function cancelForGuest(
  deps: PaymentDeps,
  token: string,
  expectedRefundCents: number,
): Promise<GuestCancelResult> {
  const view = await loadGuestView(deps, token);
  if (!view) return { kind: "not_found" };
  const { booking, cancel } = view;

  if (cancel.route === "closed") return { kind: "closed" };
  if (cancel.route === "host" || !cancel.outcome) {
    return { kind: "needs_host" };
  }
  const refundCents = cancel.outcome.refundCents;
  if (refundCents !== expectedRefundCents) return { kind: "moved" };
  if (!(await settleBalanceSessions(deps, booking.id))) {
    return { kind: "moved" };
  }

  const cancelled = await rpc<{ outcome: string }>(deps, "cancel_booking", {
    p_booking_id: booking.id,
    p_reason: "Cancelled by the guest from their booking page",
    p_actor: null,
  });
  // A second tap landed first, and the refund belongs to that request.
  if (cancelled.outcome !== "cancelled") return { kind: "closed" };

  let refundDelayed = false;
  if (refundCents > 0) {
    try {
      const { payments, refunds } = await loadBookingMoney(deps, booking.id);
      const { shares, shortCents } = planCardRefund(
        refundCents,
        payments,
        refunds,
      );
      const run = await refundShares(deps, booking.id, shares, {
        reason: "Guest cancelled within the free period",
      });
      refundDelayed =
        shortCents > 0 || run.failedCents > 0 || run.unknownCents > 0;
    } catch (error) {
      console.error(`guest refund on ${booking.id}: ${String(error)}`);
      refundDelayed = true;
    }
    if (refundDelayed) {
      await alertHost(deps, {
        key: `guest_cancel_refund:${booking.id}`,
        bookingId: booking.id,
        amountCents: refundCents,
        reason:
          "URGENT: a guest cancelled and is owed this refund, but it did not go through automatically. Please refund it from Admin.",
      });
    }
  }

  await queue(deps, "booking_cancellation", {
    bookingId: booking.id,
    refundCents,
  });
  await queue(deps, "host_booking_cancelled", {
    bookingId: booking.id,
    refundCents,
  });
  return { kind: "cancelled", refundCents, refundDelayed };
}

/** Lands in Admin's messages with the booking, and in Yorgos's inbox. */
export async function messageHost(
  deps: PaymentDeps,
  token: string,
  message: string,
  isCancelRequest: boolean,
): Promise<boolean> {
  const booking = await bookingForToken(deps, token);
  if (!booking) return false;

  const text = isCancelRequest ? `Cancellation request: ${message}` : message;
  const { error } = await deps.db.from("contact_messages").insert({
    name: booking.guest_name ?? "Guest",
    email: booking.guest_email ?? "",
    message: text,
    locale: booking.locale,
    booking_id: booking.id,
  });
  if (error) throw new Error(error.message);
  await queue(deps, "host_guest_message", {
    bookingId: booking.id,
    message: text,
  });
  return true;
}
