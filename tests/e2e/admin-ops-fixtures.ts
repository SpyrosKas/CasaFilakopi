import { randomUUID } from "node:crypto";
import { eachNight } from "@/lib/domain/dates";
import { db } from "./admin-helpers";

// Stays written straight to the shared test database. Most sit in a closed
// room of their own, which no public page or other track can see, so a stay
// on today's date cannot collide with anyone. Whatever goes through a real
// action needs the house itself, on dates far enough off to be free. Each spec
// picks its own year, and everything made here is removed by removeFixtures.

export const HOUSE = "00000000-0000-4000-8000-000000000001";

export const FULL_REFUND_RULES = {
  payment: { mode: "full", deposit: null, balanceDaysBefore: 0 },
  cancellation: {
    isNonRefundable: false,
    tiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 10, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  },
  capturedAt: "2019-01-01T00:00:00.000Z",
};

const bookings = new Set<string>();
const rooms = new Set<string>();
const contactMessages = new Set<string>();

export interface FixtureRoom {
  id: string;
  airbnb: string;
  bookingCom: string;
}

export async function createFixtureRoom(): Promise<FixtureRoom> {
  const id = randomUUID();
  rooms.add(id);
  await db.query(
    `insert into public.rooms
       (id, slug, name, max_adults, base_occupancy, base_price_cents, is_active)
     values ($1, $2, '{"en":"Test room"}', 4, 2, 10000, false)`,
    [id, `ops-${id}`],
  );
  const { rows } = await db.query(
    `insert into public.external_calendars (room_id, channel)
     values ($1, 'airbnb'), ($1, 'booking_com')
     returning id, channel`,
    [id],
  );
  const calendar = (channel: string) =>
    rows.find((row) => row.channel === channel).id as string;
  return {
    id,
    airbnb: calendar("airbnb"),
    bookingCom: calendar("booking_com"),
  };
}

export interface BookingFields {
  roomId: string;
  checkIn: string;
  checkOut: string;
  status?: string;
  source?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  totalCents?: number;
  nightCents?: number;
  notes?: string | null;
  rules?: unknown;
  confirmedAt?: string;
  cancelledAt?: string | null;
  locale?: string;
}

const HOLDS_THE_HOUSE = ["confirmed", "checked_in", "completed"];

export async function addBooking(fields: BookingFields): Promise<string> {
  const id = randomUUID();
  bookings.add(id);
  const status = fields.status ?? "confirmed";
  const total = fields.totalCents ?? 50000;
  const breakdown = {
    currency: "EUR",
    nights: eachNight(fields.checkIn, fields.checkOut).map((night) => ({
      night,
      cents: fields.nightCents ?? 10000,
    })),
    lines: [
      {
        kind: "accommodation",
        label: { en: "Accommodation" },
        quantity: 1,
        unitCents: total,
        totalCents: total,
      },
    ],
    totalCents: total,
    dueNowCents: 0,
    balanceCents: total,
    balanceDueOn: null,
    promoCode: null,
  };
  const guest = await db.query(
    `insert into public.guests (full_name) values ($1) returning id`,
    [fields.name ?? "Test Guest"],
  );
  await db.query(
    `insert into public.bookings (
       id, reference, room_id, guest_id, status, source, check_in, check_out,
       adults, guest_name, guest_email, guest_phone, price_breakdown,
       total_cents, due_now_cents, rules_snapshot, internal_notes,
       confirmed_at, cancelled_at, locale
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, 2, $9, $10, $11, $12::jsonb, $13, 0,
       $14::jsonb, $15, $16, $17, $18
     )`,
    [
      id,
      `E2E-${id.slice(0, 13)}`,
      fields.roomId,
      guest.rows[0].id,
      status,
      fields.source ?? "direct",
      fields.checkIn,
      fields.checkOut,
      fields.name ?? "Test Guest",
      fields.email === undefined ? `ops-${id}@example.test` : fields.email,
      fields.phone === undefined ? "+30 693 111 2222" : fields.phone,
      JSON.stringify(breakdown),
      total,
      JSON.stringify(fields.rules ?? FULL_REFUND_RULES),
      fields.notes ?? null,
      fields.confirmedAt ?? new Date().toISOString(),
      fields.cancelledAt ?? null,
      fields.locale ?? "en",
    ],
  );
  if (HOLDS_THE_HOUSE.includes(status)) {
    await db.query(
      `insert into public.inventory_claims (room_id, stay, kind, booking_id)
       values ($1, daterange($2, $3), 'booking', $4)`,
      [fields.roomId, fields.checkIn, fields.checkOut, id],
    );
  }
  return id;
}

