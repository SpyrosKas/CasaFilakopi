import type Stripe from "stripe";
import { alertHost } from "./alerts";
import { dbCode, requireStripe, rpc, type PaymentDeps } from "./deps";
import type { CardRefundShare } from "./policy";

// Card refunds: reserve_refund, then Stripe, then settle_refund. The cap is
// enforced before any money moves, and the reservation carries the idempotency
// key, so whoever retries a reservation can only ever make the same refund.

export type RefundResult = "succeeded" | "pending" | "failed" | "unknown";

export const DATES_LOST_REASON = "Dates lost: automatic full refund";

interface ReservedRefund {
  id: string;
  booking_id: string;
  payment_id: string;
  amount_cents: number;
  created_at?: string;
}

const refundKey = (refundId: string) => `refund:${refundId}`;

/**
 * Stripe said no, so no money moved. A timeout or a 5xx proves nothing: the
 * refund may have gone through, so the reservation must stay in place.
 * Stripe answers 409 while the same key is in flight.
 */
function stripeRefused(error: unknown): boolean {
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 409 &&
    status !== 429
  );
}

async function intentFor(
  deps: PaymentDeps,
  paymentId: string,
): Promise<string> {
  const { data, error } = await deps.db
    .from("payments")
    .select("stripe_payment_intent_id")
    .eq("id", paymentId)
    .single();
  if (error) throw new Error(error.message);
  if (!data.stripe_payment_intent_id) throw new Error("payment_not_card");
  return data.stripe_payment_intent_id;
}

/** Applies what Stripe says about a refund to our row. Safe to repeat. */
async function applyStatus(
  deps: PaymentDeps,
  refundId: string,
  refund: Pick<Stripe.Refund, "id" | "status">,
): Promise<RefundResult> {
  if (refund.status === "succeeded") {
    await rpc(deps, "settle_refund", {
      p_refund_id: refundId,
      p_status: "succeeded",
      p_stripe_refund_id: refund.id,
    });
    return "succeeded";
  }
  if (refund.status === "failed" || refund.status === "canceled") {
    await rpc(deps, "settle_refund", {
      p_refund_id: refundId,
      p_status: "failed",
      p_stripe_refund_id: refund.id,
    });
    return "failed";
  }
  // pending or requires_action: the row keeps counting against the cap until
  // refund.updated settles it.
  const { error } = await deps.db
    .from("refunds")
    .update({ stripe_refund_id: refund.id })
    .eq("id", refundId);
  if (error) throw new Error(error.message);
  return "pending";
}

/** Sends a reserved refund to Stripe. Repeating it repeats the same refund. */
export async function sendReservedRefund(
  deps: PaymentDeps,
  row: ReservedRefund,
): Promise<RefundResult> {
  const stripe = requireStripe(deps);
  const paymentIntent = await intentFor(deps, row.payment_id);

  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: paymentIntent,
        amount: row.amount_cents,
        reason: "requested_by_customer",
        metadata: { refund_row_id: row.id, booking_id: row.booking_id },
      },
      { idempotencyKey: refundKey(row.id) },
    );
    return await applyStatus(deps, row.id, refund);
  } catch (error) {
    if (!stripeRefused(error)) {
      console.error(`refund ${row.id}: outcome unknown: ${dbCode(error)}`);
      return "unknown";
    }
    console.error(`refund ${row.id}: refused: ${dbCode(error)}`);
    await rpc(deps, "settle_refund", {
      p_refund_id: row.id,
      p_status: "failed",
    });
    return "failed";
  }
}

export interface RefundRequest {
  bookingId: string;
  paymentId: string;
  amountCents: number;
  reason?: string;
  actorId?: string;
}

export async function refundCardPayment(
  deps: PaymentDeps,
  request: RefundRequest,
): Promise<{ id: string; result: RefundResult }> {
  requireStripe(deps);
  const id = await rpc<string>(deps, "reserve_refund", {
    p_booking_id: request.bookingId,
    p_payment_id: request.paymentId,
    p_amount_cents: request.amountCents,
    p_reason: request.reason ?? null,
    p_actor: request.actorId ?? null,
  });
  const result = await sendReservedRefund(deps, {
    id,
    booking_id: request.bookingId,
    payment_id: request.paymentId,
    amount_cents: request.amountCents,
  });
  return { id, result };
}

export interface RefundRun {
  /** Accepted by Stripe, whether or not it has finished. */
  sentCents: number;
  /** Not refunded. The caller must say so. */
  failedCents: number;
  /** Stripe gave no clear answer. The cron job finds out. */
  unknownCents: number;
  /** Rows Stripe has accepted, for the guest's refund email. */
  refundIds: string[];
}

/** Refunds several payments in turn. Stops at the first one Stripe refuses. */
export async function refundShares(
  deps: PaymentDeps,
  bookingId: string,
  shares: CardRefundShare[],
  options: { reason?: string; actorId?: string } = {},
): Promise<RefundRun> {
  const run: RefundRun = {
    sentCents: 0,
    failedCents: 0,
    unknownCents: 0,
    refundIds: [],
  };
  for (const [index, share] of shares.entries()) {
    const { id, result } = await refundCardPayment(deps, {
      bookingId,
      ...share,
      ...options,
    });
    if (result === "failed") {
      run.failedCents += shares
        .slice(index)
        .reduce((total, rest) => total + rest.amountCents, 0);
      break;
    }
    if (result === "unknown") {
      run.unknownCents += share.amountCents;
    } else {
      run.sentCents += share.amountCents;
      run.refundIds.push(id);
    }
  }
  return run;
}

