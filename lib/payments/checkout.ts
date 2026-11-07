import { createHmac, timingSafeEqual } from "node:crypto";
import type Stripe from "stripe";
import type { CheckoutRejection, Locale } from "@/lib/domain/contracts";
import { prepareCheckout, type CheckoutGuest } from "@/lib/domain/services";
import { formatDate } from "@/lib/email/format";
import {
  deriveGuestToken,
  guestBookingPath,
  issueGuestToken,
} from "@/lib/email/guest-link";
import { dbCode, queue, requireStripe, rpc, type PaymentDeps } from "./deps";
import { MIN_CHARGE_CENTS, sessionExpiresAt } from "./policy";
import { loadHouse } from "./room";
import type { CheckoutRequest } from "./schemas";
import { TERMS_VERSION } from "./versions";

// The way into a booking. Order matters and every step can fail:
//
//   previous attempt ended -> prepareCheckout -> create_hold -> guest token
//   -> Stripe Session -> attach_checkout_session
//
// A failure after the hold gives the dates back at once. The guest's browser
// keeps the token of its latest attempt in a cookie, so going back and paying
// again first closes the old Session, and only then frees its hold. Closing it
// first is what makes paying twice impossible: Stripe refuses to close a Session
// that was paid, and then the guest is sent to their booking instead.

export type CheckoutResult =
  | { kind: "redirect"; url: string; token: string }
  /** Nothing is due now, or a previous attempt turns out to be paid. */
  | { kind: "done"; path: string; token: string }
  | {
      kind: "rejected";
      reason: CheckoutRejection | "payment_unavailable";
    };

export const CHECKOUT_COOKIE = "cf_checkout";
export const CHECKOUT_COOKIE_PATH = "/api/checkout";
export const CHECKOUT_COOKIE_SECONDS = 60 * 60;

/** What a Session's metadata carries, so a webhook needs no other lookup. */
export type SessionKind = "booking" | "balance";

const CAN_RETRY = ["pending_payment"];

function secretOf(deps: PaymentDeps): string {
  if (!deps.guestTokenSecret) throw new Error("GUEST_TOKEN_SECRET is not set");
  return deps.guestTokenSecret;
}

/** The cancel link holds this rather than a guest token, as Stripe sees it. */
export function releaseKey(secret: string, bookingId: string): string {
  const mac = createHmac("sha256", secret)
    .update(`checkout-release-v1:${bookingId}`)
    .digest("base64url");
  return `${bookingId}.${mac}`;
}

export function bookingFromReleaseKey(
  secret: string,
  key: string,
): string | null {
  const bookingId = key.split(".")[0];
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) return null;
  const expected = Buffer.from(releaseKey(secret, bookingId));
  const given = Buffer.from(key);
  return expected.length === given.length && timingSafeEqual(expected, given)
    ? bookingId
    : null;
}

/**
 * Gives a checkout's dates back now, as the booking `expired`, through the same
 * database path as a hold running out, so its promo use returns too. Only a
 * booking still waiting for payment is touched. If a webhook holds the booking
 * row at this moment, the function skips it and the payment wins.
 */
export async function releaseHold(
  deps: PaymentDeps,
  bookingId: string,
): Promise<boolean> {
  const { data: booking, error } = await deps.db
    .from("bookings")
    .select("room_id, check_in, check_out, status")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking || !CAN_RETRY.includes(booking.status)) return false;

  // A minute back, so a clock that differs from the database's still counts.
  const { error: updateError } = await deps.db
    .from("holds")
    .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("booking_id", bookingId);
  if (updateError) throw new Error(updateError.message);

  await rpc(deps, "release_expired_holds", {
    p_room_id: booking.room_id,
    p_stay: `[${booking.check_in},${booking.check_out})`,
  });
  return true;
}

export type EndedAttempt =
  { state: "released" } | { state: "paid" } | { state: "none" };

/** Closes a Session. False means it could not be closed because it was paid. */
async function closeSession(
  stripe: Stripe,
  sessionId: string,
): Promise<boolean> {
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.status === "complete") return false;
  if (session.status === "expired") return true;
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return true;
  } catch (error) {
    // Paid in the moment between the two calls, or expired by Stripe.
    const latest = await stripe.checkout.sessions.retrieve(sessionId);
    if (latest.status === "complete") return false;
    if (latest.status === "expired") return true;
    throw error;
  }
}

