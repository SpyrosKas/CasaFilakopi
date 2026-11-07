import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, athensDate } from "@/lib/domain/dates";
import { createAdmin, createRoom, db, PRICE, RULES } from "./helpers";

// Erasure touches one person's rows and nobody else's. Each case erases inside
// a transaction and lists exactly the rows that transaction wrote, by xmin, so
// the proof is a count over the whole of each table, on a shared database.

const today = athensDate(new Date());
let roomId: string;
let calendarId: string;
let actor: string;

type Written = Record<string, string[]>;

const WATCHED: Record<string, string> = {
  guests: "id",
  bookings: "id",
  payments: "id",
  refunds: "id",
  contact_messages: "id",
  email_logs: "id",
  stripe_events: "id",
  external_events: "id",
  invoices: "id",
  invoice_lines: "id",
  audit_log: "id",
};

/** Runs one erasure, and returns every row it wrote, per table. */
async function erase(sql: string, args: unknown[]): Promise<Written> {
  const client = await db.connect();
  try {
    await client.query("begin");
    await client.query(sql, args);
    const written: Written = {};
    for (const [table, key] of Object.entries(WATCHED)) {
      const { rows } = await client.query(
        `select ${key}::text as key from public.${table}
         where xmin = pg_current_xact_id()::xid`,
      );
      if (rows.length) written[table] = rows.map((row) => row.key);
    }
    await client.query("commit");
    return written;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const eraseGuest = (id: string) =>
  erase(`select public.anonymise_guest($1, $2)`, [id, actor]);

interface Options {
  name: string;
  phone?: string;
  status?: string;
  from?: number;
}

async function person({ name, phone, status, from = -100 }: Options) {
  const email = `p${randomUUID().slice(0, 12)}@example.test`;
  const number = phone ?? `+30 69${randomInt(10_000_000, 99_999_999)}`;
  const { rows: guest } = await db.query(
    `insert into public.guests (email, full_name, phone) values ($1, $2, $3) returning id`,
    [email, name, number],
  );
  const { rows: booking } = await db.query(
    `insert into public.bookings (
       room_id, guest_id, status, check_in, check_out, adults, guest_name, guest_email,
       guest_phone, price_breakdown, total_cents, due_now_cents, rules_snapshot,
       arrival_time
     ) values ($1, $2, $3, $4, $5, 2, $6, $7, $8, $9::jsonb, 10000, 0, $10::jsonb, 'late')
     returning id`,
    [
      roomId,
      guest[0].id,
      status ?? "completed",
      addDays(today, from),
      addDays(today, from + 2),
      name,
      email,
      number,
      PRICE,
      RULES,
    ],
  );
  return {
    id: guest[0].id as string,
    bookingId: booking[0].id as string,
    email,
    name,
    phone: number,
  };
}

type Person = Awaited<ReturnType<typeof person>>;

/** Rows naming this person in text, which only keys may reach. */
async function textAbout(p: Person) {
  const { rows: message } = await db.query(
    `insert into public.contact_messages (name, email, message)
     values ('Someone else', 'friend@example.test', $1) returning id`,
    [`A note about ${p.name} and ${p.phone}`],
  );
  const { rows: mail } = await db.query(
    `insert into public.email_logs (template_key, recipient, payload)
     values ('host_sync_conflict', 'host@example.test', $1::jsonb) returning id`,
    [JSON.stringify({ summary: `Reserved ${p.name}` })],
  );
  const stripeId = `evt_${randomUUID()}`;
  await db.query(
    `insert into public.stripe_events (id, type, payload) values ($1, 'x', $2::jsonb)`,
    [stripeId, JSON.stringify({ description: `Stay of ${p.name}` })],
  );
  const { rows: audit } = await db.query(
    `insert into public.audit_log (action, entity, entity_id, after)
     values ('update', 'email_logs', $1, $2::jsonb) returning id`,
    [randomUUID(), JSON.stringify({ note: p.name, phone: p.phone })],
  );
  return {
    message: message[0].id as string,
    mail: mail[0].id as string,
    stripe: stripeId,
    audit: String(audit[0].id),
  };
}

/** Everything written must be this person's, and only their audit rows. */
function expectOnly(written: Written, p: Person, auditIds: string[] = []) {
  expect(written.guests).toEqual([p.id]);
  expect(written.bookings).toEqual([p.bookingId]);
  // The update's own trigger row, and the one anonymise entry.
  const audit = written.audit_log ?? [];
  expect(audit.length).toBeLessThanOrEqual(auditIds.length + 3);
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

describe("a name never reaches beyond its own records", () => {
  it.each([["Mark"], ["Milos"], ["Guest"], ["anna"], ["Test"], ["Filakopi"]])(
    "%s",
    async (name) => {
      const p = await person({ name });
      const text = await textAbout(p);

      const written = await eraseGuest(p.id);

      expectOnly(written, p);
      expect(written.contact_messages ?? []).not.toContain(text.message);
      expect(written.email_logs ?? []).not.toContain(text.mail);
      expect(written.stripe_events ?? []).not.toContain(text.stripe);
      expect(written.audit_log ?? []).not.toContain(text.audit);
      expect(written.invoices).toBeUndefined();
      expect(written.invoice_lines).toBeUndefined();
    },
  );

  it("leaves another guest with the same name exactly as they were", async () => {
    const name = `Same ${randomUUID().slice(0, 8)}`;
    const other = await person({ name });
    const first = await person({ name });
    const { rows: stay } = await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_name)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        calendarId,
        randomUUID(),
        addDays(today, -300),
        addDays(today, -298),
        name,
      ],
    );

    const written = await eraseGuest(first.id);

    expectOnly(written, first);
    const { rows } = await db.query(
      `select guest_name, guest_email from public.bookings where id = $1`,
      [other.bookingId],
    );
    expect(rows[0]).toEqual({ guest_name: name, guest_email: other.email });
    expect(written.external_events ?? []).not.toContain(stay[0].id);
  });

  it("the same name with a stay to come does not block erasure", async () => {
    const name = `Busy ${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_name)
       values ($1, $2, $3, $4, $5)`,
      [calendarId, randomUUID(), addDays(today, 40), addDays(today, 42), name],
    );
    const p = await person({ name });
    expectOnly(await eraseGuest(p.id), p);
  });
});

