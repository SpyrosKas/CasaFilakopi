import type { Locale } from "@/lib/domain/contracts";
import { balanceOf, summariseMoney } from "@/lib/admin/stays";
import { sessionParams } from "./checkout";
import { dbCode, requireStripe, type PaymentDeps } from "./deps";
import { balanceSlot, MIN_CHARGE_CENTS } from "./policy";

// Paying what is left on a confirmed booking (T4.10). Every entry point, guest
// page or Admin's link, ends up here, so the amount is always worked out now,
// on the server.
//
// While a Session is open it has a `pending` row in payments. That row is what
// stops two open Sessions existing for one balance: the next try reuses the
// open one, or closes it if the amount has changed. Pending rows count as no
// money anywhere. When the balance is paid, record_payment writes the real row
// and this one goes.

export type BalanceResult =
  | { kind: "redirect"; url: string }
  | { kind: "nothing_due" }
  /** Paid a moment ago, and the webhook has not landed. */
  | { kind: "processing" }
  | { kind: "unavailable" };

const PAYABLE = ["confirmed", "checked_in"];

export async function loadBookingMoney(deps: PaymentDeps, bookingId: string) {
  const [payments, refunds] = await Promise.all([
    deps.db
      .from("payments")
      .select(
        "id, booking_id, kind, method, status, amount_cents, created_at, stripe_payment_intent_id, stripe_checkout_session_id",
      )
      .eq("booking_id", bookingId),
    deps.db
      .from("refunds")
      .select("id, booking_id, payment_id, amount_cents, status")
      .eq("booking_id", bookingId),
  ]);
  if (payments.error) throw new Error(payments.error.message);
  if (refunds.error) throw new Error(refunds.error.message);
  return { payments: payments.data, refunds: refunds.data };
}

/** Called when a Session has paid, expired or been replaced. */
export async function removeBalanceSession(
  deps: PaymentDeps,
  sessionId: string,
): Promise<void> {
  const { error } = await deps.db
    .from("payments")
    .delete()
    .eq("stripe_checkout_session_id", sessionId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
}

const openRows = async (deps: PaymentDeps, bookingId: string) => {
  const { payments } = await loadBookingMoney(deps, bookingId);
  return payments.flatMap((row) =>
    row.status === "pending" && row.stripe_checkout_session_id
      ? [row.stripe_checkout_session_id]
      : [],
  );
};

/**
 * The amount owed has changed, so an open page would ask for the wrong sum, or
 * for money nobody owes. Best effort: a payment that still gets through is
 * recorded, and alertIfOverpaid tells the host.
 */
export async function closeBalanceSessions(
  deps: PaymentDeps,
  bookingId: string,
): Promise<void> {
  if (!deps.stripe) return;
  try {
    for (const sessionId of await openRows(deps, bookingId)) {
      await deps.stripe.checkout.sessions.expire(sessionId);
      await removeBalanceSession(deps, sessionId);
    }
  } catch (error) {
    // Expired already, or paid: the webhook deals with both.
    console.warn(`balance session on ${bookingId}: ${dbCode(error)}`);
  }
}

/**
 * Before a cancellation works out a refund. False means a balance has been paid
 * and its webhook has not landed, so the sum on screen is wrong: the caller
 * stops. Open pages are closed here, so nobody can pay during the cancellation.
 */
export async function settleBalanceSessions(
  deps: PaymentDeps,
  bookingId: string,
): Promise<boolean> {
  if (!deps.stripe) return true;
  const stripe = deps.stripe;
  for (const sessionId of await openRows(deps, bookingId)) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "complete") return false;
    if (session.status === "open") {
      try {
        await stripe.checkout.sessions.expire(sessionId);
      } catch (error) {
        const latest = await stripe.checkout.sessions.retrieve(sessionId);
        if (latest.status === "complete") return false;
        if (latest.status !== "expired") throw error;
      }
    }
    await removeBalanceSession(deps, sessionId);
  }
  return true;
}