async function loadPaymentRefunds(deps: PaymentDeps, paymentId: string) {
  const { data, error } = await deps.db
    .from("refunds")
    .select("id, booking_id, payment_id, amount_cents, status, reason")
    .eq("payment_id", paymentId);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Gives back all of a payment whose dates were lost. A crash or a second
 * delivery resumes the same reservation, and a payment already refunded in full
 * is left alone. Returns what has gone back, or throws so Stripe retries.
 */
export async function refundWholePayment(
  deps: PaymentDeps,
  payment: { id: string; booking_id: string; amount_cents: number },
): Promise<{ refundedCents: number; result: RefundResult }> {
  for (let attempt = 0; ; attempt += 1) {
    const rows = await loadPaymentRefunds(deps, payment.id);
    const open = rows.find(
      (row) => row.status === "pending" && row.reason === DATES_LOST_REASON,
    );
    if (open) {
      return {
        refundedCents: open.amount_cents,
        result: await sendReservedRefund(deps, open),
      };
    }

    const taken = rows
      .filter((row) => row.status !== "failed")
      .reduce((total, row) => total + row.amount_cents, 0);
    const left = payment.amount_cents - taken;
    if (left <= 0) return { refundedCents: taken, result: "succeeded" };

    try {
      const { result } = await refundCardPayment(deps, {
        bookingId: payment.booking_id,
        paymentId: payment.id,
        amountCents: left,
        reason: DATES_LOST_REASON,
      });
      return { refundedCents: left, result };
    } catch (error) {
      // A second delivery reserved first. Its row is read on the next pass.
      if (dbCode(error) !== "refund_exceeds_payment" || attempt > 1) {
        throw error;
      }
    }
  }
}

async function findRow(deps: PaymentDeps, refund: Stripe.Refund) {
  const rowId = refund.metadata?.refund_row_id;
  const query = deps.db.from("refunds").select("id, booking_id, status");
  const { data, error } = await (
    rowId ? query.eq("id", rowId) : query.eq("stripe_refund_id", refund.id)
  ).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const intentId = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : (value?.id ?? null);

/**
 * Brings our records in line with one refund at Stripe, from any event, in any
 * order. A refund made in the Stripe dashboard has no row yet and gets one here.
 */
export async function syncStripeRefund(
  deps: PaymentDeps,
  refund: Stripe.Refund,
): Promise<void> {
  const row = await findRow(deps, refund);
  if (row) {
    const wasCounted = row.status === "succeeded";
    const result = await applyStatus(deps, row.id, refund);
    if (result === "failed" && wasCounted) {
      await alertHost(deps, {
        key: `refund_failed:${refund.id}`,
        bookingId: row.booking_id,
        reason: `Stripe reports that a refund failed after it had gone out (${refund.id}). The money stays on your Stripe balance. Please check it in Stripe.`,
        amountCents: refund.amount,
      });
    }
    return;
  }

  // Money that never left needs no record.
  if (refund.status !== "succeeded") return;

  const paymentIntent = intentId(refund.payment_intent);
  if (!paymentIntent) return;
  const { data: payment, error } = await deps.db
    .from("payments")
    .select("id, booking_id")
    .eq("stripe_payment_intent_id", paymentIntent)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!payment) {
    // Ours, but its payment event has not landed: fail so Stripe retries this
    // one later. A payment that is not ours is simply none of our business.
    const intent =
      await requireStripe(deps).paymentIntents.retrieve(paymentIntent);
    if (intent.metadata?.booking_id) throw new Error("payment_not_seen_yet");
    return;
  }

  await rpc(deps, "record_refund", {
    p_booking_id: payment.booking_id,
    p_payment_id: payment.id,
    p_amount_cents: refund.amount,
    p_stripe_refund_id: refund.id,
    p_reason: "Refund made in Stripe",
  });
}

/** charge.refunded does not list its refunds, so they are asked for. */
export async function syncChargeRefunds(
  deps: PaymentDeps,
  charge: Stripe.Charge,
): Promise<void> {
  const paymentIntent = intentId(charge.payment_intent);
  if (!paymentIntent) return;
  const refunds = requireStripe(deps).refunds.list({
    payment_intent: paymentIntent,
    limit: 100,
  });
  for await (const refund of refunds) await syncStripeRefund(deps, refund);
}

const STALE_MS = 10 * 60_000;

/**
 * Reservations left behind by a crash or an unclear answer. Each was a decided
 * refund, so it is completed. Stripe's list is checked first, because an
 * idempotency key only lasts 24 hours and this may run later than that.
 */
export async function resumeStaleRefunds(
  deps: PaymentDeps,
): Promise<{ checked: number; failed: number }> {
  const stripe = requireStripe(deps);
  const { data, error } = await deps.db
    .from("refunds")
    .select(
      "id, booking_id, payment_id, amount_cents, stripe_refund_id, created_at",
    )
    .eq("status", "pending")
    .lt("created_at", new Date(deps.now().getTime() - STALE_MS).toISOString())
    .limit(50);
  if (error) throw new Error(error.message);

  let failed = 0;
  for (const row of data) {
    try {
      const paymentIntent = await intentFor(deps, row.payment_id);
      let found: Stripe.Refund | undefined;
      for await (const refund of stripe.refunds.list({
        payment_intent: paymentIntent,
        limit: 100,
      })) {
        if (
          refund.id === row.stripe_refund_id ||
          refund.metadata?.refund_row_id === row.id
        ) {
          found = refund;
          break;
        }
      }
      const result = found
        ? await applyStatus(deps, row.id, found)
        : await sendReservedRefund(deps, row);
      if (result === "failed" || result === "unknown") failed += 1;
    } catch (rowError) {
      failed += 1;
      console.error(`stale refund ${row.id}: ${dbCode(rowError)}`);
    }
  }
  return { checked: data.length, failed };
}