describe("a phone number", () => {
  it("of four digits matches nothing, not even timestamps", async () => {
    const p = await person({ name: "Short", phone: "2026" });
    const { rows } = await db.query(
      `insert into public.contact_messages (name, email, phone, message)
       values ('Other', 'other@example.test', '2026', 'Same short number') returning id`,
    );
    const written = await eraseGuest(p.id);
    expectOnly(written, p);
    expect(written.contact_messages ?? []).not.toContain(rows[0].id);
  });

  it("of eight digits or more matches, whatever its spacing", async () => {
    const digits = `69${randomInt(10_000_000, 99_999_999)}`;
    const p = await person({ name: "Long", phone: `+30 ${digits}` });
    const { rows: message } = await db.query(
      `insert into public.contact_messages (name, email, phone, message)
       values ('Other', 'other@example.test', $1, 'Same number') returning id`,
      [`30-${digits}`],
    );
    const { rows: stay } = await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_phone)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        calendarId,
        randomUUID(),
        addDays(today, -320),
        addDays(today, -318),
        `(30) ${digits}`,
      ],
    );
    const written = await eraseGuest(p.id);
    expect(written.contact_messages).toContain(message[0].id);
    expect(written.external_events).toContain(stay[0].id);
  });
});

describe("audit history", () => {
  it("changes only on this person's bookings, by id, and only the free text", async () => {
    const p = await person({ name: "Audit" });
    const other = await person({ name: "Audit" });
    const invoiceAudit = await db.query(
      `insert into public.audit_log (action, entity, entity_id, after)
       values ('insert', 'invoices', $1, $2::jsonb) returning id, after`,
      [randomUUID(), JSON.stringify({ reason: `Credit for ${p.name}` })],
    );

    const written = await eraseGuest(p.id);

    const { rows: mine } = await db.query(
      `select id::text, entity, entity_id, after from public.audit_log
       where id::text = any($1)`,
      [written.audit_log],
    );
    for (const row of mine) {
      expect(["bookings", "guests"]).toContain(row.entity);
      expect([p.bookingId, p.id]).toContain(row.entity_id);
    }
    const { rows: history } = await db.query(
      `select after from public.audit_log
       where entity = 'bookings' and entity_id = $1 order by id limit 1`,
      [p.bookingId],
    );
    expect(history[0].after.arrival_time).toBeUndefined();
    expect(history[0].after.status).toBe("completed");

    const { rows: kept } = await db.query(
      `select after from public.audit_log where id = $1`,
      [invoiceAudit.rows[0].id],
    );
    expect(kept[0].after).toEqual(invoiceAudit.rows[0].after);

    const { rows: theirs } = await db.query(
      `select after from public.audit_log
       where entity = 'bookings' and entity_id = $1 order by id limit 1`,
      [other.bookingId],
    );
    expect(theirs[0].after.arrival_time).toBe("late");
  });
});

