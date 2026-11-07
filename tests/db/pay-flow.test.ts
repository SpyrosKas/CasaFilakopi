import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/email", () => ({
  kickEmails: async () => {},
  queueEmail: async () => ({ ok: true, ids: [], duplicate: false }),
}));

import { POST as checkoutRoute } from "@/app/api/checkout/route";
import { POST as balanceRoute } from "@/app/api/checkout/balance/route";
import { POST as cancelRoute } from "@/app/api/checkout/guest/cancel/route";
import { POST as messageRoute } from "@/app/api/checkout/guest/message/route";
import { POST as quoteRoute } from "@/app/api/checkout/quote/route";
import { GET as availabilityRoute } from "@/app/api/checkout/availability/route";
import { POST as releaseRoute } from "@/app/api/checkout/release/route";
import { GET as statusRoute } from "@/app/api/checkout/status/route";
import { GET as cronRoute } from "@/app/api/cron/payments/route";
import { POST as webhookRoute } from "@/app/api/stripe/webhook/route";
import { addDays } from "@/lib/domain/dates";
import { deriveGuestToken, hashGuestToken } from "@/lib/email/guest-link";
import { releaseKey, startCheckout } from "@/lib/payments/checkout";
import { checkoutSchema } from "@/lib/payments/schemas";
import { loadGuestView } from "@/lib/payments/guest";
import { closeBalanceSessions } from "@/lib/payments/balance";
import { reconcilePayments } from "@/lib/payments/reconcile";
import { resumeStaleRefunds, refundShares } from "@/lib/payments/refunds";
import { handleStripeWebhook } from "@/lib/payments/webhook";
import { sendScheduledEmails } from "@/lib/email/scheduled";
import { FakeStripe, type FakeSession } from "../support/fake-stripe";
import { createRoom, db } from "./helpers";
import {
  address,
  cleanUp,
  client,
  emailsFor,
  guestDetails,
  GUEST_SECRET,
  hasClaim,
  jsonRequest,
  loadBooking,
  nextStay,
  paymentsFor,
  refundsFor,
  SITE_URL,
  testDeps,
  useRouteEnv,
} from "./pay-helpers";

const fake = new FakeStripe();
const startedAt = new Date();
let roomId: string;

