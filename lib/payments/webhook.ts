import type Stripe from "stripe";
import type { ConfirmOutcome } from "@/lib/domain/contracts";
import { alertHost, apologiseForLostDates } from "./alerts";
import { removeBalanceSession } from "./balance";
import { releaseHold } from "./checkout";
import { dbCode, queue, requireStripe, rpc, type PaymentDeps } from "./deps";
import {
  refundWholePayment,
  syncChargeRefunds,
  syncStripeRefund,
} from "./refunds";

// The only code that can confirm a booking (BKG-12).
//
// stripe_events is written first and finished last. An event whose row has
// processed_at is done. An event with a row but no processed_at was interrupted,
// and runs again when Stripe retries, which it does because the first attempt
// did not answer 200. So every handler below is safe to run twice, and safe to
// run at the same moment as itself: the database functions lock the booking,
// and emails and refunds carry keys that cannot repeat.

export interface WebhookResponse {
  status: number;
  body: Record<string, unknown>;
}

const LIVE = ["confirmed", "checked_in", "completed"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids only. Names, emails and addresses never reach this table. */
function eventSummary(event: Stripe.Event) {
  const object = event.data.object as unknown as {
    id?: unknown;
    object?: unknown;
    metadata?: { booking_id?: unknown } | null;
  };
  return {
    object_id: typeof object.id === "string" ? object.id : null,
    object_type: typeof object.object === "string" ? object.object : null,
    booking_id:
      typeof object.metadata?.booking_id === "string"
        ? object.metadata.booking_id
        : null,
    created: event.created,
    livemode: event.livemode,
  };
}

type Claim = "new" | "unfinished" | "finished";

async function claimEvent(
  deps: PaymentDeps,
  event: Stripe.Event,
): Promise<Claim> {
  const { data, error } = await deps.db
    .from("stripe_events")
    .upsert(
      { id: event.id, type: event.type, payload: eventSummary(event) },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (error) throw new Error(error.message);
  if (data.length > 0) return "new";

  const { data: row, error: readError } = await deps.db
    .from("stripe_events")
    .select("processed_at")
    .eq("id", event.id)
    .single();
  if (readError) throw new Error(readError.message);
  return row.processed_at ? "finished" : "unfinished";
}

async function finishEvent(
  deps: PaymentDeps,
  id: string,
  problem: string | null,
): Promise<void> {
  const { error } = await deps.db
    .from("stripe_events")
    .update(
      problem === null
        ? { processed_at: new Date().toISOString(), error: null }
        : { error: problem.slice(0, 300) },
    )
    .eq("id", id);
  if (error) throw new Error(error.message);
}

const idOf = (value: string | { id: string } | null) =>
  typeof value === "string" ? value : (value?.id ?? null);

async function paymentByIntent(deps: PaymentDeps, intent: string) {
  const { data, error } = await deps.db
    .from("payments")
    .select("id, booking_id, amount_cents, status")
    .eq("stripe_payment_intent_id", intent)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function loadBooking(deps: PaymentDeps, id: string) {
  const { data, error } = await deps.db
    .from("bookings")
    .select("id, status, total_cents, reference")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function receivedCents(deps: PaymentDeps, bookingId: string) {
  const { data, error } = await deps.db
    .from("payments")
    .select("amount_cents")
    .eq("booking_id", bookingId)
    .in("status", ["succeeded", "disputed"]);
  if (error) throw new Error(error.message);
  return data.reduce((total, row) => total + row.amount_cents, 0);
}

/**
 * More came in than the booking costs. Checked on every outcome, so a crash
 * right after the payment was stored still alerts on the replay. Never refunded
 * by itself: a person has to see why two payments exist.
 */
async function alertIfOverpaid(
  deps: PaymentDeps,
  bookingId: string,
  intent: string,
): Promise<void> {
  const booking = await loadBooking(deps, bookingId);
  if (!booking) return;
  const received = await receivedCents(deps, bookingId);
  if (received <= booking.total_cents) return;
  await alertHost(deps, {
    key: `overpaid:${intent}`,
    bookingId,
    amountCents: received - booking.total_cents,
    reason:
      "This booking has received more than its price, usually a second payment. Nothing was refunded automatically. Check the booking in Admin and refund it there if it should go back.",
  });
}

async function sendConfirmation(
  deps: PaymentDeps,
  bookingId: string,
  paymentId: string | null,
): Promise<void> {
  // A replay after a cancellation must not tell the guest they are confirmed.
  const booking = await loadBooking(deps, bookingId);
  if (!booking || !LIVE.includes(booking.status)) return;
  await queue(deps, "booking_confirmation", { bookingId });
  if (paymentId) {
    await queue(deps, "payment_receipt", { bookingId, paymentId });
  }
  await queue(deps, "host_new_booking", { bookingId });
}

/**
 * T4.7. The guest paid for dates that are gone, so the money goes straight back
 * and both people hear about it. If the refund fails this throws, and the retry
 * tries again on a new reservation.
 */
async function handleLostDates(
  deps: PaymentDeps,
  bookingId: string,
  intent: string,
): Promise<void> {
  const payment = await paymentByIntent(deps, intent);
  if (!payment) throw new Error("payment_not_found");

  await alertHost(deps, {
    key: `dates_lost:${intent}`,
    bookingId,
    amountCents: payment.amount_cents,
    reason:
      "URGENT: a guest paid, but the dates had already gone, so no booking was made. Their money is being refunded automatically and they have been told. Please contact them.",
  });

  const { refundedCents, result } = await refundWholePayment(deps, payment);
  if (result === "failed" || result === "unknown") {
    await alertHost(deps, {
      key: `dates_lost_refund:${intent}`,
      bookingId,
      amountCents: payment.amount_cents,
      reason:
        "URGENT: the automatic refund for a lost booking has not gone through. It will be retried, but please check Stripe and refund the guest there if it stays open.",
    });
    throw new Error("refund_not_sent");
  }
  await apologiseForLostDates(deps, bookingId, refundedCents);
}

async function onBookingPaid(
  deps: PaymentDeps,
  session: Stripe.Checkout.Session,
  bookingId: string,
  intent: string,
  amountCents: number,
): Promise<void> {
  const paymentKind =
    session.metadata?.payment_kind === "deposit" ? "deposit" : "full";

  let result: ConfirmOutcome;
  try {
    result = await rpc<ConfirmOutcome>(deps, "confirm_booking", {
      p_booking_id: bookingId,
      p_kind: paymentKind,
      p_amount_cents: amountCents,
      p_payment_intent_id: intent,
      p_checkout_session_id: session.id,
    });
  } catch (error) {
    if (dbCode(error) !== "booking_not_found") throw error;
    await alertHost(deps, {
      key: `no_booking:${intent}`,
      amountCents,
      reason: `URGENT: Stripe took a payment (${intent}) for a booking that does not exist here. Please check Stripe.`,
    });
    return;
  }

  switch (result.outcome) {
    case "confirmed":
    case "already_confirmed": {
      const payment = await paymentByIntent(deps, intent);
      await sendConfirmation(deps, bookingId, payment?.id ?? null);
      await alertIfOverpaid(deps, bookingId, intent);
      return;
    }
    case "extra_payment":
      await alertIfOverpaid(deps, bookingId, intent);
      await alertHost(deps, {
        key: `extra_payment:${intent}`,
        bookingId,
        amountCents,
        reason:
          "A second payment arrived on a confirmed booking. Nothing was refunded automatically. Check the booking in Admin and refund it there if it should go back.",
      });
      return;
    case "amount_mismatch":
      await alertHost(deps, {
        key: `amount_mismatch:${intent}`,
        bookingId,
        amountCents,
        reason:
          "URGENT: a payment arrived for a different amount than this checkout expected, so the booking was NOT confirmed. The money is held and nothing was refunded automatically. Check Stripe, then confirm with the guest or refund them from Admin.",
      });
      return;
    case "dates_lost":
      await handleLostDates(deps, bookingId, intent);
  }
}

async function onBalancePaid(
  deps: PaymentDeps,
  session: Stripe.Checkout.Session,
  bookingId: string,
  intent: string,
  amountCents: number,
): Promise<void> {
  const paymentId = await rpc<string>(deps, "record_payment", {
    p_booking_id: bookingId,
    p_kind: "balance",
    p_method: "card",
    p_amount_cents: amountCents,
    p_payment_intent_id: intent,
    p_note: null,
    p_recorded_by: null,
  });
  await removeBalanceSession(deps, session.id);

  const booking = await loadBooking(deps, bookingId);
  if (!booking) return;
  await queue(deps, "payment_receipt", { bookingId, paymentId });
  if (!LIVE.includes(booking.status)) {
    await alertHost(deps, {
      key: `balance_on_closed:${intent}`,
      bookingId,
      amountCents,
      reason:
        "A balance payment arrived on a booking that is no longer live. Nothing was refunded automatically. Please refund it from Admin.",
    });
  }
  await alertIfOverpaid(deps, bookingId, intent);
}

function sessionBooking(session: Stripe.Checkout.Session): string | null {
  const id = session.metadata?.booking_id;
  return id && UUID.test(id) ? id : null;
}

/** Also what reconciliation runs, so there is one way to confirm. */
export async function applyPaidSession(
  deps: PaymentDeps,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = sessionBooking(session);
  if (!bookingId) return;
  // A delayed method completes unpaid, then reports on its own event.
  if (session.payment_status !== "paid") return;

  const intent = idOf(session.payment_intent);
  const amount = session.amount_total;
  if (!intent || amount === null) throw new Error("session_without_payment");

  if (session.currency?.toLowerCase() !== "eur") {
    await alertHost(deps, {
      key: `wrong_currency:${intent}`,
      bookingId,
      reason: `URGENT: a payment arrived in ${session.currency} instead of euros (${intent}). The booking was NOT confirmed. Please check Stripe.`,
    });
    return;
  }

  if (session.metadata?.kind === "balance") {
    await onBalancePaid(deps, session, bookingId, intent, amount);
  } else {
    await onBookingPaid(deps, session, bookingId, intent, amount);
  }
}

/** Only a hold can be freed. A paid booking has none, so this does nothing. */
async function onSessionEnded(
  deps: PaymentDeps,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = sessionBooking(session);
  if (!bookingId) return;
  if (session.metadata?.kind === "balance") {
    await removeBalanceSession(deps, session.id);
    return;
  }
  await releaseHold(deps, bookingId);
}

async function onAsyncFailed(
  deps: PaymentDeps,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const bookingId = sessionBooking(session);
  if (!bookingId) return;
  await onSessionEnded(deps, session);
  await alertHost(deps, {
    key: `async_failed:${session.id}`,
    bookingId,
    amountCents: session.amount_total ?? undefined,
    reason: "A delayed bank payment failed, so the payment was not received.",
  });
}

const DISPUTE_NOTE =
  "The payment shows as disputed in Admin. Reply in the Stripe dashboard before its deadline.";

type DisputeResult = { outcome: string; booking_id?: string };

async function onDisputeOpened(
  deps: PaymentDeps,
  dispute: Stripe.Dispute,
): Promise<void> {
  const intent = idOf(dispute.payment_intent);
  const opened = intent
    ? await rpc<DisputeResult>(deps, "open_dispute", {
        p_payment_intent_id: intent,
      })
    : null;
  await queue(
    deps,
    "host_dispute_opened",
    {
      bookingId: opened?.booking_id,
      amountCents: dispute.amount,
      reason: `${dispute.reason}. ${DISPUTE_NOTE}`,
    },
    { dedupeKey: `dispute_opened:${dispute.id}` },
  );
}

async function onDisputeClosed(
  deps: PaymentDeps,
  dispute: Stripe.Dispute,
): Promise<void> {
  const intent = idOf(dispute.payment_intent);
  // Only `lost` takes the money. `warning_closed` was an inquiry that ended.
  const closed = intent
    ? await rpc<DisputeResult>(deps, "close_dispute", {
        p_payment_intent_id: intent,
        p_dispute_id: dispute.id,
        p_won: dispute.status !== "lost",
        p_amount_cents: dispute.amount,
      })
    : null;
  await alertHost(deps, {
    key: `dispute_closed:${dispute.id}`,
    bookingId: closed?.booking_id,
    amountCents: dispute.amount,
    reason: `A card dispute closed with the result: ${dispute.status}. Check it in Stripe.`,
  });
}

async function dispatch(deps: PaymentDeps, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      return applyPaidSession(deps, event.data.object);
    case "checkout.session.async_payment_failed":
      return onAsyncFailed(deps, event.data.object);
    case "checkout.session.expired":
      return onSessionEnded(deps, event.data.object);
    case "payment_intent.payment_failed":
      // A declined card. The guest is still on Stripe's page and can try
      // another. If they give up, the Session expires and the hold goes then.
      return;
    case "charge.refunded":
      return syncChargeRefunds(deps, event.data.object);
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      return syncStripeRefund(deps, event.data.object);
    case "charge.dispute.created":
      return onDisputeOpened(deps, event.data.object);
    case "charge.dispute.closed":
      return onDisputeClosed(deps, event.data.object);
    default:
      return;
  }
}

export async function handleStripeWebhook(
  deps: PaymentDeps,
  rawBody: string,
  signature: string | null,
): Promise<WebhookResponse> {
  if (!deps.stripe || !deps.webhookSecret) {
    // Answering an error keeps the event at Stripe for a later try.
    return { status: 503, body: { error: "not_configured" } };
  }
  if (!signature) return { status: 400, body: { error: "invalid_signature" } };

  let event: Stripe.Event;
  try {
    event = requireStripe(deps).webhooks.constructEvent(
      rawBody,
      signature,
      deps.webhookSecret,
    );
  } catch {
    return { status: 400, body: { error: "invalid_signature" } };
  }

  try {
    const claim = await claimEvent(deps, event);
    if (claim === "finished") {
      return { status: 200, body: { received: true, duplicate: true } };
    }
  } catch (error) {
    console.error(`stripe event ${event.id}: ${dbCode(error)}`);
    return { status: 500, body: { error: "not_stored" } };
  }

  try {
    await dispatch({ ...deps, strictEmail: true }, event);
    await finishEvent(deps, event.id, null);
    return { status: 200, body: { received: true } };
  } catch (error) {
    const code = dbCode(error);
    console.error(`stripe event ${event.id} (${event.type}): ${code}`);
    await finishEvent(deps, event.id, code).catch(() => {});
    return { status: 500, body: { error: "not_processed" } };
  }
}