describe("audit history is matched by entity and id together", () => {
  it("leaves another table's row with the same id", async () => {
    const p = await person({ name: "Entity" });
    const { rows } = await db.query(
      `insert into public.audit_log (action, entity, entity_id, after)
       values ('insert', 'invoices', $1, '{"arrival_time": "kept"}') returning id`,
      [p.bookingId],
    );
    await eraseGuest(p.id);
    const { rows: kept } = await db.query(
      `select after from public.audit_log where id = $1`,
      [rows[0].id],
    );
    expect(kept[0].after).toEqual({ arrival_time: "kept" });
  });

  it("leaves the calendar text of someone else's imported stay", async () => {
    const p = await person({ name: "Calendar" });
    const event = async (email: string, days: number) => {
      const { rows } = await db.query(
        `insert into public.external_events (calendar_id, uid, start_date, end_date, summary, guest_email)
         values ($1, $2, $3, $4, 'Reserved', $5) returning id`,
        [
          calendarId,
          randomUUID(),
          addDays(today, days),
          addDays(today, days + 2),
          email,
        ],
      );
      await db.query(
        `insert into public.audit_log (action, entity, entity_id, after)
         values ('update', 'external_events', $1, '{"summary": "Reserved"}')`,
        [rows[0].id],
      );
      return rows[0].id as string;
    };
    const mine = await event(p.email, -900);
    const theirs = await event("someone@example.test", -905);

    await eraseGuest(p.id);

    const summary = async (id: string) =>
      (
        await db.query(
          `select after from public.audit_log
           where entity = 'external_events' and entity_id = $1`,
          [id],
        )
      ).rows[0].after.summary;
    expect(await summary(mine)).toBeUndefined();
    expect(await summary(theirs)).toBe("Reserved");
  });
});

describe("email", () => {
  it("never fails or changes a queued email for another booking", async () => {
    const p = await person({ name: "Sender" });
    const live = await person({ name: "Live", status: "confirmed", from: 90 });
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, booking_id, status, payload)
       values ('pre_arrival', $1, $2, 'queued', '{"keep": true}') returning id`,
      [p.email, live.bookingId],
    );
    const { rows: sent } = await db.query(
      `insert into public.email_logs (template_key, recipient, booking_id, status)
       values ('pre_arrival', $1, $2, 'sent') returning id`,
      [p.email, live.bookingId],
    );

    const written = await eraseGuest(p.id);

    expect(written.email_logs ?? []).not.toContain(rows[0].id);
    const { rows: after } = await db.query(
      `select id, status, recipient, payload from public.email_logs where id = any($1)`,
      [[rows[0].id, sent[0].id]],
    );
    const queued = after.find((row) => row.id === rows[0].id);
    expect(queued).toMatchObject({
      status: "queued",
      recipient: p.email,
      payload: { keep: true },
    });
    const done = after.find((row) => row.id === sent[0].id);
    expect(done).toMatchObject({ status: "sent", recipient: "anonymised" });
  });

  it("clears a host alert that names the address exactly", async () => {
    const p = await person({ name: "Bounced" });
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, payload)
       values ('host_email_bounced', 'host@example.test', $1::jsonb) returning id`,
      [JSON.stringify({ recipient: p.email })],
    );
    const written = await eraseGuest(p.id);
    expect(written.email_logs).toContain(rows[0].id);
  });
});