async function reuseOpenSession(
  deps: PaymentDeps,
  sessions: { sessionId: string; intentRecorded: (id: string) => boolean }[],
  balanceCents: number,
): Promise<BalanceResult | null> {
  const stripe = requireStripe(deps);
  for (const { sessionId, intentRecorded } of sessions) {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === "open") {
      if (session.amount_total === balanceCents && session.url) {
        return { kind: "redirect", url: session.url };
      }
      await stripe.checkout.sessions.expire(sessionId);
      await removeBalanceSession(deps, sessionId);
    } else if (session.status === "complete") {
      const intent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id;
      if (!intent || !intentRecorded(intent)) return { kind: "processing" };
      await removeBalanceSession(deps, sessionId);
    } else {
      await removeBalanceSession(deps, sessionId);
    }
  }
  return null;
}

const UNIQUE_VIOLATION = "23505";

async function joinOpenSession(
  deps: PaymentDeps,
  bookingId: string,
  mine: string,
  myUrl: string | null,
): Promise<BalanceResult> {
  const stripe = requireStripe(deps);
  const [winner] = await openRows(deps, bookingId);
  if (winner === mine) {
    return myUrl ? { kind: "redirect", url: myUrl } : { kind: "unavailable" };
  }
  await stripe.checkout.sessions.expire(mine).catch(() => {});
  if (!winner) return { kind: "processing" };
  const session = await stripe.checkout.sessions.retrieve(winner);
  return session.status === "open" && session.url
    ? { kind: "redirect", url: session.url }
    : { kind: "processing" };
}

export async function startBalancePayment(
  deps: PaymentDeps,
  bookingId: string,
  locale: Locale,
): Promise<BalanceResult> {
  const stripe = requireStripe(deps);
  const { data: booking, error } = await deps.db
    .from("bookings")
    .select("id, status, total_cents, guest_email, check_in, check_out")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking || !PAYABLE.includes(booking.status)) {
    return { kind: "nothing_due" };
  }

  const { payments, refunds } = await loadBookingMoney(deps, bookingId);
  const balanceCents = balanceOf(
    summariseMoney(payments, refunds),
    booking.total_cents,
  );

  const recorded = new Set(
    payments.flatMap((row) =>
      row.status !== "pending" && row.stripe_payment_intent_id
        ? [row.stripe_payment_intent_id]
        : [],
    ),
  );
  const open = payments.flatMap((row) =>
    row.status === "pending" && row.stripe_checkout_session_id
      ? [
          {
            sessionId: row.stripe_checkout_session_id,
            intentRecorded: (id: string) => recorded.has(id),
          },
        ]
      : [],
  );
  const reused = await reuseOpenSession(deps, open, balanceCents);
  if (reused) {
    if (balanceCents <= 0) return { kind: "nothing_due" };
    return reused;
  }

  if (balanceCents <= 0) return { kind: "nothing_due" };
  if (balanceCents < MIN_CHARGE_CENTS || !booking.guest_email) {
    return { kind: "unavailable" };
  }

  const { slot, expiresAt } = balanceSlot(deps.now());
  const session = await stripe.checkout.sessions.create(
    sessionParams({
      deps,
      bookingId,
      kind: "balance",
      paymentKind: "balance",
      amountCents: balanceCents,
      locale,
      email: booking.guest_email,
      checkIn: booking.check_in,
      checkOut: booking.check_out,
      expiresAt,
      cancelPath: `/${locale}/book/cancelled`,
    }),
    {
      idempotencyKey: `balance:${bookingId}:${balanceCents}:${locale}:${slot}`,
    },
  );

  // One booking has one pending row, by a unique index. Whoever loses that race
  // uses the winner's Session, so two tabs can never hold two open payments.
  const { error: insertError } = await deps.db.from("payments").insert({
    booking_id: bookingId,
    kind: "balance",
    method: "card",
    status: "pending",
    amount_cents: balanceCents,
    stripe_checkout_session_id: session.id,
  });
  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      return joinOpenSession(deps, bookingId, session.id, session.url);
    }
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    throw new Error(insertError.message);
  }
  if (!session.url) return { kind: "unavailable" };
  return { kind: "redirect", url: session.url };
}