beforeAll(async () => {
  await fake.start();
  roomId = await createRoom();
  useRouteEnv(fake, roomId);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

beforeEach(async () => {
  await db.query(
    `delete from public.admin_attempts where scope like 'pay\\_%'`,
  );
});

afterAll(async () => {
  await cleanUp(roomId, startedAt);
  await fake.stop();
  await db.end();
});

interface Started {
  bookingId: string;
  session: FakeSession;
  token: string;
  cookie: string;
}

const cookieName = "cf_checkout";

async function checkout(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return checkoutRoute(jsonRequest("/api/checkout", body, headers));
}

async function start(extra: Record<string, unknown> = {}): Promise<Started> {
  const body = { ...nextStay(), ...guestDetails(), ...extra };
  const response = await checkout(body);
  expect(response.status).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const session = [...fake.sessions.values()].find((s) => s.url === url)!;
  const bookingId = session.metadata.booking_id;
  return {
    bookingId,
    session,
    token: deriveGuestToken(GUEST_SECRET, bookingId),
    cookie: `${cookieName}=${response.cookies.get(cookieName)?.value}`,
  };
}

async function deliver(type: string, object: unknown, eventId?: string) {
  const { payload, signature } = fake.event(type, object, eventId);
  const response = await webhookRoute(
    new Request(`${SITE_URL}/api/stripe/webhook`, {
      method: "POST",
      headers: { "stripe-signature": signature },
      body: payload,
    }),
  );
  return { response, eventId: (JSON.parse(payload) as { id: string }).id };
}

async function paid(started: Started, amount?: number) {
  const session = fake.pay(started.session.id, { amount });
  return deliver("checkout.session.completed", session);
}

async function confirmed(extra: Record<string, unknown> = {}) {
  const started = await start(extra);
  const { response } = await paid(started);
  expect(response.status).toBe(200);
  return started;
}

const status = (sessionId: string) =>
  statusRoute(
    new Request(`${SITE_URL}/api/checkout/status?session_id=${sessionId}`, {
      headers: { "x-forwarded-for": address() },
    }),
  );

async function setPayment(value: unknown) {
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'payment'`,
    [JSON.stringify(value)],
  );
}

async function withPaymentRules<T>(value: unknown, run: () => Promise<T>) {
  const { rows } = await db.query(
    `select value from public.settings where key = 'payment'`,
  );
  await setPayment(value);
  try {
    return await run();
  } finally {
    await setPayment(rows[0].value);
  }
}

const balanceSessions = (bookingId: string) =>
  [...fake.sessions.values()].filter(
    (s) => s.metadata.booking_id === bookingId && s.metadata.kind === "balance",
  );

const DEPOSIT = {
  mode: "deposit",
  deposit: { kind: "percent", percent: 30 },
  balanceDaysBefore: 14,
};

describe("checkout", () => {
  it("creates a hold and one Session, with nothing confirmed", async () => {
    const started = await start({ marketing: true });
    const booking = await loadBooking(started.bookingId);

    expect(booking.status).toBe("pending_payment");
    expect(booking.terms_version).toBeTruthy();
    expect(booking.terms_accepted_at).not.toBeNull();
    expect(booking.marketing_consent).toBe(true);
    expect(booking.reference).toBeNull();
    expect(booking.access_token_hash).toBe(hashGuestToken(started.token));
    expect(await hasClaim(started.bookingId)).toBe(true);

    const { session } = started;
    expect(session.amount_total).toBe(booking.due_now_cents);
    expect(session.currency).toBe("eur");
    expect(session.client_reference_id).toBe(started.bookingId);
    expect(session.customer_email).toBe(booking.guest_email);
    expect(session.metadata.kind).toBe("booking");

    const created = fake.creates.at(-1)!;
    expect(created.key).toBe(`checkout:${started.bookingId}`);
    expect(created.params.allowed_payment_method_types).toEqual({ 0: "card" });

    const { rows } = await db.query(
      `select expires_at, stripe_checkout_session_id from public.holds where booking_id = $1`,
      [started.bookingId],
    );
    expect(rows[0].stripe_checkout_session_id).toBe(session.id);
    const holdEnds = new Date(rows[0].expires_at).getTime() / 1000;
    const margin = holdEnds - session.expires_at;
    expect(margin).toBeGreaterThanOrEqual(3 * 60);
    expect(margin).toBeLessThanOrEqual(4 * 60 + 1);
  });

  it("refuses an amount sent from the browser", async () => {
    const response = await checkout({
      ...nextStay(),
      ...guestDetails(),
      totalCents: 1,
    });
    expect(response.status).toBe(400);
  });

  it("refuses a checkout without the terms accepted", async () => {
    const response = await checkout({
      ...nextStay(),
      ...guestDetails({ acceptTerms: false }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fields: ["acceptTerms"] });
  });

  it("refuses another site's origin", async () => {
    const response = await checkout(
      { ...nextStay(), ...guestDetails() },
      { origin: "https://evil.example" },
    );
    expect(response.status).toBe(403);
  });

  it("gives a promo the same rejection whatever the reason", async () => {
    const response = await checkout({
      ...nextStay(),
      ...guestDetails(),
      promoCode: "NO-SUCH-CODE",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "promo_unavailable" });
  });

  it("lets one of two racing guests through, with one Session", async () => {
    const stay = nextStay();
    const before = fake.creates.length;
    const results = await Promise.all(
      Array.from({ length: 4 }, () => checkout({ ...stay, ...guestDetails() })),
    );
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409]);
    expect(fake.creates.length).toBe(before + 1);
    const refused = await results
      .find((result) => result.status === 409)!
      .json();
    expect(refused).toEqual({ error: "dates_unavailable" });
  });

  it("gives the dates back if Stripe refuses the Session", async () => {
    const stay = nextStay();
    fake.failNext("session", { status: 400 });
    const failed = await checkout({ ...stay, ...guestDetails() });
    expect(failed.status).toBe(409);
    expect(await failed.json()).toEqual({ error: "payment_unavailable" });

    const retry = await checkout({ ...stay, ...guestDetails() });
    expect(retry.status).toBe(200);
  });

  it("closes the Session and frees the dates if attach fails", async () => {
    const stay = nextStay();
    const deps = testDeps(fake, roomId);
    const realRpc = deps.db.rpc.bind(deps.db);
    deps.db = new Proxy(deps.db, {
      get(target, property, receiver) {
        if (property !== "rpc") return Reflect.get(target, property, receiver);
        return (fn: string, args: never) =>
          fn === "attach_checkout_session"
            ? Promise.resolve({ data: null, error: { message: "db_down" } })
            : realRpc(fn as never, args);
      },
    });
    const input = checkoutSchema.parse({ ...stay, ...guestDetails() });
    const result = await startCheckout(deps, input, undefined);
    expect(result).toEqual({
      kind: "rejected",
      reason: "payment_unavailable",
    });
    expect(fake.creates.at(-1)).toBeTruthy();
    const session = [...fake.sessions.values()].at(-1)!;
    expect(session.status).toBe("expired");
    expect(await hasClaim(session.metadata.booking_id)).toBe(false);
  });

  it("lets a guest go back and retry without blocking themselves", async () => {
    const stay = nextStay();
    const first = await start(stay);
    const second = await checkout(
      { ...stay, ...guestDetails() },
      { cookie: first.cookie },
    );
    expect(second.status).toBe(200);

    expect(first.session.status).toBe("expired");
    expect((await loadBooking(first.bookingId)).status).toBe("expired");
    expect(await hasClaim(first.bookingId)).toBe(false);
    const open = fake.openSessions.filter(
      (s) => s.metadata.booking_id !== first.bookingId,
    );
    expect(open.some((s) => s.url !== null)).toBe(true);
  });

  it("sends a returning guest to their booking if they already paid", async () => {
    const stay = nextStay();
    const first = await start(stay);
    fake.pay(first.session.id); // Paid, webhook not here yet.
    const before = fake.creates.length;

    const again = await checkout(
      { ...stay, ...guestDetails() },
      { cookie: first.cookie },
    );
    expect(again.status).toBe(200);
    expect((await again.json()) as object).toEqual({
      path: `/en/booking/${first.token}`,
    });
    expect(fake.creates.length).toBe(before);
    expect(await hasClaim(first.bookingId)).toBe(true);
  });

  it("frees the dates from the cancel page, and only with a real key", async () => {
    const stay = nextStay();
    const started = await start(stay);

    const forged = await releaseRoute(
      jsonRequest("/api/checkout/release", {
        key: `${started.bookingId}.AAAA`,
      }),
    );
    expect(forged.status).toBe(404);
    expect(await hasClaim(started.bookingId)).toBe(true);

    const released = await releaseRoute(
      jsonRequest("/api/checkout/release", {
        key: releaseKey(GUEST_SECRET, started.bookingId),
      }),
    );
    expect(released.status).toBe(200);
    expect(started.session.status).toBe("expired");
    expect(await hasClaim(started.bookingId)).toBe(false);

    const retry = await checkout({ ...stay, ...guestDetails() });
    expect(retry.status).toBe(200);
  });

  it("the cancel link holds no guest token", async () => {
    const started = await start();
    expect(started.session.cancel_url).not.toContain(started.token);
    expect(started.session.success_url).not.toContain(started.token);
    expect(started.session.success_url).toContain(
      "session_id={CHECKOUT_SESSION_ID}",
    );
  });
});

describe("nothing due now", () => {
  it("confirms without Stripe, and no Session is made", async () => {
    const code = `FREE${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.promo_codes (code, kind, value) values ($1, 'percent', 10000)`,
      [code],
    );
    const { rows: fees } = await db.query(
      `update public.taxes_fees set is_active = false where is_active returning id`,
    );
    try {
      const before = fake.creates.length;
      const response = await checkout({
        ...nextStay(),
        ...guestDetails(),
        promoCode: code,
      });
      expect(response.status).toBe(200);
      const { path } = (await response.json()) as { path: string };
      expect(path).toMatch(/^\/en\/booking\//);
      expect(fake.creates.length).toBe(before);

      const { rows } = await db.query(
        `select id, status, total_cents from public.bookings where promo_code = $1`,
        [code],
      );
      expect(rows[0]).toMatchObject({ status: "confirmed", total_cents: 0 });
      expect(
        (await emailsFor(rows[0].id)).map((row) => row.template_key).sort(),
      ).toEqual(["booking_confirmation", "host_new_booking"]);
    } finally {
      await db.query(
        `update public.taxes_fees set is_active = true where id = any($1)`,
        [fees.map((row) => row.id)],
      );
      await db.query(
        `update public.bookings set promo_code = null where promo_code = $1`,
        [code],
      );
      await db.query(`delete from public.promo_codes where code = $1`, [code]);
    }
  });
});

describe("webhook", () => {
  it("confirms only from a verified paid event", async () => {
    const started = await start();
    fake.pay(started.session.id);

    // The guest is back from Stripe. Only the webhook may confirm.
    const before = await (await status(started.session.id)).json();
    expect(before).toEqual({ state: "confirming" });
    expect((await loadBooking(started.bookingId)).status).toBe(
      "pending_payment",
    );

    const { response } = await deliver(
      "checkout.session.completed",
      started.session,
    );
    expect(response.status).toBe(200);

    const booking = await loadBooking(started.bookingId);
    expect(booking.status).toBe("confirmed");
    expect(booking.reference).toMatch(/^CF-\d{4}-\d{5}$/);

    const [payment] = await paymentsFor(started.bookingId);
    expect(payment).toMatchObject({
      kind: "full",
      method: "card",
      status: "succeeded",
      amount_cents: booking.total_cents,
      stripe_payment_intent_id: started.session.payment_intent,
      stripe_checkout_session_id: started.session.id,
    });

    const keys = (await emailsFor(started.bookingId))
      .map((row) => row.template_key)
      .sort();
    expect(keys).toEqual([
      "booking_confirmation",
      "host_new_booking",
      "payment_receipt",
    ]);

    const after = await (await status(started.session.id)).json();
    expect(after).toEqual({
      state: "confirmed",
      reference: booking.reference,
      path: `/en/booking/${started.token}`,
    });
  });

  it("does not confirm an unpaid completed Session", async () => {
    const started = await start();
    const session = fake.pay(started.session.id, { status: "unpaid" });
    await deliver("checkout.session.completed", session);
    expect((await loadBooking(started.bookingId)).status).toBe(
      "pending_payment",
    );
    expect(await paymentsFor(started.bookingId)).toHaveLength(0);

    session.payment_status = "paid";
    await deliver("checkout.session.async_payment_succeeded", session);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("handles the same event twice at the same moment", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const eventId = `evt_${randomUUID()}`;
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        deliver("checkout.session.completed", session, eventId),
      ),
    );
    for (const { response } of results) expect(response.status).toBe(200);

    expect(await paymentsFor(started.bookingId)).toHaveLength(1);
    const keys = (await emailsFor(started.bookingId)).map(
      (row) => row.template_key,
    );
    expect(keys.filter((key) => key === "booking_confirmation")).toHaveLength(
      1,
    );
    expect(keys.filter((key) => key === "payment_receipt")).toHaveLength(1);
    const reference = (await loadBooking(started.bookingId)).reference;
    expect(reference).toBeTruthy();
  });

  it("treats two events for one intent as one payment", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    await Promise.all([
      deliver("checkout.session.completed", session),
      deliver("checkout.session.async_payment_succeeded", session),
    ]);
    expect(await paymentsFor(started.bookingId)).toHaveLength(1);
  });

  it("survives the webhook landing before attach", async () => {
    const stay = nextStay();
    let delivered = false;
    fake.onSessionCreated = async (session) => {
      fake.onSessionCreated = undefined;
      fake.pay(session.id);
      const { response } = await deliver("checkout.session.completed", session);
      delivered = response.status === 200;
    };
    const response = await checkout({ ...stay, ...guestDetails() });
    expect(delivered).toBe(true);
    expect(response.status).toBe(200);

    const { url } = (await response.json()) as { url: string };
    const session = [...fake.sessions.values()].find((s) => s.url === url)!;
    const booking = await loadBooking(session.metadata.booking_id);
    expect(booking.status).toBe("confirmed");
    expect(await hasClaim(booking.id)).toBe(true);
  });

  it("a replay after a cancellation changes nothing", async () => {
    const started = await confirmed();
    await db.query(`select public.cancel_booking($1, 'test')`, [
      started.bookingId,
    ]);
    await db.query(`delete from public.email_logs where booking_id = $1`, [
      started.bookingId,
    ]);

    // A fresh event id gets past the event table, as a dashboard resend would.
    const { response } = await deliver(
      "checkout.session.completed",
      started.session,
    );
    expect(response.status).toBe(200);

    const booking = await loadBooking(started.bookingId);
    expect(booking.status).toBe("cancelled");
    expect(await hasClaim(started.bookingId)).toBe(false);
    expect(await paymentsFor(started.bookingId)).toHaveLength(1);
    expect(await emailsFor(started.bookingId)).toHaveLength(0);
  });

  it("confirms a late payment when the dates are still free", async () => {
    const started = await start();
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [started.bookingId],
    );
    await db.query(`select public.release_expired_holds()`);
    expect((await loadBooking(started.bookingId)).status).toBe("expired");

    await paid(started);
    const booking = await loadBooking(started.bookingId);
    expect(booking.status).toBe("confirmed");
    expect(await hasClaim(started.bookingId)).toBe(true);
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
  });

  async function loseDates() {
    const stay = nextStay();
    const started = await start(stay);
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [started.bookingId],
    );
    const rival = await start(stay);
    const { response } = await paid(rival);
    expect(response.status).toBe(200);
    return { started, rival };
  }

  it("refunds in full and apologises when the dates are lost", async () => {
    const { started, rival } = await loseDates();
    const session = fake.pay(started.session.id);
    const { response, eventId } = await deliver(
      "checkout.session.completed",
      session,
    );
    expect(response.status).toBe(200);

    expect((await loadBooking(started.bookingId)).status).toBe("expired");
    expect((await loadBooking(rival.bookingId)).status).toBe("confirmed");
    expect(await hasClaim(started.bookingId)).toBe(false);

    const [payment] = await paymentsFor(started.bookingId);
    const [refund] = await refundsFor(started.bookingId);
    expect(refund).toMatchObject({
      status: "succeeded",
      amount_cents: payment.amount_cents,
      payment_id: payment.id,
    });
    expect(refund.stripe_refund_id).toBeTruthy();
    expect(fake.refunds.get(refund.stripe_refund_id)?.amount).toBe(
      payment.amount_cents,
    );
    expect(fake.refundKeys.at(-1)).toBe(`refund:${refund.id}`);

    const emails = await emailsFor(started.bookingId);
    const apology = emails.find((row) => row.template_key === "host_message");
    expect(apology?.payload.subject).toMatch(/sorry/i);
    expect(emails.map((row) => row.template_key)).toContain(
      "host_payment_failed",
    );
    expect(emails.map((row) => row.template_key)).not.toContain(
      "booking_confirmation",
    );

    // A replay with the same id does nothing, and a resend under a new id
    // finds the refund already made.
    const refundCount = fake.refunds.size;
    await deliver("checkout.session.completed", session, eventId);
    const resent = await deliver("checkout.session.completed", session);
    expect(resent.response.status).toBe(200);
    expect(fake.refunds.size).toBe(refundCount);
    expect(await refundsFor(started.bookingId)).toHaveLength(1);
    expect(
      (await emailsFor(started.bookingId)).filter(
        (row) => row.template_key === "host_message",
      ),
    ).toHaveLength(1);
  });

  it("two lost-date deliveries at once refund once", async () => {
    const { started } = await loseDates();
    const session = fake.pay(started.session.id);
    const before = fake.refunds.size;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        deliver("checkout.session.completed", session),
      ),
    );
    for (const { response } of results) expect(response.status).toBe(200);
    expect(fake.refunds.size).toBe(before + 1);
    const rows = await refundsFor(started.bookingId);
    expect(rows.filter((row) => row.status !== "failed")).toHaveLength(1);
  });

  it("retries a refund that failed, then finishes the event", async () => {
    const { started } = await loseDates();
    const session = fake.pay(started.session.id);
    fake.failNext("refund", { status: 402 });

    const eventId = `evt_${randomUUID()}`;
    const first = await deliver("checkout.session.completed", session, eventId);
    expect(first.response.status).toBe(500);

    let rows = await refundsFor(started.bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("failed");

    const { rows: events } = await db.query(
      `select processed_at, error from public.stripe_events where id = $1`,
      [eventId],
    );
    expect(events[0].processed_at).toBeNull();
    expect(events[0].error).toBe("refund_not_sent");
    expect(
      (await emailsFor(started.bookingId)).map((row) => row.template_key),
    ).toContain("host_payment_failed");

    const second = await deliver(
      "checkout.session.completed",
      session,
      eventId,
    );
    expect(second.response.status).toBe(200);
    rows = await refundsFor(started.bookingId);
    expect(rows.map((row) => row.status).sort()).toEqual([
      "failed",
      "succeeded",
    ]);
    const { rows: finished } = await db.query(
      `select processed_at, error from public.stripe_events where id = $1`,
      [eventId],
    );
    expect(finished[0].processed_at).not.toBeNull();
    expect(finished[0].error).toBeNull();
  });

  it("an event seen but not finished runs again", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const eventId = `evt_${randomUUID()}`;
    await db.query(
      `insert into public.stripe_events (id, type, payload) values ($1, 'checkout.session.completed', '{}')`,
      [eventId],
    );
    const { response } = await deliver(
      "checkout.session.completed",
      session,
      eventId,
    );
    expect(response.status).toBe(200);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("does not touch money on a finished event", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const eventId = `evt_${randomUUID()}`;
    await db.query(
      `insert into public.stripe_events (id, type, payload, processed_at) values ($1, 'checkout.session.completed', '{}', now())`,
      [eventId],
    );
    const { response } = await deliver(
      "checkout.session.completed",
      session,
      eventId,
    );
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(await paymentsFor(started.bookingId)).toHaveLength(0);
  });

  it("keeps a wrong amount unconfirmed, alerts, and does not refund", async () => {
    const started = await start();
    const before = fake.refunds.size;
    const { response } = await paid(
      started,
      started.session.amount_total - 100,
    );
    expect(response.status).toBe(200);

    const booking = await loadBooking(started.bookingId);
    expect(booking.status).toBe("pending_payment");
    expect(booking.confirmed_at).toBeNull();
    expect(fake.refunds.size).toBe(before);
    const emails = await emailsFor(started.bookingId);
    expect(emails.map((row) => row.template_key)).toEqual([
      "host_payment_failed",
    ]);
    expect(String(emails[0].payload.reason)).toMatch(/διαφορετικό ποσό/);
    expect(await (await status(started.session.id)).json()).toEqual({
      state: "problem",
    });
  });

  it("alerts on a second payment and does not refund it", async () => {
    const started = await confirmed();
    const extra = {
      ...started.session,
      id: `cs_test_${randomUUID().replace(/-/g, "")}`,
      payment_intent: `pi_${randomUUID().replace(/-/g, "")}`,
    };
    const before = fake.refunds.size;
    const { response } = await deliver("checkout.session.completed", extra);
    expect(response.status).toBe(200);

    expect(await paymentsFor(started.bookingId)).toHaveLength(2);
    expect(fake.refunds.size).toBe(before);
    expect(
      (await emailsFor(started.bookingId)).filter(
        (row) => row.template_key === "host_payment_failed",
      ).length,
    ).toBeGreaterThan(0);
  });

  it("refuses a payment in another currency", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const { response } = await deliver("checkout.session.completed", {
      ...session,
      currency: "usd",
    });
    expect(response.status).toBe(200);
    expect((await loadBooking(started.bookingId)).status).toBe(
      "pending_payment",
    );
    expect(await paymentsFor(started.bookingId)).toHaveLength(0);
  });

  it("refuses a bad signature and a tampered body", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const eventId = `evt_${randomUUID()}`;
    const { payload, signature } = fake.event(
      "checkout.session.completed",
      session,
      eventId,
    );
    const send = (body: string, header: string | null) =>
      webhookRoute(
        new Request(`${SITE_URL}/api/stripe/webhook`, {
          method: "POST",
          headers: header ? { "stripe-signature": header } : {},
          body,
        }),
      );

    expect((await send(payload, null)).status).toBe(400);
    expect((await send(payload, "t=1,v1=bad")).status).toBe(400);
    expect(
      (await send(payload, fake.sign(payload, "whsec_other"))).status,
    ).toBe(400);
    const tampered = payload.replace(
      `"amount_total":${session.amount_total}`,
      `"amount_total":1`,
    );
    expect(tampered).not.toBe(payload);
    expect((await send(tampered, signature)).status).toBe(400);

    expect(await paymentsFor(started.bookingId)).toHaveLength(0);
    const { rows } = await db.query(
      `select id from public.stripe_events where id = $1`,
      [eventId],
    );
    expect(rows).toHaveLength(0);
  });

  it("stores no personal data with an event", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const { eventId } = await deliver("checkout.session.completed", {
      ...session,
      customer_details: { email: "private@example.test", name: "Private" },
    });
    const { rows } = await db.query(
      `select payload::text as text from public.stripe_events where id = $1`,
      [eventId],
    );
    expect(rows[0].text).not.toContain("example.test");
    expect(rows[0].text).not.toContain("Private");
    expect(rows[0].text).toContain(started.bookingId);
  });

  it("ignores Sessions that are not ours", async () => {
    const { response } = await deliver("checkout.session.completed", {
      id: "cs_test_other",
      object: "checkout.session",
      metadata: {},
      payment_status: "paid",
    });
    expect(response.status).toBe(200);
  });
});

describe("abandoned", () => {
  it("frees the dates and gives the promo back when a Session expires", async () => {
    const stay = nextStay();
    const code = `PAY${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.promo_codes (code, kind, value) values ($1, 'percent', 1000)`,
      [code],
    );
    try {
      const started = await start({ ...stay, promoCode: code });
      const used = async () =>
        (
          await db.query(
            `select used_count from public.promo_codes where code = $1`,
            [code],
          )
        ).rows[0].used_count;
      expect(await used()).toBe(1);

      started.session.status = "expired";
      const { response } = await deliver(
        "checkout.session.expired",
        started.session,
      );
      expect(response.status).toBe(200);

      expect((await loadBooking(started.bookingId)).status).toBe("expired");
      expect(await hasClaim(started.bookingId)).toBe(false);
      expect(await used()).toBe(0);
      expect((await checkout({ ...stay, ...guestDetails() })).status).toBe(200);
    } finally {
      await db.query(
        `update public.bookings set promo_code = null where promo_code = $1`,
        [code],
      );
      await db.query(`delete from public.promo_codes where code = $1`, [code]);
    }
  });

  it("an expiry after the payment changes nothing", async () => {
    const started = await confirmed();
    const { response } = await deliver("checkout.session.expired", {
      ...started.session,
      status: "expired",
    });
    expect(response.status).toBe(200);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
    expect(await hasClaim(started.bookingId)).toBe(true);
  });

  it("a payment after the expiry event still confirms", async () => {
    const started = await start();
    await deliver("checkout.session.expired", started.session);
    expect((await loadBooking(started.bookingId)).status).toBe("expired");
    await paid(started);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("a declined card leaves the hold alone", async () => {
    const started = await start();
    const { response } = await deliver("payment_intent.payment_failed", {
      id: "pi_declined",
      object: "payment_intent",
      metadata: started.session.metadata,
    });
    expect(response.status).toBe(200);
    expect((await loadBooking(started.bookingId)).status).toBe(
      "pending_payment",
    );
    expect(await hasClaim(started.bookingId)).toBe(true);
  });

  it("a failed delayed payment frees the dates and tells the host", async () => {
    const started = await start();
    await deliver("checkout.session.async_payment_failed", started.session);
    expect((await loadBooking(started.bookingId)).status).toBe("expired");
    expect(
      (await emailsFor(started.bookingId)).map((row) => row.template_key),
    ).toContain("host_payment_failed");
  });
});

describe("deposit and balance", () => {
  it("takes a deposit, then the balance", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      const booking = await loadBooking(started.bookingId);
      expect(booking.due_now_cents).toBeLessThan(booking.total_cents);
      const [deposit] = await paymentsFor(started.bookingId);
      expect(deposit.kind).toBe("deposit");
      expect(started.session.amount_total).toBe(booking.due_now_cents);

      const pay = () =>
        balanceRoute(
          jsonRequest("/api/checkout/balance", {
            token: started.token,
            locale: "en",
          }),
        );
      const first = await pay();
      expect(first.status).toBe(200);
      const { url } = (await first.json()) as { url: string };

      // Two tabs, one Session.
      const again = await pay();
      expect(((await again.json()) as { url: string }).url).toBe(url);
      const sessions = [...fake.sessions.values()].filter(
        (s) =>
          s.metadata.booking_id === started.bookingId &&
          s.metadata.kind === "balance",
      );
      expect(sessions).toHaveLength(1);
      const [balance] = sessions;
      const left = booking.total_cents - booking.due_now_cents;
      expect(balance.amount_total).toBe(left);

      const view = await loadGuestView(testDeps(fake, roomId), started.token);
      expect(view?.balanceCents).toBe(left);
      expect(view?.paidCents).toBe(booking.due_now_cents);

      const paidBalance = fake.pay(balance.id);
      const { response } = await deliver(
        "checkout.session.completed",
        paidBalance,
      );
      expect(response.status).toBe(200);
      await deliver("checkout.session.completed", paidBalance);

      const rows = await paymentsFor(started.bookingId);
      expect(rows.map((row) => [row.kind, row.status])).toEqual([
        ["deposit", "succeeded"],
        ["balance", "succeeded"],
      ]);
      expect(rows[1].amount_cents).toBe(left);
      expect(rows[1].stripe_payment_intent_id).toBe(paidBalance.payment_intent);

      const done = await pay();
      expect(done.status).toBe(409);
      expect(await done.json()).toEqual({ error: "nothing_due" });
    });
  });

  it("replaces an open Session when the balance has changed", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      const pay = () =>
        balanceRoute(
          jsonRequest("/api/checkout/balance", {
            token: started.token,
            locale: "en",
          }),
        );
      await pay();
      const [open] = [...fake.sessions.values()].filter(
        (s) =>
          s.metadata.booking_id === started.bookingId &&
          s.metadata.kind === "balance",
      );

      await db.query(
        `select public.record_payment($1, 'balance', 'cash', 100)`,
        [started.bookingId],
      );
      const next = await pay();
      expect(next.status).toBe(200);
      expect(open.status).toBe("expired");
    });
  });

  it("an arrival on or after the due date pays in full", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const soon = addDays(new Date().toISOString().slice(0, 10), 10);
      const started = await start({
        checkIn: soon,
        checkOut: addDays(soon, 2),
      });
      const booking = await loadBooking(started.bookingId);
      expect(booking.due_now_cents).toBe(booking.total_cents);
    });
  });

  it("an expired balance Session leaves no trace", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await balanceRoute(
        jsonRequest("/api/checkout/balance", {
          token: started.token,
          locale: "en",
        }),
      );
      const [open] = [...fake.sessions.values()].filter(
        (s) =>
          s.metadata.booking_id === started.bookingId &&
          s.metadata.kind === "balance",
      );
      expect(await paymentsFor(started.bookingId)).toHaveLength(2);
      await deliver("checkout.session.expired", open);
      expect(await paymentsFor(started.bookingId)).toHaveLength(1);
      expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
    });
  });

  it("tells the host about a balance paid on a cancelled booking", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await balanceRoute(
        jsonRequest("/api/checkout/balance", {
          token: started.token,
          locale: "en",
        }),
      );
      const [open] = [...fake.sessions.values()].filter(
        (s) =>
          s.metadata.booking_id === started.bookingId &&
          s.metadata.kind === "balance",
      );
      await db.query(`select public.cancel_booking($1, 'test')`, [
        started.bookingId,
      ]);
      const before = fake.refunds.size;
      await deliver("checkout.session.completed", fake.pay(open.id));
      expect(fake.refunds.size).toBe(before);
      expect(
        (await emailsFor(started.bookingId)).map((row) => row.template_key),
      ).toContain("host_payment_failed");
    });
  });
});

describe("guest link", () => {
  const cancelWith = (token: string, expectedRefundCents: number) =>
    cancelRoute(
      jsonRequest("/api/checkout/guest/cancel", {
        token,
        expectedRefundCents,
      }),
    );

  it("gives one 404 for a wrong, malformed or expired token", async () => {
    const started = await confirmed();
    const wrong = deriveGuestToken(GUEST_SECRET, randomUUID());
    const deps = testDeps(fake, roomId);

    expect(await loadGuestView(deps, wrong)).toBeNull();
    expect(await loadGuestView(deps, "short")).toBeNull();
    expect(await loadGuestView(deps, `${started.token}x'; --`)).toBeNull();

    await db.query(
      `update public.bookings set access_token_expires_at = now() - interval '1 day' where id = $1`,
      [started.bookingId],
    );
    expect(await loadGuestView(deps, started.token)).toBeNull();

    const answers = await Promise.all([
      cancelWith(wrong, 0),
      cancelWith(started.token, 0),
    ]);
    expect(answers.map((a) => a.status)).toEqual([404, 404]);
    expect(await answers[0].json()).toEqual(await answers[1].json());

    const balance = await balanceRoute(
      jsonRequest("/api/checkout/balance", {
        token: started.token,
        locale: "en",
      }),
    );
    expect(balance.status).toBe(404);
    const message = await messageRoute(
      jsonRequest("/api/checkout/guest/message", {
        token: started.token,
        message: "hello there",
      }),
    );
    expect(message.status).toBe(404);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("a token reaches only its own booking", async () => {
    const mine = await confirmed();
    const other = await confirmed();
    const response = await cancelWith(
      mine.token,
      (await loadBooking(mine.bookingId)).total_cents,
    );
    expect(response.status).toBe(200);
    expect((await loadBooking(mine.bookingId)).status).toBe("refunded");
    expect((await loadBooking(other.bookingId)).status).toBe("confirmed");
  });

  it("cancels at once with a full refund inside the free period", async () => {
    const started = await confirmed();
    const booking = await loadBooking(started.bookingId);
    const stale = await cancelWith(started.token, 1);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "moved" });

    const response = await cancelWith(started.token, booking.total_cents);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "cancelled",
      refundCents: booking.total_cents,
      refundDelayed: false,
    });
    expect((await loadBooking(started.bookingId)).status).toBe("refunded");
    expect(await hasClaim(started.bookingId)).toBe(false);
    const [refund] = await refundsFor(started.bookingId);
    expect(refund.status).toBe("succeeded");
    const keys = (await emailsFor(started.bookingId)).map(
      (row) => row.template_key,
    );
    expect(keys).toContain("booking_cancellation");
    expect(keys).toContain("host_booking_cancelled");

    const again = await cancelWith(started.token, booking.total_cents);
    expect(again.status).toBe(409);
    expect(await refundsFor(started.bookingId)).toHaveLength(1);
  });

  it("sends a late cancellation to Yorgos instead", async () => {
    const soon = addDays(new Date().toISOString().slice(0, 10), 13);
    const started = await confirmed({
      checkIn: soon,
      checkOut: addDays(soon, 2),
    });
    const deps = testDeps(fake, roomId);
    const view = await loadGuestView(deps, started.token);
    expect(view?.cancel.route).toBe("host");

    const response = await cancelWith(started.token, 0);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "needs_host" });
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");

    const message = await messageRoute(
      jsonRequest("/api/checkout/guest/message", {
        token: started.token,
        message: "Please can we talk",
        cancelRequest: true,
      }),
    );
    expect(message.status).toBe(200);
    const { rows } = await db.query(
      `select message from public.contact_messages where booking_id = $1`,
      [started.bookingId],
    );
    expect(rows[0].message).toContain("Cancellation request");
    expect(
      (await emailsFor(started.bookingId)).map((row) => row.template_key),
    ).toContain("host_guest_message");
  });

  it("shows nothing owed on a cancelled booking (D24)", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await db.query(`select public.cancel_booking($1, 'test')`, [
        started.bookingId,
      ]);
      const view = await loadGuestView(testDeps(fake, roomId), started.token);
      expect(view?.balanceCents).toBe(0);
      expect(view?.cancel.route).toBe("closed");
    });
  });

  it("the refund failing still cancels, and alerts the host", async () => {
    const started = await confirmed();
    const booking = await loadBooking(started.bookingId);
    fake.failNext("refund", { status: 402 });
    const response = await cancelWith(started.token, booking.total_cents);
    expect(await response.json()).toMatchObject({ refundDelayed: true });

    expect((await loadBooking(started.bookingId)).status).toBe("cancelled");
    const [refund] = await refundsFor(started.bookingId);
    expect(refund.status).toBe("failed");
    expect(
      (await emailsFor(started.bookingId)).map((row) => row.template_key),
    ).toContain("host_payment_failed");
  });
});