describe("Stripe events", () => {
  it("match a whole value, not a piece of text", async () => {
    const p = await person({ name: "Stripe" });
    const exact = `evt_${randomUUID()}`;
    const partial = `evt_${randomUUID()}`;
    await db.query(
      `insert into public.stripe_events (id, type, payload) values
         ($1, 'x', $2::jsonb), ($3, 'x', $4::jsonb)`,
      [
        exact,
        JSON.stringify({ customer_email: p.email }),
        partial,
        JSON.stringify({ text: `mail ${p.email} about it` }),
      ],
    );
    const written = await eraseGuest(p.id);
    expect(written.stripe_events).toContain(exact);
    expect(written.stripe_events).not.toContain(partial);
  });
});

describe("imported stays and direct bookings of the same person", () => {
  const imported = async (fields: { email?: string; phone?: string }) => {
    const { rows } = await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_email, guest_phone)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        calendarId,
        randomUUID(),
        addDays(today, -340 - randomInt(0, 300)),
        addDays(today, -335),
        fields.email ?? null,
        fields.phone ?? null,
      ],
    );
    return rows[0].id as string;
  };
  const eraseImported = (id: string) =>
    db.query(`select public.anonymise_external_guest($1, $2)`, [id, actor]);

  it("refuses while a direct booking is still to come", async () => {
    const p = await person({ name: "Both", status: "confirmed", from: 120 });
    await expect(
      eraseImported(await imported({ email: p.email })),
    ).rejects.toThrow("guest_has_stay");
  });

  it("refuses by phone too", async () => {
    const p = await person({ name: "Both", status: "confirmed", from: 130 });
    await expect(
      eraseImported(await imported({ phone: p.phone })),
    ).rejects.toThrow("guest_has_stay");
  });

  it("refuses while their money is open", async () => {
    const p = await person({ name: "Both" });
    await db.query(
      `insert into public.payments (booking_id, kind, method, status, amount_cents)
       values ($1, 'full', 'card', 'disputed', 10000)`,
      [p.bookingId],
    );
    await expect(
      eraseImported(await imported({ email: p.email })),
    ).rejects.toThrow("guest_has_open_money");
  });

  it("leaves a past direct booking in place", async () => {
    const p = await person({ name: "Past" });
    await eraseImported(await imported({ email: p.email }));
    const { rows } = await db.query(
      `select guest_email from public.bookings where id = $1`,
      [p.bookingId],
    );
    expect(rows[0].guest_email).toBe(p.email);
  });
});