export async function addPayment(
  bookingId: string,
  amountCents: number,
  fields: { at?: string; status?: string; method?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.payments (booking_id, kind, method, status, amount_cents, paid_at)
     values ($1, 'full', $2, $3, $4, $5) returning id`,
    [
      bookingId,
      fields.method ?? "cash",
      fields.status ?? "succeeded",
      amountCents,
      fields.at ?? new Date().toISOString(),
    ],
  );
  return rows[0].id;
}

export async function addRefund(
  bookingId: string,
  paymentId: string,
  amountCents: number,
  at: string,
): Promise<void> {
  await db.query(
    `insert into public.refunds (booking_id, payment_id, amount_cents, status, created_at)
     values ($1, $2, $3, 'succeeded', $4)`,
    [bookingId, paymentId, amountCents, at],
  );
}

export async function addExternal(
  calendarId: string,
  start: string,
  end: string,
  fields: { amountCents?: number; createdAt?: string } = {},
): Promise<string> {
  const { rows } = await db.query(
    `select public.upsert_external_event($1, $2, $3, $4, 'Reserved') as result`,
    [calendarId, randomUUID(), start, end],
  );
  const id = rows[0].result.event_id as string;
  await db.query(
    `update public.external_events set amount_cents = $2,
       created_at = coalesce($3, created_at) where id = $1`,
    [id, fields.amountCents ?? null, fields.createdAt ?? null],
  );
  return id;
}

export async function addMessage(fields: {
  name: string;
  email: string;
  message: string;
}): Promise<string> {
  const { rows } = await db.query(
    `insert into public.contact_messages (name, email, message)
     values ($1, $2, $3) returning id`,
    [fields.name, fields.email, fields.message],
  );
  contactMessages.add(rows[0].id);
  return rows[0].id;
}

/** A booking made through a real action still has to go at the end. */
export function trackBooking(id: string): void {
  bookings.add(id);
}

export async function removeFixtures(): Promise<void> {
  const ids = [...bookings];
  await db.query(`delete from public.email_logs where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(
    `delete from public.email_logs where contact_message_id = any($1)`,
    [[...contactMessages]],
  );
  await db.query(
    `delete from public.email_logs where payload->>'external_event_id' in (
       select e.id::text from public.external_events e
       join public.external_calendars c on c.id = e.calendar_id
       where c.room_id = any($1)
     )`,
    [[...rooms]],
  );
  await db.query(`delete from public.refunds where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(`delete from public.payments where booking_id = any($1)`, [
    ids,
  ]);
  await db.query(`delete from public.bookings where id = any($1)`, [ids]);
  await db.query(`delete from public.contact_messages where id = any($1)`, [
    [...contactMessages],
  ]);
  await db.query(
    `delete from public.external_calendars where room_id = any($1)`,
    [[...rooms]],
  );
  await db.query(
    `delete from public.availability_blocks where room_id = any($1)`,
    [[...rooms]],
  );
  await db.query(`delete from public.rooms where id = any($1)`, [[...rooms]]);
  bookings.clear();
  contactMessages.clear();
  rooms.clear();
}

/** The stays behind tests/unit/admin-reports.test.ts, in the database. */
export async function addReportYear(room: FixtureRoom): Promise<void> {
  const common = { roomId: room.id, status: "completed", name: "Report guest" };
  const a = await addBooking({
    ...common,
    checkIn: "2019-07-30",
    checkOut: "2019-08-02",
    totalCents: 60000,
    nightCents: 15000,
    confirmedAt: "2019-05-01T10:00:00Z",
  });
  await addPayment(a, 60000, { at: "2019-06-01T10:00:00Z" });
  await addPayment(a, 5000, {
    at: "2019-08-02T10:00:00Z",
    status: "disputed",
  });

  const b = await addBooking({
    ...common,
    source: "manual",
    checkIn: "2019-08-10",
    checkOut: "2019-08-14",
    totalCents: 100000,
    nightCents: 20000,
    confirmedAt: "2019-08-01T10:00:00Z",
  });
  await addPayment(b, 40000, { at: "2019-08-10T10:00:00Z" });

  const c = await addBooking({
    ...common,
    status: "cancelled",
    checkIn: "2019-08-20",
    checkOut: "2019-08-23",
    totalCents: 30000,
    confirmedAt: "2019-06-30T10:00:00Z",
    cancelledAt: "2019-08-01T10:00:00Z",
  });
  const paid = await addPayment(c, 30000, { at: "2019-07-01T10:00:00Z" });
  await addRefund(c, paid, 20000, "2019-08-01T10:00:00Z");

  await addBooking({
    ...common,
    status: "no_show",
    checkIn: "2019-08-25",
    checkOut: "2019-08-27",
    totalCents: 20000,
    confirmedAt: "2019-08-02T10:00:00Z",
  });

  await addExternal(room.airbnb, "2019-08-02", "2019-08-05", {
    amountCents: 50000,
    createdAt: "2019-07-20T10:00:00Z",
  });
  await addExternal(room.bookingCom, "2019-08-06", "2019-08-08", {
    createdAt: "2019-08-03T10:00:00Z",
  });
  await db.query(
    `select public.create_block($1, '2019-08-28', '2019-08-30', 'maintenance')`,
    [room.id],
  );
}