describe("refunds", () => {
  it("a card refund goes reserve, Stripe, settle, with a key", async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    const deps = testDeps(fake, roomId);

    const run = await refundShares(deps, started.bookingId, [
      { paymentId: payment.id, amountCents: 500 },
    ]);
    expect(run).toMatchObject({ sentCents: 500, failedCents: 0 });
    const [refund] = await refundsFor(started.bookingId);
    expect(refund).toMatchObject({ status: "succeeded", amount_cents: 500 });
    expect(fake.refundKeys.at(-1)).toBe(`refund:${refund.id}`);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("Stripe refusing releases the reservation", async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    fake.failNext("refund", { status: 402 });
    const run = await refundShares(testDeps(fake, roomId), started.bookingId, [
      { paymentId: payment.id, amountCents: payment.amount_cents },
    ]);
    expect(run.failedCents).toBe(payment.amount_cents);
    expect((await refundsFor(started.bookingId))[0].status).toBe("failed");

    const retry = await refundShares(
      testDeps(fake, roomId),
      started.bookingId,
      [{ paymentId: payment.id, amountCents: payment.amount_cents }],
    );
    expect(retry.sentCents).toBe(payment.amount_cents);
  });

  it("an unclear answer keeps the reservation, and cron finishes it", async () => {
    // Stripe replays even a 500 for its key, so this takes the key's expiry.
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    fake.failNext("refund", { status: 500, type: "api_error" });
    const deps = testDeps(fake, roomId);
    const run = await refundShares(deps, started.bookingId, [
      { paymentId: payment.id, amountCents: 700 },
    ]);
    expect(run.unknownCents).toBe(700);
    expect((await refundsFor(started.bookingId))[0].status).toBe("pending");

    // Too young to touch.
    await resumeStaleRefunds(deps);
    expect((await refundsFor(started.bookingId))[0].status).toBe("pending");

    await db.query(
      `update public.refunds set created_at = now() - interval '1 hour' where booking_id = $1`,
      [started.bookingId],
    );
    await resumeStaleRefunds(deps);
    expect((await refundsFor(started.bookingId))[0].status).toBe("pending");

    fake.forgetIdempotencyKeys();
    await resumeStaleRefunds(deps);
    expect((await refundsFor(started.bookingId))[0].status).toBe("succeeded");
  });

  it("cron finds a refund Stripe made but never answered about", async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    const { rows } = await db.query(
      `select public.reserve_refund($1, $2, 900) as id`,
      [started.bookingId, payment.id],
    );
    await db.query(
      `update public.refunds set created_at = now() - interval '1 hour' where id = $1`,
      [rows[0].id],
    );
    const stripeSide = fake.dashboardRefund(
      started.session.payment_intent!,
      900,
    );
    stripeSide.metadata = { refund_row_id: rows[0].id };
    const before = fake.refunds.size;

    await resumeStaleRefunds(testDeps(fake, roomId));
    expect(fake.refunds.size).toBe(before);
    const [refund] = await refundsFor(started.bookingId);
    expect(refund).toMatchObject({
      status: "succeeded",
      stripe_refund_id: stripeSide.id,
    });
  });

  it("a pending refund stays reserved until Stripe finishes it", async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    fake.refundStatus = "pending";
    try {
      await refundShares(testDeps(fake, roomId), started.bookingId, [
        { paymentId: payment.id, amountCents: 300 },
      ]);
    } finally {
      fake.refundStatus = "succeeded";
    }
    const [row] = await refundsFor(started.bookingId);
    expect(row.status).toBe("pending");
    expect(row.stripe_refund_id).toBeTruthy();

    const stripeSide = fake.refunds.get(row.stripe_refund_id)!;
    stripeSide.status = "succeeded";
    await deliver("refund.updated", stripeSide);
    expect((await refundsFor(started.bookingId))[0].status).toBe("succeeded");

    stripeSide.status = "failed";
    await deliver("refund.updated", stripeSide);
    expect((await refundsFor(started.bookingId))[0].status).toBe("failed");
    expect(
      (await emailsFor(started.bookingId)).map((row2) => row2.template_key),
    ).toContain("host_payment_failed");
  });

  it("records a refund made in the Stripe dashboard, once", async () => {
    const started = await confirmed();
    const refund = fake.dashboardRefund(started.session.payment_intent!, 1200);
    await Promise.all([
      deliver("refund.created", refund),
      deliver("charge.refunded", {
        id: "ch_1",
        object: "charge",
        payment_intent: started.session.payment_intent,
      }),
    ]);
    await deliver("refund.updated", refund);
    const rows = await refundsFor(started.bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_cents: 1200,
      status: "succeeded",
      stripe_refund_id: refund.id,
    });
  });

  it("a refund event ahead of its payment waits for a retry", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const refund = fake.dashboardRefund(session.payment_intent!, 400);
    const eventId = `evt_${randomUUID()}`;

    const early = await deliver("refund.created", refund, eventId);
    expect(early.response.status).toBe(500);

    await deliver("checkout.session.completed", session);
    const late = await deliver("refund.created", refund, eventId);
    expect(late.response.status).toBe(200);
    expect(await refundsFor(started.bookingId)).toHaveLength(1);
  });

  it("ignores refunds on payments that are not ours", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const refund = fake.dashboardRefund(session.payment_intent!, 100);
    fake.clearIntentMetadata(session.payment_intent!);
    const { response } = await deliver("refund.created", refund);
    expect(response.status).toBe(200);
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
  });

  it("alerts the host on a dispute, once", async () => {
    const started = await confirmed();
    const dispute = {
      id: `dp_${randomUUID()}`,
      object: "dispute",
      amount: 5000,
      reason: "fraudulent",
      status: "needs_response",
      payment_intent: started.session.payment_intent,
    };
    await deliver("charge.dispute.created", dispute);
    await deliver("charge.dispute.created", dispute);
    await deliver("charge.dispute.closed", { ...dispute, status: "won" });
    const keys = (await emailsFor(started.bookingId)).map(
      (row) => row.template_key,
    );
    expect(keys.filter((key) => key === "host_dispute_opened")).toHaveLength(1);
    expect(keys).toContain("host_payment_failed");
  });
});