/** Ends one unpaid checkout: Session first, then the dates. */
export async function endAttempt(
  deps: PaymentDeps,
  bookingId: string,
): Promise<EndedAttempt> {
  const { data: hold, error } = await deps.db
    .from("holds")
    .select("stripe_checkout_session_id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!hold) return { state: "none" };

  if (hold.stripe_checkout_session_id) {
    const closed = await closeSession(
      requireStripe(deps),
      hold.stripe_checkout_session_id,
    );
    if (!closed) return { state: "paid" };
  }
  return (await releaseHold(deps, bookingId))
    ? { state: "released" }
    : { state: "none" };
}

async function previousAttempt(deps: PaymentDeps, token: string) {
  const { data, error } = await deps.db.rpc("booking_for_token", {
    p_token: token,
  });
  if (error) throw new Error(error.message);
  return data as {
    id: string;
    status: string;
    check_in: string;
    check_out: string;
    locale: string;
  } | null;
}

/**
 * A guest coming back. If the earlier attempt was paid and it is the same stay,
 * they go to their booking instead of starting another.
 */
async function endPreviousAttempt(
  deps: PaymentDeps,
  token: string,
  input: CheckoutRequest,
): Promise<CheckoutResult | null> {
  const previous = await previousAttempt(deps, token);
  if (!previous) return null;
  const toBooking: CheckoutResult = {
    kind: "done",
    token,
    path: guestBookingPath(input.locale, token),
  };

  const sameStay =
    previous.check_in === input.checkIn &&
    previous.check_out === input.checkOut;
  if (previous.status === "pending_payment") {
    const ended = await endAttempt(deps, previous.id);
    return ended.state === "paid" ? toBooking : null;
  }
  return sameStay && previous.status === "confirmed" ? toBooking : null;
}

function guestFrom(input: CheckoutRequest): CheckoutGuest {
  return {
    name: input.name,
    email: input.email,
    locale: input.locale,
    phone: input.phone,
    country: input.country,
    arrival_time: input.arrivalTime,
    special_requests: input.specialRequests,
    marketing_consent: input.marketing,
  };
}

const rejected = (
  reason: CheckoutRejection | "payment_unavailable",
): CheckoutResult => ({ kind: "rejected", reason });

/** Used for the deposit or full payment. Prices come from the booking row. */
export function sessionParams(input: {
  deps: PaymentDeps;
  bookingId: string;
  kind: SessionKind;
  paymentKind: string;
  amountCents: number;
  locale: Locale;
  email: string;
  checkIn: string;
  checkOut: string;
  expiresAt: number;
  cancelPath: string;
}): Stripe.Checkout.SessionCreateParams {
  const { deps, bookingId, locale, checkIn, checkOut } = input;
  const metadata = {
    booking_id: bookingId,
    kind: input.kind,
    payment_kind: input.paymentKind,
  };
  const dates = `${formatDate(checkIn, locale)} – ${formatDate(checkOut, locale)}`;
  const label =
    input.kind === "balance"
      ? locale === "el"
        ? "Υπόλοιπο"
        : "Balance"
      : input.paymentKind === "deposit"
        ? locale === "el"
          ? "Προκαταβολή"
          : "Deposit"
        : locale === "el"
          ? "Κράτηση"
          : "Booking";

  return {
    mode: "payment",
    // Cards only, because a delayed method could end in a refund. Apple Pay and
    // Google Pay are card payments, so they stay available (PAY-01).
    allowed_payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: input.amountCents,
          product_data: { name: `Casa Filakopi: ${label}, ${dates}` },
        },
      },
    ],
    // The guest pays exactly the euros on the booking, in euros.
    adaptive_pricing: { enabled: false },
    client_reference_id: bookingId,
    customer_email: input.email,
    locale,
    expires_at: input.expiresAt,
    metadata,
    // Refund and dispute events only name the intent.
    payment_intent_data: { metadata },
    success_url: `${deps.siteUrl}/${locale}/book/return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${deps.siteUrl}${input.cancelPath}`,
  };
}

const cancelPath = (
  secret: string,
  bookingId: string,
  input: CheckoutRequest,
) => {
  const query = new URLSearchParams({
    key: releaseKey(secret, bookingId),
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: String(input.adults),
    children: String(input.children),
  });
  return `/${input.locale}/book/cancelled?${query}`;
};

async function confirmFree(
  deps: PaymentDeps,
  bookingId: string,
  token: string,
  locale: Locale,
): Promise<CheckoutResult> {
  const result = await rpc<{ outcome: string }>(
    deps,
    "confirm_without_payment",
    { p_booking_id: bookingId },
  );
  if (result.outcome === "dates_lost") return rejected("dates_unavailable");
  await queue(deps, "booking_confirmation", { bookingId });
  await queue(deps, "host_new_booking", { bookingId });
  return { kind: "done", token, path: guestBookingPath(locale, token) };
}

async function openSession(
  deps: PaymentDeps,
  bookingId: string,
  input: CheckoutRequest,
  sale: {
    amountCents: number;
    paymentKind: string;
    holdExpiresAt: string;
    holdMinutes: number;
  },
): Promise<string | null> {
  const stripe = requireStripe(deps);
  const secret = secretOf(deps);

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(
      sessionParams({
        deps,
        bookingId,
        kind: "booking",
        paymentKind: sale.paymentKind,
        amountCents: sale.amountCents,
        locale: input.locale,
        email: input.email,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        expiresAt: sessionExpiresAt(sale.holdExpiresAt, sale.holdMinutes),
        cancelPath: cancelPath(secret, bookingId, input),
      }),
      { idempotencyKey: `checkout:${bookingId}` },
    );
  } catch (error) {
    console.error(`session for ${bookingId}: ${dbCode(error)}`);
    await releaseHold(deps, bookingId);
    return null;
  }

  try {
    await rpc(deps, "attach_checkout_session", {
      p_booking_id: bookingId,
      p_session_id: session.id,
    });
  } catch (error) {
    // Nothing would connect the Session to its hold, so it must not be paid.
    console.error(`attach for ${bookingId}: ${dbCode(error)}`);
    await closeSession(stripe, session.id).catch(() => false);
    await releaseHold(deps, bookingId);
    return null;
  }
  return session.url;
}