describe("open money", () => {
  const payment = async (bookingId: string, status: string) => {
    const { rows } = await db.query(
      `insert into public.payments (booking_id, kind, method, status, amount_cents)
       values ($1, 'full', 'card', $2, 10000) returning id`,
      [bookingId, status],
    );
    return rows[0].id as string;
  };
  const issue = async (bookingId: string, paymentId: string | null) => {
    const { rows: series } = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active)
       values ('receipt', $1, false) returning id`,
      [`T${randomUUID().slice(0, 8)}`],
    );
    await db.query(
      `insert into public.invoices (booking_id, payment_id, doc_type, series_id, number, status, issued_at)
       values ($1, $2, 'receipt', $3, 1, 'issued', now())`,
      [bookingId, paymentId, series[0].id],
    );
  };

  it.each([["pending"], ["disputed"]])(
    "refuses a %s payment",
    async (status) => {
      const p = await person({ name: "Money" });
      await payment(p.bookingId, status);
      await expect(eraseGuest(p.id)).rejects.toThrow("guest_has_open_money");
      const { rows } = await db.query(
        `select email from public.guests where id = $1`,
        [p.id],
      );
      expect(rows[0].email).toBe(p.email);
    },
  );

  it("refuses a pending refund", async () => {
    const p = await person({ name: "Money" });
    const paid = await payment(p.bookingId, "failed");
    await db.query(
      `insert into public.refunds (booking_id, payment_id, amount_cents, status)
       values ($1, $2, 100, 'pending')`,
      [p.bookingId, paid],
    );
    await expect(eraseGuest(p.id)).rejects.toThrow("guest_has_open_money");
  });

  it("refuses a succeeded payment with no issued document", async () => {
    const p = await person({ name: "Money" });
    await payment(p.bookingId, "succeeded");
    await expect(eraseGuest(p.id)).rejects.toThrow("guest_has_open_money");
  });

  it("a draft document does not count", async () => {
    const p = await person({ name: "Money" });
    const paid = await payment(p.bookingId, "succeeded");
    await db.query(
      `insert into public.invoices (booking_id, payment_id, doc_type) values ($1, $2, 'receipt')`,
      [p.bookingId, paid],
    );
    await expect(eraseGuest(p.id)).rejects.toThrow("guest_has_open_money");
  });

  it("a credit note alone does not count", async () => {
    const p = await person({ name: "Money" });
    const paid = await payment(p.bookingId, "succeeded");
    await issue(p.bookingId, paid);
    await db.query(
      `update public.invoices set exported_at = now() where payment_id = $1`,
      [paid],
    );
    await db.query(
      `alter table public.invoices disable trigger invoices_immutable`,
    );
    try {
      await db.query(
        `update public.invoices set doc_type = 'credit_note',
           credits_invoice_id = id where payment_id = $1`,
        [paid],
      );
    } finally {
      await db.query(
        `alter table public.invoices enable trigger invoices_immutable`,
      );
    }
    await expect(eraseGuest(p.id)).rejects.toThrow("guest_has_open_money");
  });

  it("allows it once the document is issued for that payment", async () => {
    const p = await person({ name: "Money" });
    const paid = await payment(p.bookingId, "succeeded");
    await issue(p.bookingId, paid);
    await eraseGuest(p.id);
  });

  it("allows a document issued for the booking as a whole", async () => {
    const p = await person({ name: "Money" });
    await payment(p.bookingId, "succeeded");
    await issue(p.bookingId, null);
    await eraseGuest(p.id);
  });

  it("failed payments are not open money", async () => {
    const p = await person({ name: "Money" });
    await payment(p.bookingId, "failed");
    await eraseGuest(p.id);
  });

  it("retention skips such a guest and keeps what they still need", async () => {
    const old = -366 * 6;
    const p = await person({ name: "Old money", from: old });
    await db.query(
      `update public.guests set created_at = now() - interval '6 years' where id = $1`,
      [p.id],
    );
    await payment(p.bookingId, "disputed");
    const { rows: mail } = await db.query(
      `insert into public.email_logs (template_key, recipient, booking_id, created_at, status)
       values ('booking_confirmation', $1, $2, now() - interval '6 years', 'sent') returning id`,
      [p.email, p.bookingId],
    );

    const { rows } = await db.query(
      `select public.apply_retention(false) as r`,
    );

    expect(rows[0].r.guests_skipped).toBeGreaterThanOrEqual(1);
    const { rows: guest } = await db.query(
      `select email from public.guests where id = $1`,
      [p.id],
    );
    expect(guest[0].email).toBe(p.email);
    const { rows: kept } = await db.query(
      `select 1 from public.email_logs where id = $1`,
      [mail[0].id],
    );
    expect(kept).toHaveLength(1);
    await db.query(`delete from public.payments where booking_id = $1`, [
      p.bookingId,
    ]);
  });
});

describe("retention", () => {
  it("strips calendar text from old audit rows", async () => {
    const id = randomUUID();
    const { rows } = await db.query(
      `insert into public.audit_log (action, entity, entity_id, after, created_at)
       values ('update', 'external_events', $1, '{"summary": "Reserved Maria", "uid": "x"}', now() - interval '6 years')
       returning id`,
      [id],
    );
    await db.query(`select public.apply_retention(false)`);
    const { rows: after } = await db.query(
      `select after from public.audit_log where id = $1`,
      [rows[0].id],
    );
    expect(after[0].after).toEqual({ uid: "x" });
  });

  it("a dry run leaves it alone", async () => {
    const { rows } = await db.query(
      `insert into public.audit_log (action, entity, entity_id, after, created_at)
       values ('update', 'external_events', $1, '{"summary": "Reserved"}', now() - interval '6 years')
       returning id`,
      [randomUUID()],
    );
    await db.query(`select public.apply_retention()`);
    const { rows: after } = await db.query(
      `select after from public.audit_log where id = $1`,
      [rows[0].id],
    );
    expect(after[0].after).toEqual({ summary: "Reserved" });
    await db.query(`delete from public.audit_log where id = $1`, [rows[0].id]);
  });
});

describe("the last Owner", () => {
  /** In a transaction, makes this the only Owner, then runs a change. */
  async function asOnlyOwner(id: string, change: string) {
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(
        `update public.admin_profiles set role = 'staff' where role = 'owner' and id <> $1`,
        [id],
      );
      await client.query(change, [id]);
    } finally {
      await client.query("rollback");
      client.release();
    }
  }

  it("cannot be deleted", async () => {
    const { id } = await createAdmin("owner");
    await expect(
      asOnlyOwner(id, `delete from public.admin_profiles where id = $1`),
    ).rejects.toThrow("last_owner");
  });

  it("cannot be demoted", async () => {
    const { id } = await createAdmin("owner");
    await expect(
      asOnlyOwner(
        id,
        `update public.admin_profiles set role = 'staff' where id = $1`,
      ),
    ).rejects.toThrow("last_owner");
  });

  it("does not stop an Owner when another remains", async () => {
    const { id } = await createAdmin("owner");
    await createAdmin("owner");
    await db.query(
      `update public.admin_profiles set role = 'staff' where id = $1`,
      [id],
    );
    await db.query(
      `update public.admin_profiles set role = 'owner' where id = $1`,
      [id],
    );
  });

  it("does not block a Staff change", async () => {
    const { id } = await createAdmin("staff");
    await db.query(
      `update public.admin_profiles set display_name = 'New' where id = $1`,
      [id],
    );
  });
});

describe("delete_auth_sessions", () => {
  async function withSession(userId: string) {
    const sessionId = randomUUID();
    await db.query(
      `insert into auth.sessions (id, user_id, created_at, updated_at) values ($1, $2, now(), now())`,
      [sessionId, userId],
    );
    await db.query(
      `insert into auth.refresh_tokens (token, user_id, session_id, revoked, created_at, updated_at)
       values ($1, $2, $3, false, now(), now())`,
      [randomUUID(), userId, sessionId],
    );
  }
  const counts = async (userId: string) => {
    const { rows } = await db.query(
      `select (select count(*)::int from auth.sessions where user_id = $1) as sessions,
              (select count(*)::int from auth.refresh_tokens where user_id = $2) as tokens`,
      [userId, userId],
    );
    return rows[0];
  };

  it("ends every session and refresh token of that person only", async () => {
    const { id } = await createAdmin("staff");
    const other = await createAdmin("staff");
    await withSession(id);
    await withSession(other.id);
    await db.query(`select public.delete_auth_sessions($1, $2)`, [id, actor]);
    expect(await counts(id)).toEqual({ sessions: 0, tokens: 0 });
    expect(await counts(other.id)).toEqual({ sessions: 1, tokens: 1 });
  });

  it("refuses Staff, and yourself", async () => {
    const staff = await createAdmin("staff");
    await expect(
      db.query(`select public.delete_auth_sessions($1, $2)`, [actor, staff.id]),
    ).rejects.toThrow("not_authorised");
    await expect(
      db.query(`select public.delete_auth_sessions($1, $1)`, [actor]),
    ).rejects.toThrow("cannot_change_self");
  });
});

describe("find_or_create_guest", () => {
  it("returns the same guest, unchanged", async () => {
    const p = await person({ name: "Repeat" });
    const { rows } = await db.query(
      `select public.find_or_create_guest($1::jsonb) as id`,
      [JSON.stringify({ email: p.email.toUpperCase(), name: "Changed" })],
    );
    expect(rows[0].id).toBe(p.id);
  });

  it("makes anonymise wait for a booking in progress, then see it", async () => {
    const p = await person({ name: "Racing" });
    const booking = await db.connect();
    try {
      await booking.query("begin");
      await booking.query(`select public.find_or_create_guest($1::jsonb)`, [
        JSON.stringify({ email: p.email }),
      ]);
      await booking.query(
        `update public.bookings set status = 'confirmed', check_in = $2, check_out = $3 where id = $1`,
        [p.bookingId, addDays(today, 150), addDays(today, 152)],
      );

      const erasing = eraseGuest(p.id).then(
        () => "erased",
        (error: Error) => error.message,
      );
      await new Promise((done) => setTimeout(done, 300));
      await booking.query("commit");
      expect(await erasing).toBe("guest_has_stay");
    } finally {
      booking.release();
    }
  });

  it("starts a new guest if the row was erased while it waited", async () => {
    const p = await person({ name: "Racing" });
    const eraser = await db.connect();
    try {
      await eraser.query("begin");
      await eraser.query(`select public.anonymise_guest($1, $2)`, [
        p.id,
        actor,
      ]);
      const finding = db.query(
        `select public.find_or_create_guest($1::jsonb) as id`,
        [JSON.stringify({ email: p.email, name: "New" })],
      );
      await new Promise((done) => setTimeout(done, 300));
      await eraser.query("commit");
      const { rows } = await finding;
      expect(rows[0].id).not.toBe(p.id);
      await db.query(`delete from public.guests where id = $1`, [rows[0].id]);
    } finally {
      eraser.release();
    }
  });
});

describe("run_database_job", () => {
  it("records a job stopped by a timeout as failed", async () => {
    const client = await db.connect();
    try {
      await client.query("begin");
      // Stands in for a real timeout, only for this job, only in this transaction.
      await client.query(`create or replace function public.purge_admin_attempts(p_older_than interval default interval '7 days')
        returns integer language plpgsql as $$ begin
          raise exception 'canceling statement' using errcode = 'query_canceled';
        end; $$`);
      await client.query(
        `select public.run_database_job('purge_admin_attempts')`,
      );
      const { rows } = await client.query(
        `select status from public.job_runs where job = 'purge_admin_attempts' order by id desc limit 1`,
      );
      expect(rows[0].status).toBe("failed");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });

  it("leaves a quiet hold run at most hourly, so its age shows", async () => {
    const client = await db.connect();
    try {
      await client.query("begin");
      await client.query(
        `delete from public.job_runs where job = 'release_expired_holds'`,
      );
      await client.query(
        `insert into public.job_runs (job, status, started_at, finished_at)
         values ('release_expired_holds', 'success', now() - interval '2 hours', now())`,
      );
      await client.query(
        `select public.run_database_job('release_expired_holds')`,
      );
      await client.query(
        `select public.run_database_job('release_expired_holds')`,
      );
      const { rows } = await client.query(
        `select count(*)::int as n from public.job_runs where job = 'release_expired_holds'`,
      );
      expect(rows[0].n).toBe(2);
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