describe("cron", () => {
  const run = (header?: string) =>
    cronRoute(
      new Request(`${SITE_URL}/api/cron/payments`, {
        headers: header ? { authorization: header } : {},
      }),
    );

  it("refuses without the secret", async () => {
    process.env.CRON_SECRET = "pay-test-cron-secret-of-enough-length-ok";
    expect((await run()).status).toBe(401);
    expect((await run("Bearer wrong")).status).toBe(401);
  });

  it("ends an abandoned hold the webhook never reported", async () => {
    const started = await start();
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [started.bookingId],
    );
    const response = await run(`Bearer ${process.env.CRON_SECRET}`);
    expect(response.status).toBe(200);
    expect((await loadBooking(started.bookingId)).status).toBe("expired");
  });
});

describe("reconciliation", () => {
  const age = (session: FakeSession) => {
    session.created = Math.floor(Date.now() / 1000) - 60 * 60;
    return session;
  };

  it("confirms a paid Session whose webhook never came, then alerts", async () => {
    const started = await start();
    age(fake.pay(started.session.id));
    const deps = testDeps(fake, roomId);

    const result = await reconcilePayments(deps);
    expect(result.recovered).toBeGreaterThanOrEqual(1);

    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
    const emails = await emailsFor(started.bookingId);
    const keys = emails.map((row) => row.template_key);
    expect(keys).toContain("booking_confirmation");
    expect(
      emails.filter((row) =>
        /δεν έφτασε στην ιστοσελίδα/.test(String(row.payload.reason)),
      ),
    ).toHaveLength(1);

    await reconcilePayments(deps);
    expect(await paymentsFor(started.bookingId)).toHaveLength(1);
    expect(
      (await emailsFor(started.bookingId)).filter((row) =>
        /δεν έφτασε στην ιστοσελίδα/.test(String(row.payload.reason)),
      ),
    ).toHaveLength(1);
  });

  it("refunds through the same path when the dates have gone", async () => {
    const stay = nextStay();
    const lost = await start(stay);
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [lost.bookingId],
    );
    const rival = await start(stay);
    await paid(rival);

    age(fake.pay(lost.session.id));
    await reconcilePayments(testDeps(fake, roomId));
    const [refund] = await refundsFor(lost.bookingId);
    expect(refund.status).toBe("succeeded");
    expect((await loadBooking(rival.bookingId)).status).toBe("confirmed");
  });

  it("records a balance paid with no webhook", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await balanceRoute(
        jsonRequest("/api/checkout/balance", {
          token: started.token,
          locale: "en",
        }),
      );
      const [open] = balanceSessions(started.bookingId);
      age(fake.pay(open.id));
      await reconcilePayments(testDeps(fake, roomId));
      const rows = await paymentsFor(started.bookingId);
      expect(rows.map((row) => [row.kind, row.status])).toEqual([
        ["deposit", "succeeded"],
        ["balance", "succeeded"],
      ]);
    });
  });

  it("leaves a fresh Session to its webhook", async () => {
    const started = await start();
    fake.pay(started.session.id);
    await reconcilePayments(testDeps(fake, roomId));
    expect((await loadBooking(started.bookingId)).status).toBe(
      "pending_payment",
    );
  });

  it("leaves a payment that is already recorded alone", async () => {
    const started = await confirmed();
    age(started.session);
    await reconcilePayments(testDeps(fake, roomId));
    expect(
      (await emailsFor(started.bookingId)).filter((row) =>
        /δεν έφτασε στην ιστοσελίδα/.test(String(row.payload.reason)),
      ),
    ).toHaveLength(0);
  });

  it("skips anything unpaid or not ours", async () => {
    const unpaid = await start();
    age(fake.pay(unpaid.session.id, { status: "unpaid" }));
    const other = await start();
    age(fake.pay(other.session.id)).metadata = {};
    const result = await reconcilePayments(testDeps(fake, roomId));
    expect(result.recovered).toBe(0);
    expect(await paymentsFor(unpaid.bookingId)).toHaveLength(0);
    expect(await paymentsFor(other.bookingId)).toHaveLength(0);
  });

  it("alerts once on an event stuck for over an hour", async () => {
    const eventId = `evt_${randomUUID()}`;
    await db.query(
      `insert into public.stripe_events (id, type, payload, received_at, error)
       values ($1, 'charge.refunded', '{}', now() - interval '2 hours', 'boom')`,
      [eventId],
    );
    try {
      const deps = testDeps(fake, roomId);
      await reconcilePayments(deps);
      await reconcilePayments(deps);
      const { rows } = await db.query(
        `select count(*)::int as n from public.email_logs where payload->>'reason' like $1`,
        [`%${eventId}%`],
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await db.query(`delete from public.stripe_events where id = $1`, [
        eventId,
      ]);
    }
  });
});