export async function startCheckout(
  deps: PaymentDeps,
  input: CheckoutRequest,
  previousToken: string | undefined,
): Promise<CheckoutResult> {
  const secret = secretOf(deps);

  if (previousToken) {
    const ended = await endPreviousAttempt(deps, previousToken, input);
    if (ended) return ended;
  }

  const house = await loadHouse(deps);
  if (!house) return rejected("room_inactive");

  const now = deps.now();
  const prepared = await prepareCheckout(
    deps.db,
    {
      stay: {
        roomId: house.id,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        adults: input.adults,
        children: input.children,
      },
      promoCode: input.promoCode || undefined,
      guest: guestFrom(input),
      termsVersion: TERMS_VERSION,
      // The token depends on the booking id, so it is issued after the hold.
      tokenHash: "",
      tokenExpiresAt: "",
    },
    now,
  );
  if (!prepared.ok) return rejected(prepared.reason);

  const { dueNowCents } = prepared.breakdown;
  if (dueNowCents > 0 && dueNowCents < MIN_CHARGE_CENTS) {
    return rejected("payment_unavailable");
  }

  let hold: { booking_id: string; expires_at: string };
  try {
    hold = await rpc(deps, "create_hold", {
      ...prepared.holdArgs,
      p_token_hash: null,
      p_token_expires_at: null,
    });
  } catch (error) {
    const code = dbCode(error);
    if (code === "dates_unavailable" || code === "promo_unavailable") {
      return rejected(code);
    }
    if (code === "room_inactive" || code === "invalid_dates") {
      return rejected(code);
    }
    throw error;
  }
  const bookingId = hold.booking_id;

  let token: string;
  try {
    token = await issueGuestToken(deps.db, bookingId, secret);
  } catch (error) {
    await releaseHold(deps, bookingId);
    throw error;
  }

  if (dueNowCents === 0) {
    return confirmFree(deps, bookingId, token, input.locale);
  }

  const url = await openSession(deps, bookingId, input, {
    amountCents: dueNowCents,
    paymentKind: prepared.paymentKind,
    holdExpiresAt: hold.expires_at,
    holdMinutes: prepared.holdArgs.p_hold_minutes ?? 35,
  });
  if (!url) return rejected("payment_unavailable");
  return { kind: "redirect", url, token };
}

/** From the cancel page. Harmless if repeated or if the guest has since paid. */
export async function releaseFromCancelPage(
  deps: PaymentDeps,
  key: string,
): Promise<boolean> {
  const bookingId = bookingFromReleaseKey(secretOf(deps), key);
  if (!bookingId) return false;
  await endAttempt(deps, bookingId);
  return true;
}

const LIVE = ["confirmed", "checked_in", "completed"];

export type CheckoutState =
  | { state: "unknown" }
  /** Stripe has not been paid. */
  | { state: "not_paid" }
  /** Paid or in progress, waiting for the webhook. */
  | { state: "confirming" }
  /** Only ever from our database, which only a verified webhook changes. */
  | { state: "confirmed"; reference: string | null; path: string | null }
  /** Money arrived and the booking did not follow. A person is on it. */
  | { state: "problem" };

/** What the return page shows. The redirect itself proves nothing (BKG-12). */
export async function checkoutState(
  deps: PaymentDeps,
  sessionId: string,
): Promise<CheckoutState> {
  const stripe = requireStripe(deps);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return { state: "unknown" };
  }
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return { state: "unknown" };

  const { data: booking, error } = await deps.db
    .from("bookings")
    .select("status, reference, locale")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking) return { state: "unknown" };

  const intent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? null);
  let recorded = false;
  if (intent) {
    const { data, error: paymentError } = await deps.db
      .from("payments")
      .select("id")
      .eq("stripe_payment_intent_id", intent)
      .maybeSingle();
    if (paymentError) throw new Error(paymentError.message);
    recorded = !!data;
  }

  const isLive = LIVE.includes(booking.status);
  if (isLive && (recorded || session.metadata?.kind !== "balance")) {
    const token =
      deps.guestTokenSecret &&
      deriveGuestToken(deps.guestTokenSecret, bookingId);
    return {
      state: "confirmed",
      reference: booking.reference,
      path: token
        ? guestBookingPath(booking.locale === "el" ? "el" : "en", token)
        : null,
    };
  }
  if (recorded) return { state: "problem" };
  return session.status === "complete"
    ? { state: "confirming" }
    : { state: "not_paid" };
}
