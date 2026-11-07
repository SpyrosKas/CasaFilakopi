import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, athensDate } from "@/lib/domain/dates";
import { createAdmin, createRoom, db, PRICE, RULES } from "./helpers";

// Erasure is proved by a scan, not by a list of columns: every personal value
// in the fixture carries one marker, and the scan reads every text and jsonb
// column of every public table. A column added later is covered with no edit.
// Invoices are the one exception, and the test proves they stay whole.

const KEPT_BY_LAW = new Set(["invoices", "invoice_lines"]);

interface Person {
  marker: string;
  name: string;
  email: string;
  phone: string;
  digits: string;
}

function person(): Person {
  const marker = `zq${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const digits = `69${randomInt(10_000_000, 99_999_999)}`;
  return {
    marker,
    name: `Maria ${marker} Papadopoulou`,
    email: `${marker}@example.test`,
    phone: `+30 ${digits}`,
    digits,
  };
}

/** Every public text and jsonb cell holding this string, as table.column. */
async function scan(needle: string): Promise<string[]> {
  const { rows: columns } = await db.query(
    `select c.table_name, c.column_name from information_schema.columns c
     join information_schema.tables t using (table_schema, table_name)
     where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
       and c.data_type in ('text', 'jsonb', 'character varying')`,
  );
  const hits: string[] = [];
  for (const { table_name: table, column_name: column } of columns) {
    if (KEPT_BY_LAW.has(table)) continue;
    const { rows } = await db.query(
      `select count(*)::int as n from public."${table}"
       where position($1 in lower("${column}"::text)) > 0`,
      [needle.toLowerCase()],
    );
    if (rows[0].n > 0) hits.push(`${table}.${column}`);
  }
  return hits.sort();
}

let roomId: string;
let calendarId: string;
let actor: string;
let seedDay = 0;
const today = athensDate(new Date());

async function insertGuest(p: Person, createdAt?: string): Promise<string> {
  const { rows } = await db.query(
    `insert into public.guests (email, full_name, phone, country, marketing_consent, created_at)
     values ($1, $2, $3, 'GR', true, coalesce($4::timestamptz, now())) returning id`,
    [p.email, p.name, p.phone, createdAt ?? null],
  );
  return rows[0].id;
}

async function insertBooking(
  guestId: string,
  p: Person,
  stay: { checkIn: string; checkOut: string; status?: string },
): Promise<string> {
  const { rows } = await db.query(
    `insert into public.bookings (
       room_id, guest_id, status, check_in, check_out, adults, guest_name,
       guest_email, guest_phone, guest_country, arrival_time, special_requests,
       internal_notes, cancellation_reason, price_breakdown, total_cents,
       due_now_cents, rules_snapshot, access_token_hash, access_token_expires_at,
       reference
     ) values (
       $1, $2, $3, $4, $5, 2, $6, $7, $8, 'GR', $9, $10, $11, $12, $13::jsonb,
       10000, 0, $14::jsonb, $15, now() + interval '1 day', $16
     ) returning id`,
    [
      roomId,
      guestId,
      stay.status ?? "completed",
      stay.checkIn,
      stay.checkOut,
      p.name,
      p.email,
      p.phone,
      `after six ${p.marker}`,
      `A cot for ${p.marker}`,
      `Friend of ${p.marker}`,
      `Illness of ${p.marker}`,
      PRICE,
      RULES,
      `hash-${randomUUID()}`,
      `CF-${randomUUID().slice(0, 12)}`,
    ],
  );
  return rows[0].id;
}

/** An issued document, so the payment counts as settled for the books. */
async function issueDocument(
  bookingId: string,
  paymentId: string | null,
  customer: object,
): Promise<string> {
  const { rows: series } = await db.query(
    `insert into public.invoice_series (doc_type, prefix, is_active)
     values ('receipt', $1, false) returning id`,
    [`T${randomUUID().slice(0, 8)}`],
  );
  const { rows } = await db.query(
    `insert into public.invoices (booking_id, payment_id, doc_type, customer, series_id, number, status, issued_at, total_cents)
     values ($1, $2, 'receipt', $3::jsonb, $4, 1, 'issued', now(), 10000) returning id`,
    [bookingId, paymentId, JSON.stringify(customer), series[0].id],
  );
  return rows[0].id;
}

/** A guest with personal data in every place the product can put it. */
async function fullyLoaded() {
  const p = person();
  seedDay += 3;
  const checkIn = addDays(today, -400 - seedDay);
  const checkOut = addDays(checkIn, 2);
  const guestId = await insertGuest(p);
  const bookingId = await insertBooking(guestId, p, { checkIn, checkOut });
  const intent = `pi_${p.marker.toUpperCase()}`;

  const { rows: paid } = await db.query(
    `insert into public.payments (booking_id, kind, method, status, amount_cents,
       stripe_payment_intent_id, note)
     values ($1, 'full', 'card', 'succeeded', 10000, $2, $3) returning id`,
    [bookingId, intent, `Paid by ${p.name}`],
  );
  await db.query(
    `insert into public.refunds (booking_id, payment_id, amount_cents, status, reason)
     values ($1, $2, 100, 'failed', $3)`,
    [bookingId, paid[0].id, `For ${p.name}`],
  );

  await issueDocument(bookingId, paid[0].id, { name: "On the invoice" });

  // Linked by the booking, and by address alone.
  const { rows: messages } = await db.query(
    `insert into public.contact_messages (name, email, phone, dates_of_interest, message, booking_id)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      p.name,
      p.email,
      p.phone,
      `May ${p.marker}`,
      `Hello ${p.marker}`,
      bookingId,
    ],
  );
  await db.query(
    `insert into public.contact_messages (name, email, message)
     values ('Someone', $1, 'Unlinked')`,
    [p.email.toUpperCase()],
  );

  await db.query(
    `insert into public.email_logs (template_key, recipient, payload, booking_id, status, last_error)
     values
       ('booking_confirmation', $1, $2::jsonb, $3, 'sent', $4),
       ('thank_you', $1, '{}', $3, 'queued', null),
       ('host_contact_message', 'host@example.test', '{}', null, 'sent', null),
       ('host_email_bounced', 'host@example.test', $5::jsonb, null, 'sent', null)`,
    [
      p.email,
      JSON.stringify({ note: p.marker }),
      bookingId,
      `Mailbox ${p.email} full`,
      JSON.stringify({ recipient: p.email }),
    ],
  );
  await db.query(
    `insert into public.email_logs (template_key, recipient, contact_message_id)
     values ('contact_auto_reply', $1, $2)`,
    [p.email, messages[0].id],
  );

  await db.query(
    `insert into public.stripe_events (id, type, payload) values
       ($1, 'checkout.session.completed', $2::jsonb),
       ($3, 'charge.refunded', $4::jsonb)`,
    [
      `evt_${randomUUID()}`,
      JSON.stringify({
        data: { object: { metadata: { booking_id: bookingId } } },
      }),
      `evt_${randomUUID()}`,
      JSON.stringify({
        data: {
          object: {
            payment_intent: intent,
            billing_details: { name: p.name, email: p.email },
          },
        },
      }),
    ],
  );

  // Found only by a mixed-case Stripe id: no name, address or booking id in it.
  await db.query(
    `insert into public.stripe_events (id, type, payload) values ($1, 'charge.updated', $2::jsonb)`,
    [
      `evt_${randomUUID()}`,
      JSON.stringify({ data: { object: { payment_intent: intent } } }),
    ],
  );

  const stayStart = addDays(checkIn, -40);
  const { rows: events } = await db.query(
    `insert into public.external_events (calendar_id, uid, start_date, end_date, summary)
     values ($1, $2, $3, $4, $5) returning id`,
    [
      calendarId,
      randomUUID(),
      stayStart,
      addDays(stayStart, 2),
      `Reserved - ${p.name}`,
    ],
  );
  await db.query(
    `select public.update_external_event_details($1, $2, $3, $4, $5, 5000, $6)`,
    [events[0].id, p.name, p.email, p.phone, `Notes ${p.marker}`, actor],
  );

  return { p, guestId, bookingId, eventId: events[0].id as string, intent };
}