describe("failed refunds", () => {
  const pendingRefund = async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    fake.refundStatus = "pending";
    try {
      await refundShares(testDeps(fake, roomId), started.bookingId, [
        { paymentId: payment.id, amountCents: 300 },
      ]);
    } finally {
      fake.refundStatus = "succeeded";
    }
    const [row] = await refundsFor(started.bookingId);
    return { started, row, refund: fake.refunds.get(row.stripe_refund_id)! };
  };
  const alerts = async (bookingId: string) =>
    (await emailsFor(bookingId)).filter((row) =>
      /επιστροφή απέτυχε/.test(String(row.payload.reason)),
    );

  it("goes straight from pending to failed on refund.failed, and alerts", async () => {
    const { started, refund } = await pendingRefund();
    refund.status = "failed";
    const { response } = await deliver("refund.failed", refund);
    expect(response.status).toBe(200);
    expect((await refundsFor(started.bookingId))[0].status).toBe("failed");
    expect(await alerts(started.bookingId)).toHaveLength(1);
  });

  it("alerts on a dashboard refund that failed, recording nothing", async () => {
    const started = await confirmed();
    const refund = fake.dashboardRefund(
      started.session.payment_intent!,
      500,
      "failed",
    );
    await deliver("refund.failed", refund);
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
    expect(await alerts(started.bookingId)).toHaveLength(1);
  });

  it("the cron job alerts when it finds a refund failed", async () => {
    const { started, refund } = await pendingRefund();
    refund.status = "failed";
    await db.query(
      `update public.refunds set created_at = now() - interval '1 hour' where booking_id = $1`,
      [started.bookingId],
    );
    await resumeStaleRefunds(testDeps(fake, roomId));
    expect((await refundsFor(started.bookingId))[0].status).toBe("failed");
    expect(await alerts(started.bookingId)).toHaveLength(1);
  });

  it("trusts Stripe over a stale event", async () => {
    const { started, refund } = await pendingRefund();
    const stale = { ...refund };
    refund.status = "succeeded";
    await deliver("refund.updated", stale);
    expect((await refundsFor(started.bookingId))[0].status).toBe("succeeded");
  });
});

