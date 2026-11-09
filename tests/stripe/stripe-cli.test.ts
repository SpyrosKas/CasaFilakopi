import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => {},
}));
vi.mock("@/lib/email", () => ({
  kickEmails: async () => {},
  queueEmail: async () => ({ ok: true, ids: [], duplicate: false }),
}));

import type { PaymentDeps } from "@/lib/payments/deps";
import { startCheckout } from "@/lib/payments/checkout";
import { refundShares } from "@/lib/payments/refunds";
import { checkoutSchema } from "@/lib/payments/schemas";
import { handleStripeWebhook } from "@/lib/payments/webhook";
import type { FakeStripe } from "../support/fake-stripe";
import { createRoom, db } from "../db/helpers";
import {
  cleanUp,
  client,
  GUEST_SECRET,
  guestDetails,
  hasClaim,
  loadBooking,
  nextStay,
  paymentsFor,
  refundsFor,
  SITE_URL,
  useRouteEnv,
} from "../db/pay-helpers";

// QA-04: the webhook against real Stripe. Real test-mode objects, real events,
// signed by Stripe and delivered by `stripe listen` to the real handler, which
// writes to the local database. No card is typed anywhere: payments use
// Stripe's test tokens through the API.
//
// It must run in a Stripe sandbox of its own. Events go to every endpoint on
// the account, so in the account staging uses, staging would receive bookings
// it has never seen and alert Yorgos. The suite refuses an account that has
// any webhook endpoint.
//
// The sandbox's secret key comes from STRIPE_SANDBOX_SECRET_KEY or from the
// macOS Keychain item "casa-filakopi-stripe-sandbox". It is never printed.

const KEYCHAIN_ITEM = "casa-filakopi-stripe-sandbox";
const EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.created",
  "refund.updated",
  "refund.failed",
  "charge.dispute.created",
  "charge.dispute.closed",
];

function sandboxKey(): string {
  const fromEnv = process.env.STRIPE_SANDBOX_SECRET_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", KEYCHAIN_ITEM, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {
    return "";
  }
}

interface Delivery {
  id: string;
  type: string;
  status: number;
  body: Record<string, unknown>;
  raw: string;
  signature: string;
}

const key = sandboxKey();
const startedAt = new Date();
const deliveries: Delivery[] = [];
let stripe: Stripe;
let deps: PaymentDeps;
let roomId: string;
let server: Server;
let webhookUrl: string;
let listener: ChildProcess | undefined;

async function until<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
  timeoutMs = 45_000,
): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

function startListener(env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  const child = spawn(
    "stripe",
    ["listen", "--forward-to", webhookUrl, "--events", EVENTS.join(",")],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("stripe listen did not get ready"));
    }, 30_000);
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes("Ready!")) {
        clearTimeout(timer);
        resolve(child);
      }
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`stripe listen exited with ${code}`));
    });
  });
}

function startServer(): Promise<Server> {
  const http = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const signature = String(request.headers["stripe-signature"] ?? "");
      const { status, body } = await handleStripeWebhook(
        deps,
        raw,
        signature || null,
      );
      try {
        const event = JSON.parse(raw) as { id: string; type: string };
        deliveries.push({ ...event, status, body, raw, signature });
      } catch {
        // Not JSON: refused above, nothing to record.
      }
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  return new Promise((resolve) =>
    http.listen(0, "127.0.0.1", () => resolve(http)),
  );
}

async function sessionOf(bookingId: string): Promise<Stripe.Checkout.Session> {
  const { rows } = await db.query(
    `select stripe_checkout_session_id from public.holds where booking_id = $1`,
    [bookingId],
  );
  return stripe.checkout.sessions.retrieve(rows[0].stripe_checkout_session_id);
}

/** A held booking with an open Checkout Session at Stripe. */
async function hold() {
  const details = guestDetails();
  const input = checkoutSchema.parse({ ...nextStay(), ...details });
  const result = await startCheckout(deps, input, undefined);
  expect(result.kind).toBe("redirect");
  const { rows } = await db.query(
    `select b.id from public.bookings b join public.guests g on g.id = b.guest_id
      where b.room_id = $1 and g.email = $2`,
    [roomId, details.email],
  );
  const bookingId = rows[0].id as string;
  return {
    bookingId,
    email: details.email,
    session: await sessionOf(bookingId),
  };
}

/** What the guest does on Stripe's page, through the API. */
async function pay(
  session: Stripe.Checkout.Session,
  email: string,
  token = "tok_visa",
) {
  await stripe.rawRequest("GET", `/v1/payment_pages/${session.id}`);
  const method = await stripe.paymentMethods.create({
    type: "card",
    card: { token },
    billing_details: {
      email,
      name: "Pat Example",
      address: { country: "GR" },
    },
  });
  await stripe.rawRequest("POST", `/v1/payment_pages/${session.id}/confirm`, {
    payment_method: method.id,
    expected_amount: session.amount_total,
  });
}

async function paidBooking(token?: string) {
  const held = await hold();
  await pay(held.session, held.email, token);
  const booking = await until(async () => {
    const row = await loadBooking(held.bookingId);
    return row.status === "confirmed" && row;
  }, "the booking to confirm");
  const [payment] = await paymentsFor(held.bookingId);
  return { ...held, booking, payment };
}