beforeAll(async () => {
  roomId = await createRoom();
  const calendarRoom = await createRoom();
  const { rows } = await db.query(
    `insert into public.external_calendars (room_id, channel)
     values ($1, 'other_ical') returning id`,
    [calendarRoom],
  );
  calendarId = rows[0].id;
  actor = (await createAdmin("owner")).id;
});

afterAll(async () => {
  await db.end();
});

const anonymise = async (id: string, by: string | null = actor) =>
  (await db.query(`select public.anonymise_guest($1, $2) as r`, [id, by]))
    .rows[0].r as Record<string, number | boolean>;

describe("anonymise_guest", () => {
  it("leaves no personal string anywhere in the database", async () => {
    const { p, guestId, intent } = await fullyLoaded();

    // The fixture reaches every place named in the plan, or the scan proves
    // nothing.
    expect(await scan(p.marker)).toEqual(
      expect.arrayContaining([
        "audit_log.after",
        "bookings.arrival_time",
        "bookings.cancellation_reason",
        "bookings.guest_email",
        "bookings.guest_name",
        "bookings.internal_notes",
        "bookings.special_requests",
        "contact_messages.dates_of_interest",
        "contact_messages.email",
        "contact_messages.message",
        "contact_messages.name",
        "email_logs.last_error",
        "email_logs.payload",
        "email_logs.recipient",
        "external_events.guest_email",
        "external_events.guest_name",
        "external_events.guest_notes",
        "external_events.summary",
        "guests.email",
        "guests.full_name",
        "payments.note",
        "refunds.reason",
        "stripe_events.payload",
      ]),
    );
    expect(await scan(p.digits)).toEqual(
      expect.arrayContaining([
        "bookings.guest_phone",
        "contact_messages.phone",
        "external_events.guest_phone",
        "guests.phone",
      ]),
    );

    await anonymise(guestId);

    // The Stripe id in payments.stripe_payment_intent_id is a reference the
    // books need, and it is the one place the marker may stay in this fixture.
    expect(await scan(p.marker)).toEqual(["payments.stripe_payment_intent_id"]);
    expect(await scan(p.digits)).toEqual([]);
    expect(await scan(intent)).not.toContain("stripe_events.payload");

    const { rows } = await db.query(
      `select anonymized_at, country, marketing_consent from public.guests where id = $1`,
      [guestId],
    );
    expect(rows[0].anonymized_at).not.toBeNull();
    expect(rows[0].country).toBeNull();
    expect(rows[0].marketing_consent).toBe(false);
  });

  it("finds a Stripe event by the booking id alone", async () => {
    const { guestId, bookingId } = await fullyLoaded();
    await anonymise(guestId);
    expect(await scan(bookingId)).not.toContain("stripe_events.payload");
  });

  it("keeps what the books need and stops the guest's link", async () => {
    const { guestId, bookingId } = await fullyLoaded();
    await anonymise(guestId);
    const { rows } = await db.query(
      `select b.total_cents, b.check_in, b.status, b.reference,
         b.access_token_hash, b.access_token_expires_at, p.amount_cents
       from public.bookings b join public.payments p on p.booking_id = b.id
       where b.id = $1`,
      [bookingId],
    );
    expect(rows[0]).toMatchObject({
      total_cents: 10000,
      status: "completed",
      amount_cents: 10000,
      access_token_hash: null,
      access_token_expires_at: null,
    });
    expect(rows[0].reference).toBeTruthy();
    expect(rows[0].check_in).toBeTruthy();
  });

  it("never touches an invoice, which stays a whole, immutable record", async () => {
    const { p, guestId, bookingId } = await fullyLoaded();
    const customer = { name: p.name, email: p.email };
    const invoice = await issueDocument(bookingId, null, customer);

    await anonymise(guestId);

    const { rows } = await db.query(
      `select customer from public.invoices where id = $1`,
      [invoice],
    );
    expect(rows[0].customer).toEqual(customer);
  });

  it("writes one audit entry that names the admin and no person", async () => {
    const { p, guestId } = await fullyLoaded();
    await anonymise(guestId);
    const { rows } = await db.query(
      `select actor_id, after from public.audit_log
       where action = 'anonymise' and entity_id = $1`,
      [guestId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(actor);
    expect(rows[0].after.bookings).toBe(1);
    expect(JSON.stringify(rows[0])).not.toContain(p.marker);
  });

  it("clears calendar text from history, even if it names them differently", async () => {
    const { p, guestId } = await fullyLoaded();
    const nickname = `zq${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const { rows } = await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, summary)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        calendarId,
        randomUUID(),
        addDays(today, -700),
        addDays(today, -698),
        `Reserved - ${nickname}`,
      ],
    );
    await db.query(
      `select public.update_external_event_details($1, null, $2, null, null, null, $3)`,
      [rows[0].id, p.email, actor],
    );
    expect(await scan(nickname)).toContain("audit_log.after");

    await anonymise(guestId);

    expect(await scan(nickname)).toEqual([]);
  });

  it("clears an email linked only through a contact message", async () => {
    const { p, guestId } = await fullyLoaded();
    const { rows: mail } = await db.query(
      `insert into public.email_logs (template_key, recipient, contact_message_id)
       select 'host_contact_message', 'host@example.test', id
       from public.contact_messages where email = $1 and booking_id is not null
       returning id`,
      [p.email],
    );
    await anonymise(guestId);
    const { rows } = await db.query(
      `select recipient from public.email_logs where id = $1`,
      [mail[0].id],
    );
    expect(rows[0].recipient).toBe("anonymised");
  });

  it("fails what was queued and does not erase twice", async () => {
    const { guestId, bookingId } = await fullyLoaded();
    await anonymise(guestId);
    const { rows } = await db.query(
      `select status from public.email_logs
       where booking_id = $1 and template_key = 'thank_you'`,
      [bookingId],
    );
    expect(rows[0].status).toBe("failed");
    expect(await anonymise(guestId)).toEqual({ already: true });
  });

  it.each([
    ["a stay happening now", -1, 1, "checked_in"],
    ["a stay ending today", -2, 0, "confirmed"],
    ["a stay to come", 200, 203, "confirmed"],
    ["a checkout in progress", 210, 212, "pending_payment"],
  ])("refuses %s", async (_, from, to, status) => {
    const p = person();
    const guestId = await insertGuest(p);
    await insertBooking(guestId, p, {
      checkIn: addDays(today, from),
      checkOut: addDays(today, to),
      status,
    });
    await expect(anonymise(guestId)).rejects.toThrow("guest_has_stay");
    const { rows } = await db.query(
      `select email from public.guests where id = $1`,
      [guestId],
    );
    expect(rows[0].email).toBe(p.email);
  });

  it("allows a cancelled future stay", async () => {
    const p = person();
    const guestId = await insertGuest(p);
    await insertBooking(guestId, p, {
      checkIn: addDays(today, 220),
      checkOut: addDays(today, 222),
      status: "cancelled",
    });
    await anonymise(guestId);
    expect(await scan(p.marker)).toEqual([]);
  });

  it("refuses when an imported stay to come belongs to the same person", async () => {
    const p = person();
    const guestId = await insertGuest(p);
    await insertBooking(guestId, p, {
      checkIn: addDays(today, -30),
      checkOut: addDays(today, -28),
    });
    await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_email)
       values ($1, $2, $3, $4, $5)`,
      [
        calendarId,
        randomUUID(),
        addDays(today, 300),
        addDays(today, 302),
        p.email,
      ],
    );
    await expect(anonymise(guestId)).rejects.toThrow("guest_has_stay");
  });

  it("reports a guest who does not exist", async () => {
    await expect(anonymise(randomUUID())).rejects.toThrow("guest_not_found");
  });

  it("a new booking with the same address starts a new guest", async () => {
    const { p, guestId } = await fullyLoaded();
    await anonymise(guestId);
    const { rows } = await db.query(
      `select public.find_or_create_guest($1::jsonb) as id`,
      [JSON.stringify({ email: p.email, name: "Back again" })],
    );
    expect(rows[0].id).not.toBe(guestId);
    await db.query(`delete from public.guests where id = $1`, [rows[0].id]);
  });

  it("the next import does not bring an erased name back", async () => {
    const { p, guestId, eventId } = await fullyLoaded();
    const { rows: event } = await db.query(
      `select uid, start_date, end_date from public.external_events where id = $1`,
      [eventId],
    );
    await anonymise(guestId);
    await db.query(
      `select public.upsert_external_event($1, $2, $3::date, $4::date, $5)`,
      [
        calendarId,
        event[0].uid,
        event[0].start_date,
        event[0].end_date,
        `Reserved - ${p.name}`,
      ],
    );
    expect(await scan(p.marker)).not.toContain("external_events.summary");
  });
});

describe("anonymise_external_guest", () => {
  const importedStay = async (p: Person, from: number) => {
    const { rows } = await db.query(
      `insert into public.external_events
         (calendar_id, uid, start_date, end_date, summary, guest_name, guest_email, guest_phone, guest_notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [
        calendarId,
        randomUUID(),
        addDays(today, from),
        addDays(today, from + 2),
        `Reserved ${p.marker}`,
        p.name,
        p.email,
        p.phone,
        `Notes ${p.marker}`,
      ],
    );
    return rows[0].id as string;
  };

  it("erases every imported stay of that person, and is audited", async () => {
    const p = person();
    const first = await importedStay(p, -500);
    await importedStay(p, -510);
    await db.query(`select public.anonymise_external_guest($1, $2)`, [
      first,
      actor,
    ]);
    expect(await scan(p.marker)).toEqual([]);
    expect(await scan(p.digits)).toEqual([]);
    const { rows } = await db.query(
      `select actor_id from public.audit_log
       where action = 'anonymise' and entity = 'external_events' and entity_id = $1`,
      [first],
    );
    expect(rows[0].actor_id).toBe(actor);
  });

  it("refuses a stay still to come", async () => {
    const p = person();
    const first = await importedStay(p, -520);
    await importedStay(p, 500);
    await expect(
      db.query(`select public.anonymise_external_guest($1, $2)`, [
        first,
        actor,
      ]),
    ).rejects.toThrow("guest_has_stay");
  });
});

describe("retention (JOB-08)", () => {
  const years = async () =>
    (
      await db.query(
        `select (value ->> 'years')::int as y from public.settings where key = 'retention'`,
      )
    ).rows[0].y as number;

  /** One of everything, on either side of the five-year line. */
  async function oldAndNew() {
    const y = await years();
    const cutoff = addDays(today, -366 * y);
    const old = person();
    const recent = person();
    const oldGuest = await insertGuest(old, `${cutoff}T00:00:00Z`);
    await insertBooking(oldGuest, old, {
      checkIn: addDays(cutoff, -10),
      checkOut: addDays(cutoff, -8),
    });
    const recentGuest = await insertGuest(recent, `${cutoff}T00:00:00Z`);
    await insertBooking(recentGuest, recent, {
      checkIn: addDays(cutoff, -30),
      checkOut: addDays(cutoff, -28),
    });
    await insertBooking(recentGuest, recent, {
      checkIn: addDays(today, -20),
      checkOut: addDays(today, -18),
    });

    const { rows: oldMessage } = await db.query(
      `insert into public.contact_messages (name, email, message, created_at)
       values ('Old', 'old@example.test', $1, $2) returning id`,
      [`Old message ${randomUUID()}`, `${cutoff}T00:00:00Z`],
    );
    const { rows: newMessage } = await db.query(
      `insert into public.contact_messages (name, email, message)
       values ('New', 'new@example.test', 'Recent') returning id`,
    );
    const { rows: oldMail } = await db.query(
      `insert into public.email_logs (template_key, recipient, created_at, contact_message_id, status)
       values ('contact_auto_reply', 'old@example.test', $1, $2, 'sent') returning id`,
      [`${cutoff}T00:00:00Z`, oldMessage[0].id],
    );
    const { rows: newMail } = await db.query(
      `insert into public.email_logs (template_key, recipient)
       values ('contact_auto_reply', 'new@example.test') returning id`,
    );
    await db.query(
      `insert into public.stripe_events (id, type, payload, received_at)
       values ($1, 'charge.failed', $2::jsonb, $3)`,
      [
        `evt_${randomUUID()}`,
        JSON.stringify({ email: `${old.marker}-stripe@example.test` }),
        `${cutoff}T00:00:00Z`,
      ],
    );
    await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_name)
       values ($1, $2, $3, $4, $5)`,
      [
        calendarId,
        randomUUID(),
        addDays(cutoff, -60),
        addDays(cutoff, -58),
        `${old.marker} imported`,
      ],
    );
    return {
      old,
      recent,
      oldGuest,
      recentGuest,
      oldMessage: oldMessage[0].id as string,
      newMessage: newMessage[0].id as string,
      oldMail: oldMail[0].id as string,
      newMail: newMail[0].id as string,
    };
  }

  const present = async (table: string, id: string) =>
    (await db.query(`select 1 from public.${table} where id = $1`, [id]))
      .rowCount === 1;

  it("seeds five years, as D27 sets", async () => {
    expect(await years()).toBe(5);
  });

  it("changes nothing on a dry run, which is the default", async () => {
    const f = await oldAndNew();
    const before = await scan(f.old.marker);
    const { rows } = await db.query(`select public.apply_retention() as r`);
    expect(rows[0].r.dry_run).toBe(true);
    expect(rows[0].r.guests).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.contact_messages).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.email_logs).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.external_events).toBeGreaterThanOrEqual(1);
    expect(rows[0].r.stripe_events).toBeGreaterThanOrEqual(1);
    expect(await scan(f.old.marker)).toEqual(before);
    expect(await present("contact_messages", f.oldMessage)).toBe(true);
    expect(await present("email_logs", f.oldMail)).toBe(true);
  });

  it("erases only what is past the period, counted from the last check-out", async () => {
    const f = await oldAndNew();
    await db.query(`select public.run_database_job('apply_retention')`);

    const { rows: run } = await db.query(
      `select status, detail from public.job_runs
       where job = 'apply_retention' order by id desc limit 1`,
    );
    expect(run[0].status).toBe("success");
    expect(Number(run[0].detail)).toBeGreaterThanOrEqual(1);

    expect(await scan(f.old.marker)).toEqual([]);
    expect(await present("contact_messages", f.oldMessage)).toBe(false);
    expect(await present("email_logs", f.oldMail)).toBe(false);
    expect(await present("contact_messages", f.newMessage)).toBe(true);
    expect(await present("email_logs", f.newMail)).toBe(true);

    // An old booking and a recent one: the recent one decides.
    const { rows } = await db.query(
      `select email from public.guests where id = $1`,
      [f.recentGuest],
    );
    expect(rows[0].email).toBe(f.recent.email);
    expect(await scan(f.recent.marker)).toContain("guests.email");

    const { rows: audit } = await db.query(
      `select after from public.audit_log where action = 'retention'
       order by id desc limit 1`,
    );
    expect(audit[0].after.guests).toBeGreaterThanOrEqual(1);
  });

  it("skips a guest with an imported stay to come, and the job still passes", async () => {
    const f = await oldAndNew();
    await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_email)
       values ($1, $2, $3, $4, $5)`,
      [
        calendarId,
        randomUUID(),
        addDays(today, 400),
        addDays(today, 402),
        f.old.email,
      ],
    );
    const { rows } = await db.query(
      `select public.apply_retention(false) as r`,
    );
    expect(rows[0].r.guests_skipped).toBeGreaterThanOrEqual(1);
    const { rows: guest } = await db.query(
      `select email from public.guests where id = $1`,
      [f.oldGuest],
    );
    expect(guest[0].email).toBe(f.old.email);
    await db.query(
      `delete from public.external_events where guest_email = $1`,
      [f.old.email],
    );
  });

  it.each([['{"years": 0}'], ['{"years": 99}'], ["{}"], ['{"months": 60}']])(
    "stops and erases nothing when the setting is %s",
    async (value) => {
      const client = await db.connect();
      try {
        await client.query("begin");
        await client.query(
          `update public.settings set value = $1::jsonb where key = 'retention'`,
          [value],
        );
        await expect(
          client.query(`select public.apply_retention(false)`),
        ).rejects.toThrow("retention_setting_invalid");
      } finally {
        await client.query("rollback");
        client.release();
      }
    },
  );

  it("is scheduled daily", async () => {
    const { rows } = await db.query(
      `select schedule, command from cron.job where jobname = 'gdpr-retention'`,
    );
    expect(rows[0].schedule).toBe("41 2 * * *");
    expect(rows[0].command).toContain("apply_retention");
  });
});

describe("run_database_job", () => {
  it("keeps the first quiet run after a failure, so it does not look current", async () => {
    // A failed row stands in for a real failure, as if it were the last run.
    const { rows } = await db.query(
      `insert into public.job_runs (job, status, finished_at, detail)
       values ('release_expired_holds', 'failed', now(), 'boom') returning id`,
    );
    await db.query(`select public.run_database_job('release_expired_holds')`);
    const { rows: latest } = await db.query(
      `select id, status from public.job_runs
       where job = 'release_expired_holds' order by id desc limit 1`,
    );
    expect(latest[0].id).not.toBe(rows[0].id);
    expect(latest[0].status).toBe("success");
  });
});

describe("user management RPCs", () => {
  it("adds, changes and removes an admin, audited under the Owner", async () => {
    const staff = await createAdmin("staff");
    await db.query(`select public.change_admin_role($1, 'owner', $2)`, [
      staff.id,
      actor,
    ]);
    const { rows } = await db.query(
      `select actor_id from public.audit_log
       where entity = 'admin_profiles' and entity_id = $1 and action = 'update'`,
      [staff.id],
    );
    expect(rows.at(-1)?.actor_id).toBe(actor);
    await db.query(`select public.remove_admin($1, $2)`, [staff.id, actor]);
    await db.query(`select public.add_admin($1, 'staff', 'Back', $2)`, [
      staff.id,
      actor,
    ]);
    const { rows: back } = await db.query(
      `select role from public.admin_profiles where id = $1`,
      [staff.id],
    );
    expect(back[0].role).toBe("staff");
  });

  it("refuses to change or remove yourself, so one Owner always stays", async () => {
    await expect(
      db.query(`select public.remove_admin($1, $1)`, [actor]),
    ).rejects.toThrow("cannot_change_self");
    await expect(
      db.query(`select public.change_admin_role($1, 'staff', $1)`, [actor]),
    ).rejects.toThrow("cannot_change_self");
  });

  it("refuses Staff and anyone already removed", async () => {
    const staff = await createAdmin("staff");
    const other = await createAdmin("staff");
    await expect(
      db.query(`select public.remove_admin($1, $2)`, [other.id, staff.id]),
    ).rejects.toThrow("not_authorised");
    await expect(
      db.query(`select public.add_admin($1, 'owner', 'X', $2)`, [
        other.id,
        randomUUID(),
      ]),
    ).rejects.toThrow("not_authorised");
  });
});