describe("an email that cannot be stored", () => {
  /** A database where writing certain email rows fails. */
  const failingEmails = (
    shouldFail: (row: Record<string, unknown>) => boolean,
  ) => {
    const deps = testDeps(fake, roomId);
    const realFrom = deps.db.from.bind(deps.db);
    deps.db = new Proxy(deps.db, {
      get(target, property, receiver) {
        if (property !== "from") return Reflect.get(target, property, receiver);
        return (table: string) => {
          const query = realFrom(table as never);
          if (table !== "email_logs") return query;
          return new Proxy(query, {
            get(inner, name, innerReceiver) {
              if (name !== "upsert") {
                return Reflect.get(inner, name, innerReceiver);
              }
              return (rows: unknown, options: never) => {
                const list = (Array.isArray(rows) ? rows : [rows]) as Record<
                  string,
                  unknown
                >[];
                if (list.some(shouldFail)) {
                  return {
                    select: async () => ({
                      data: null,
                      error: { message: "db_down" },
                    }),
                  };
                }
                return (
                  inner as never as {
                    upsert: (a: unknown, b: never) => unknown;
                  }
                ).upsert(rows, options);
              };
            },
          });
        };
      },
    });
    return deps;
  };

  const webhook = (
    deps: ReturnType<typeof testDeps>,
    session: FakeSession,
    eventId: string,
  ) => {
    const { payload, signature } = fake.event(
      "checkout.session.completed",
      session,
      eventId,
    );
    return handleStripeWebhook(deps, payload, signature);
  };

  it("fails the event, and the retry finishes it", async () => {
    const started = await start();
    const session = fake.pay(started.session.id);
    const eventId = `evt_${randomUUID()}`;

    const first = await webhook(
      failingEmails(() => true),
      session,
      eventId,
    );
    expect(first.status).toBe(500);
    const { rows } = await db.query(
      `select processed_at, error from public.stripe_events where id = $1`,
      [eventId],
    );
    expect(rows[0].processed_at).toBeNull();
    expect(rows[0].error).toMatch(/email_not_stored/);
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");

    const second = await webhook(testDeps(fake, roomId), session, eventId);
    expect(second.status).toBe(200);
    const keys = (await emailsFor(started.bookingId)).map(
      (row) => row.template_key,
    );
    expect(keys.filter((key) => key === "booking_confirmation")).toHaveLength(
      1,
    );
  });

  it("does not fail the event when there is simply no recipient", async () => {
    const started = await start();
    await db.query(
      `update public.bookings set guest_email = null where id = $1`,
      [started.bookingId],
    );
    const session = fake.pay(started.session.id);
    const answer = await webhook(
      testDeps(fake, roomId),
      session,
      `evt_${randomUUID()}`,
    );
    expect(answer.status).toBe(200);
  });

  it("does not swallow a failed apology", async () => {
    const stay = nextStay();
    const lost = await start(stay);
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [lost.bookingId],
    );
    await paid(await start(stay));

    const session = fake.pay(lost.session.id);
    const eventId = `evt_${randomUUID()}`;
    const first = await webhook(
      failingEmails((row) => row.template_key === "host_message"),
      session,
      eventId,
    );
    expect(first.status).toBe(500);

    const second = await webhook(testDeps(fake, roomId), session, eventId);
    expect(second.status).toBe(200);
    expect(await refundsFor(lost.bookingId)).toHaveLength(1);
    expect(
      (await emailsFor(lost.bookingId)).map((row) => row.template_key),
    ).toContain("host_message");
  });
});