async function eventRows(types: string[], since: Date) {
  const { rows } = await db.query(
    `select id, type, processed_at, error from public.stripe_events
      where type = any($1) and received_at >= $2`,
    [types, since],
  );
  return rows as {
    id: string;
    type: string;
    processed_at: Date | null;
    error: string | null;
  }[];
}

describe.skipIf(!key)("Stripe webhooks through the Stripe CLI", () => {
  beforeAll(async () => {
    if (!/^(sk|rk)_test_/.test(key)) {
      throw new Error("The sandbox key must be a test-mode key");
    }
    stripe = new Stripe(key, { telemetry: false, maxNetworkRetries: 2 });
    const endpoints = await stripe.webhookEndpoints.list({ limit: 1 });
    if (endpoints.data.length > 0) {
      throw new Error(
        "This Stripe account sends events to a website. Use a sandbox with no webhook endpoints, so staging never sees these test bookings.",
      );
    }

    roomId = await createRoom();
    useRouteEnv({ port: 0 } as FakeStripe, roomId);
    delete process.env.STRIPE_API_HOST;
    delete process.env.STRIPE_API_PORT;
    delete process.env.STRIPE_API_PROTOCOL;

    server = await startServer();
    webhookUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/webhook`;

    const env = { ...process.env, STRIPE_API_KEY: key };
    const webhookSecret = execFileSync("stripe", ["listen", "--print-secret"], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    expect(webhookSecret).toMatch(/^whsec_/);

    deps = {
      db: client,
      stripe,
      webhookSecret,
      guestTokenSecret: GUEST_SECRET,
      siteUrl: SITE_URL,
      now: () => new Date(),
      roomId,
      queued: [],
    };
    listener = await startListener(env);
    vi.spyOn(console, "error").mockImplementation(() => {});
  }, 90_000);

  afterAll(async () => {
    listener?.kill();
    await new Promise((resolve) => server?.close(resolve));
    if (roomId) await cleanUp(roomId, startedAt);
    await db.end();
  });

  it("confirms a booking from Stripe's signed checkout.session.completed", async () => {
    const since = new Date();
    const { session, booking, payment } = await paidBooking();
    const paid = await stripe.checkout.sessions.retrieve(session.id);

    expect(paid.payment_status).toBe("paid");
    expect(payment.status).toBe("succeeded");
    expect(payment.stripe_payment_intent_id).toBe(paid.payment_intent);
    expect(payment.amount_cents).toBe(paid.amount_total);
    expect(booking.total_cents).toBeGreaterThanOrEqual(payment.amount_cents);
    expect(await hasClaim(booking.id)).toBe(true);

    const [event] = await eventRows(["checkout.session.completed"], since);
    expect(event.processed_at).not.toBeNull();
    expect(event.error).toBeNull();
  });

  it("ignores a repeat of the same signed event", async () => {
    const { bookingId } = await paidBooking();
    const original = deliveries.find(
      (d) =>
        d.type === "checkout.session.completed" &&
        d.raw.includes(bookingId) &&
        d.status === 200,
    )!;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "stripe-signature": original.signature },
      body: original.raw,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ duplicate: true });
    expect(await paymentsFor(bookingId)).toHaveLength(1);
  });

  it("refuses an event whose body was changed after signing", async () => {
    const original = deliveries.find((d) => d.status === 200)!;
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "stripe-signature": original.signature },
      body: original.raw.replace('"livemode": false', '"livemode": true'),
    });
    expect(response.status).toBe(400);
  });

  it("frees the dates when Stripe expires the Checkout Session", async () => {
    const { bookingId, session } = await hold();
    expect(await hasClaim(bookingId)).toBe(true);

    await stripe.checkout.sessions.expire(session.id);
    await until(async () => !(await hasClaim(bookingId)), "the hold to go");
    expect(["expired", "cancelled"]).toContain(
      (await loadBooking(bookingId)).status,
    );
  });

  it("settles a refund from Admin once, through reserve, Stripe and its events", async () => {
    const since = new Date();
    const { bookingId, payment } = await paidBooking();

    const run = await refundShares(deps, bookingId, [
      { paymentId: payment.id, amountCents: 5000 },
    ]);
    expect(run.failedCents).toBe(0);
    expect(run.unknownCents).toBe(0);

    await until(async () => {
      const events = await eventRows(
        ["refund.created", "charge.refunded"],
        since,
      );
      return events.length >= 2 && events.every((e) => e.processed_at);
    }, "the refund events");
    const refunds = await refundsFor(bookingId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      amount_cents: 5000,
      status: "succeeded",
    });
    expect(refunds[0].stripe_refund_id).toMatch(/^re_/);
    const errors = await eventRows(EVENTS, since);
    expect(errors.filter((e) => e.error)).toEqual([]);
  });

  it("records a refund made in the Stripe dashboard", async () => {
    const { bookingId, payment } = await paidBooking();
    const refund = await stripe.refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: 1000,
    });

    const row = await until(async () => {
      const rows = await refundsFor(bookingId);
      return rows.find((r) => r.stripe_refund_id === refund.id);
    }, "the dashboard refund");
    expect(row).toMatchObject({ amount_cents: 1000, status: "succeeded" });
  });

  it("marks the payment disputed when the card holder disputes it", async () => {
    const { bookingId } = await paidBooking("tok_createDispute");
    await until(async () => {
      const [payment] = await paymentsFor(bookingId);
      return payment.status === "disputed";
    }, "the dispute");
  });
});
