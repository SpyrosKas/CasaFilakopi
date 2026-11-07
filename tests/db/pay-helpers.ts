import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { addDays, athensDate } from "@/lib/domain/dates";
import type { PaymentDeps } from "@/lib/payments/deps";
import {
  FAKE_PUBLISHABLE_KEY,
  FAKE_SECRET_KEY,
  FAKE_WEBHOOK_SECRET,
  FakeStripe,
} from "../support/fake-stripe";
import { db } from "./helpers";

// Shared by the payment tests: the real routes, the real database functions,
// and a local fake of Stripe reached through the real SDK. The database is
// shared with other tracks, so these tests have their own room and remove what
// they make.

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; SECRET_KEY: string; PUBLISHABLE_KEY: string };

if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) {
  throw new Error("Payment database tests run against local Supabase only");
}

export const SITE_URL = "http://pay-test.example";
export const GUEST_SECRET = "pay-test-guest-token-secret-of-enough-length";

export const client = createClient<Database>(
  status.API_URL,
  status.SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

export function useRouteEnv(fake: FakeStripe, roomId: string) {
  Object.assign(process.env, {
    NEXT_PUBLIC_SITE_URL: SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
    GUEST_TOKEN_SECRET: GUEST_SECRET,
    STRIPE_SECRET_KEY: FAKE_SECRET_KEY,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: FAKE_PUBLISHABLE_KEY,
    STRIPE_WEBHOOK_SECRET: FAKE_WEBHOOK_SECRET,
    STRIPE_API_HOST: "127.0.0.1",
    STRIPE_API_PORT: String(fake.port),
    STRIPE_API_PROTOCOL: "http",
    PAY_TEST_ROOM_ID: roomId,
  });
}

export function testDeps(fake: FakeStripe, roomId: string): PaymentDeps {
  return {
    db: client,
    stripe: fake.client(),
    webhookSecret: FAKE_WEBHOOK_SECRET,
    guestTokenSecret: GUEST_SECRET,
    siteUrl: SITE_URL,
    now: () => new Date(),
    roomId,
    queued: [],
  };
}

let nextOffset = 40;

/** Far enough out for the free-cancellation tier, each stay on its own dates. */
export function nextStay(nights = 3) {
  const today = athensDate(new Date());
  const checkIn = addDays(today, nextOffset);
  nextOffset += nights + 1;
  return { checkIn, checkOut: addDays(checkIn, nights) };
}

export const address = () => `198.51.100.${Math.floor(Math.random() * 250)}`;

export function guestDetails(overrides: Record<string, unknown> = {}) {
  return {
    adults: 2,
    children: 0,
    locale: "en",
    name: "Pat Example",
    email: `pay-db-${randomUUID()}@example.test`,
    phone: "+30 690 000 0000",
    country: "Greece",
    arrivalTime: "16:30",
    specialRequests: "",
    marketing: false,
    acceptTerms: true,
    ...overrides,
  };
}

export function jsonRequest(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(`${SITE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: SITE_URL,
      "x-forwarded-for": address(),
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

export async function loadBooking(id: string) {
  const { rows } = await db.query(
    `select * from public.bookings where id = $1`,
    [id],
  );
  return rows[0];
}

export async function hasClaim(id: string) {
  const { rows } = await db.query(
    `select count(*)::int as n from public.inventory_claims where booking_id = $1`,
    [id],
  );
  return rows[0].n > 0;
}

export async function emailsFor(bookingId: string) {
  const { rows } = await db.query(
    `select template_key, recipient, payload from public.email_logs where booking_id = $1`,
    [bookingId],
  );
  return rows as {
    template_key: string;
    recipient: string;
    payload: Record<string, unknown>;
  }[];
}

export async function paymentsFor(bookingId: string) {
  const { rows } = await db.query(
    `select * from public.payments where booking_id = $1 order by created_at`,
    [bookingId],
  );
  return rows;
}

export async function refundsFor(bookingId: string) {
  const { rows } = await db.query(
    `select * from public.refunds where booking_id = $1 order by created_at`,
    [bookingId],
  );
  return rows;
}

export async function cleanUp(roomId: string, eventsSince: Date) {
  const { rows } = await db.query(
    `select id, guest_id, promo_code from public.bookings where room_id = $1`,
    [roomId],
  );
  const ids = rows.map((row) => row.id);
  const guests = rows.map((row) => row.guest_id);
  await db.query(`delete from public.email_logs where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(
    `delete from public.email_logs where payload->>'reason' is not null
       and booking_id is null and created_at >= $1`,
    [eventsSince],
  );
  await db.query(
    `delete from public.contact_messages where booking_id = any($1)`,
    [ids],
  );
  await db.query(`delete from public.consent_log where subject = any($1)`, [
    ids.map(String),
  ]);
  await db.query(`delete from public.refunds where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(`delete from public.payments where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(`delete from public.bookings where id = any($1)`, [ids]);
  await db.query(`delete from public.guests where id = any($1)`, [guests]);
  await db.query(`delete from public.rooms where id = $1`, [roomId]);
  await db.query(`delete from public.stripe_events where received_at >= $1`, [
    eventsSince,
  ]);
  await db.query(
    `delete from public.admin_attempts where scope like 'pay\\_%'`,
  );
}