describe("balance Sessions", () => {
  const open = async (token: string, locale = "en") =>
    balanceRoute(jsonRequest("/api/checkout/balance", { token, locale }));

  it("gives two tabs in two languages one Session", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      const answers = await Promise.all([
        open(started.token, "en"),
        open(started.token, "el"),
      ]);
      const urls = await Promise.all(answers.map((a) => a.json()));
      expect(answers.map((a) => a.status)).toEqual([200, 200]);
      expect(urls[0].url).toBe(urls[1].url);

      const rows = (await paymentsFor(started.bookingId)).filter(
        (row) => row.status === "pending",
      );
      expect(rows).toHaveLength(1);
      expect(
        balanceSessions(started.bookingId).filter((s) => s.status === "open"),
      ).toHaveLength(1);
    });
  });

  it("closes an open Session when the balance changes", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await open(started.token);
      const [session] = balanceSessions(started.bookingId);
      await closeBalanceSessions(testDeps(fake, roomId), started.bookingId);
      expect(session.status).toBe("expired");
      expect(
        (await paymentsFor(started.bookingId)).filter(
          (row) => row.status === "pending",
        ),
      ).toHaveLength(0);
    });
  });

  it("stops a cancellation when a balance has just been paid", async () => {
    const started = await confirmed();
    const total = (await loadBooking(started.bookingId)).total_cents;
    await db.query(
      `update public.bookings set total_cents = total_cents + 5000 where id = $1`,
      [started.bookingId],
    );
    await open(started.token);
    const [session] = balanceSessions(started.bookingId);
    fake.pay(session.id); // Paid, webhook on its way.

    const response = await cancelRoute(
      jsonRequest("/api/checkout/guest/cancel", {
        token: started.token,
        expectedRefundCents: total,
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "moved" });
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
  });

  it("closes an open balance page before cancelling", async () => {
    const started = await confirmed();
    const total = (await loadBooking(started.bookingId)).total_cents;
    await db.query(
      `update public.bookings set total_cents = total_cents + 5000 where id = $1`,
      [started.bookingId],
    );
    await open(started.token);
    const [session] = balanceSessions(started.bookingId);

    const response = await cancelRoute(
      jsonRequest("/api/checkout/guest/cancel", {
        token: started.token,
        expectedRefundCents: total,
      }),
    );
    expect(response.status).toBe(200);
    expect(session.status).toBe("expired");
  });
});

describe("disputes", () => {
  const dispute = (intent: string, overrides: object = {}) => ({
    id: `dp_${randomUUID()}`,
    object: "dispute",
    amount: 5000,
    reason: "fraudulent",
    status: "needs_response",
    payment_intent: intent,
    ...overrides,
  });

  it("marks the payment and sends the guest to Yorgos", async () => {
    const started = await confirmed();
    const [before] = await paymentsFor(started.bookingId);
    await deliver(
      "charge.dispute.created",
      dispute(started.session.payment_intent!),
    );
    const [payment] = await paymentsFor(started.bookingId);
    expect(payment.status).toBe("disputed");

    const view = await loadGuestView(testDeps(fake, roomId), started.token);
    expect(view?.cancel.route).toBe("host");
    const response = await cancelRoute(
      jsonRequest("/api/checkout/guest/cancel", {
        token: started.token,
        expectedRefundCents: before.amount_cents,
      }),
    );
    expect(await response.json()).toEqual({ error: "needs_host" });
    expect((await loadBooking(started.bookingId)).status).toBe("confirmed");
  });

  it("restores the payment when the dispute is won", async () => {
    const started = await confirmed();
    const opened = dispute(started.session.payment_intent!);
    await deliver("charge.dispute.created", opened);
    await deliver("charge.dispute.closed", { ...opened, status: "won" });
    const [payment] = await paymentsFor(started.bookingId);
    expect(payment.status).toBe("succeeded");
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
  });

  it("records the money as gone when it is lost, once", async () => {
    const started = await confirmed();
    const opened = dispute(started.session.payment_intent!);
    await deliver("charge.dispute.created", opened);
    const closed = { ...opened, status: "lost" };
    await deliver("charge.dispute.closed", closed);
    await deliver("charge.dispute.closed", closed);
    const rows = await refundsFor(started.bookingId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      amount_cents: 5000,
      status: "succeeded",
      stripe_refund_id: opened.id,
    });
  });

  it("an inquiry that closes takes no money", async () => {
    const started = await confirmed();
    const opened = dispute(started.session.payment_intent!, {
      status: "warning_needs_response",
    });
    await deliver("charge.dispute.created", opened);
    await deliver("charge.dispute.closed", {
      ...opened,
      status: "warning_closed",
    });
    expect(await refundsFor(started.bookingId)).toHaveLength(0);
  });

  it("releases the reservation when Stripe refuses a disputed charge", async () => {
    const started = await confirmed();
    const [payment] = await paymentsFor(started.bookingId);
    fake.disputed.add(started.session.payment_intent!);
    const run = await refundShares(testDeps(fake, roomId), started.bookingId, [
      { paymentId: payment.id, amountCents: 500 },
    ]);
    expect(run.failedCents).toBe(500);
    expect((await refundsFor(started.bookingId))[0].status).toBe("failed");
  });
});

describe("same-key refunds in flight", () => {
  it("survives Stripe's 409 and still refunds once", async () => {
    const stay = nextStay();
    const lost = await start(stay);
    await db.query(
      `update public.holds set expires_at = now() - interval '1 minute' where booking_id = $1`,
      [lost.bookingId],
    );
    await paid(await start(stay));
    const session = fake.pay(lost.session.id);

    fake.refundDelayMs = 200;
    const before = fake.refunds.size;
    try {
      const results = await Promise.all(
        Array.from({ length: 3 }, () =>
          deliver("checkout.session.completed", session),
        ),
      );
      for (const { response } of results) {
        expect([200, 500]).toContain(response.status);
      }
    } finally {
      fake.refundDelayMs = 0;
    }
    await deliver("checkout.session.completed", session);
    expect(fake.refunds.size).toBe(before + 1);
    const rows = await refundsFor(lost.bookingId);
    expect(rows.filter((row) => row.status !== "failed")).toHaveLength(1);
    expect(rows.find((row) => row.status !== "failed").status).toBe(
      "succeeded",
    );
  });
});

describe("what is owed (O1)", () => {
  it("a goodwill refund does not bring a balance request back", async () => {
    await withPaymentRules(DEPOSIT, async () => {
      const started = await confirmed();
      await balanceRoute(
        jsonRequest("/api/checkout/balance", {
          token: started.token,
          locale: "en",
        }),
      );
      const [open] = balanceSessions(started.bookingId);
      await deliver("checkout.session.completed", fake.pay(open.id));

      const [deposit] = await paymentsFor(started.bookingId);
      await refundShares(testDeps(fake, roomId), started.bookingId, [
        { paymentId: deposit.id, amountCents: 1000 },
      ]);

      const booking = await loadBooking(started.bookingId);
      const dueOn = booking.price_breakdown.balanceDueOn as string;
      await sendScheduledEmails(client, new Date(`${dueOn}T12:00:00Z`), {
        bookingIds: [started.bookingId],
      });
      expect(
        (await emailsFor(started.bookingId)).map((row) => row.template_key),
      ).not.toContain("balance_request");
    });
  });
});

describe("Turnstile on checkout", () => {
  const siteverify = vi.fn();
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
    process.env.TURNSTILE_SECRET_KEY = "secret-key";
    siteverify.mockReset();
    vi.stubGlobal("fetch", (url: string, init: RequestInit) =>
      String(url).includes("challenges.cloudflare.com")
        ? Promise.resolve(Response.json({ success: siteverify() }))
        : realFetch(url, init),
    );
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  const siteTries = async () =>
    (
      await db.query(
        `select count(*)::int as n from public.admin_attempts where scope = 'pay_checkout_site'`,
      )
    ).rows[0].n;

  it("refuses a failed check before anything is held", async () => {
    siteverify.mockReturnValue(false);
    const before = fake.creates.length;
    const response = await checkout({
      ...nextStay(),
      ...guestDetails(),
      turnstileToken: "bad",
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "verification_failed" });
    expect(fake.creates.length).toBe(before);
    // A bot that fails the check cannot use up the limit real guests share.
    expect(await siteTries()).toBe(0);
  });

  it("refuses no token at all", async () => {
    const response = await checkout({ ...nextStay(), ...guestDetails() });
    expect(response.status).toBe(403);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("lets a passed check through", async () => {
    siteverify.mockReturnValue(true);
    const response = await checkout({
      ...nextStay(),
      ...guestDetails(),
      turnstileToken: "good",
    });
    expect(response.status).toBe(200);
    expect(await siteTries()).toBe(1);
  });

  it("closes checkout with only one key set", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    const response = await checkout({ ...nextStay(), ...guestDetails() });
    expect(response.status).toBe(503);
  });
});

describe("quotes and availability", () => {
  const quote = (body: unknown, headers?: Record<string, string>) =>
    quoteRoute(jsonRequest("/api/checkout/quote", body, headers));

  it("prices on the server and never says why dates are taken", async () => {
    const stay = nextStay();
    const free = await quote({ ...stay, adults: 2, children: 0, locale: "el" });
    const priced = await free.json();
    expect(priced.ok).toBe(true);
    expect(priced.totalCents).toBeGreaterThan(0);
    expect(priced.lines[0].label).toBe("Διαμονή");
    expect(priced.paymentsOpen).toBe(true);

    await db.query(
      `select public.create_block($1, $2::date, $3::date, 'owner_use', 'private note')`,
      [roomId, stay.checkIn, stay.checkOut],
    );
    try {
      const taken = await quote({
        ...stay,
        adults: 2,
        children: 0,
        locale: "en",
      });
      expect(await taken.json()).toEqual({
        ok: false,
        reason: "dates_unavailable",
      });

      const calendar = await availabilityRoute(
        new Request(`${SITE_URL}/api/checkout/availability`, {
          headers: { "x-forwarded-for": address() },
        }),
      );
      const body = await calendar.text();
      expect(body).toContain(stay.checkIn);
      expect(body).not.toContain("private note");
      expect(body).not.toContain("owner_use");
      expect(calendar.headers.get("cache-control")).toContain("no-store");
    } finally {
      await db.query(
        `delete from public.availability_blocks where room_id = $1`,
        [roomId],
      );
    }
  });

  it("names the minimum stay", async () => {
    const stay = nextStay(2);
    await db.query(
      `insert into public.restrictions (room_id, start_date, end_date, min_stay) values ($1, $2, $3, 5)`,
      [roomId, stay.checkIn, stay.checkOut],
    );
    const answer = await quote({
      ...stay,
      adults: 2,
      children: 0,
      locale: "en",
    });
    expect(await answer.json()).toEqual({
      ok: false,
      reason: "below_min_stay",
      minNights: 5,
    });
    await db.query(`delete from public.restrictions where room_id = $1`, [
      roomId,
    ]);
  });

  it("refuses a stay past the longest online stay", async () => {
    const stay = nextStay(31);
    const answer = await quote({
      ...stay,
      adults: 2,
      children: 0,
      locale: "en",
    });
    expect(await answer.json()).toEqual({
      ok: false,
      reason: "above_max_stay",
      maxNights: 30,
    });
    const thirty = nextStay(30);
    const fine = await quote({
      ...thirty,
      adults: 2,
      children: 0,
      locale: "en",
    });
    expect(await fine.json()).toMatchObject({ ok: true });
  });

  it("answers a guessed promo the same way once limited", async () => {
    const code = `PAY${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.promo_codes (code, kind, value) values ($1, 'percent', 1000)`,
      [code],
    );
    try {
      const from = { "x-forwarded-for": "203.0.113.88" };
      const stay = { ...nextStay(), adults: 2, children: 0, locale: "en" };
      const ask = async (promoCode: string) =>
        (await quote({ ...stay, promoCode }, from)).json();

      expect((await ask(code)).promoApplied).toBe(true);
      for (let i = 0; i < 10; i += 1) {
        expect((await ask(`WRONG${i}`)).promoRejected).toBe(true);
      }
      const limited = await ask(code);
      expect(limited).toMatchObject({
        ok: true,
        promoApplied: false,
        promoRejected: true,
      });
    } finally {
      await db.query(`delete from public.promo_codes where code = $1`, [code]);
    }
  });

  it("limits quotes from one address", async () => {
    const from = { "x-forwarded-for": "203.0.113.77" };
    const stay = nextStay();
    let last = 200;
    for (let i = 0; i < 62 && last === 200; i += 1) {
      last = (
        await quote({ ...stay, adults: 2, children: 0, locale: "en" }, from)
      ).status;
    }
    expect(last).toBe(429);
  });
});
