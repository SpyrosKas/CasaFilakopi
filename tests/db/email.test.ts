import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/types";
import type { EmailDb } from "@/lib/email/db";
import {
  deriveGuestToken,
  hashGuestToken,
  issueGuestToken,
} from "@/lib/email/guest-link";
import {
  queueEmailWith,
  type EmailData,
  type EmailType,
  type QueueOptions,
} from "@/lib/email/queue";
import { sendScheduledEmails } from "@/lib/email/scheduled";
import { TransportError, type EmailTransport } from "@/lib/email/transport";
import { memoryTransport } from "@/lib/email/transports/memory";
import { applyEvent } from "@/lib/email/webhook";
import { MAX_ATTEMPTS, processQueue } from "@/lib/email/worker";
import { confirm, createHold, createRoom, db } from "./helpers";

// Runs the real queue on the real schema. The database is shared with other
// tracks, so every worker run here names its own rows (onlyIds), and everything
// is removed afterwards.

const status = JSON.parse(
  execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
) as { API_URL: string; SECRET_KEY: string };

if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(status.API_URL)) {
  throw new Error("Email database tests run against local Supabase only");
}

const client: EmailDb = createClient<Database>(
  status.API_URL,
  status.SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const env = {
  siteUrl: "https://casa.example.com",
  guestTokenSecret: "test-guest-token-secret",
};

const bookings: string[] = [];
const contactIds: string[] = [];
const storedFiles: string[] = [];
let roomId: string;
let year = 2200 + Math.floor(Math.random() * 500);

beforeAll(async () => {
  roomId = await createRoom();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(async () => {
  await db.query(
    `delete from public.email_logs where booking_id = any($1::uuid[])
       or contact_message_id = any($2::uuid[])
       or recipient like 'email-db-%@example.test'`,
    [bookings, contactIds],
  );
  await db.query(`delete from public.contact_messages where id = any($1)`, [
    contactIds,
  ]);
  await db.query(`delete from public.payments where booking_id = any($1)`, [
    bookings,
  ]);
  await db.query(`delete from public.bookings where id = any($1)`, [bookings]);
  await db.query(`delete from public.rooms where id = $1`, [roomId]);
  if (storedFiles.length) {
    await client.storage.from("uploads-private").remove(storedFiles);
  }
  await db.end();
});

interface BookingOptions {
  checkIn?: string;
  checkOut?: string;
  breakdown?: object;
  rules?: object;
  locale?: string;
}

/** A confirmed stay in a far-off year, so no other test's dates are touched. */
async function booking(options: BookingOptions = {}) {
  year += 1;
  const checkIn = options.checkIn ?? `${year}-07-10`;
  const checkOut = options.checkOut ?? `${year}-07-17`;
  const email = `email-db-${randomUUID()}@example.test`;
  const id = await createHold({
    roomId,
    checkIn,
    checkOut,
    email,
    name: "Mia",
  });
  bookings.push(id);
  await confirm(id);
  await db.query(
    `update public.bookings
     set price_breakdown = $2, rules_snapshot = $3, locale = $4, total_cents = 10000
     where id = $1`,
    [
      id,
      JSON.stringify(options.breakdown ?? { nights: [] }),
      JSON.stringify(
        options.rules ?? {
          cancellation: {
            isNonRefundable: false,
            tiers: [{ daysBefore: 30, refundPercent: 100 }],
          },
        },
      ),
      options.locale ?? "en",
    ],
  );
  return { id, email, checkIn, checkOut };
}

async function logRow(id: string) {
  const { rows } = await db.query(
    `select * from public.email_logs where id = $1`,
    [id],
  );
  return rows[0];
}

async function logRows(bookingId: string) {
  const { rows } = await db.query(
    `select * from public.email_logs where booking_id = $1 order by created_at`,
    [bookingId],
  );
  return rows;
}

/** Queues, and returns the single new row. */
async function queued<T extends EmailType>(
  type: T,
  data: EmailData<T>,
  options?: QueueOptions,
) {
  const result = await queueEmailWith(client, type, data, options);
  if (!result.ok) throw new Error(result.reason);
  expect(result.ids).toHaveLength(1);
  return result.ids[0];
}

// Rows made here use the database's now(), and Docker's clock can run a few
// milliseconds ahead of this process, so a row could look not yet due. Live,
// that only means it goes on the next run. Here the run must find it.
const CLOCK_MARGIN_MS = 5_000;

const worker = (transport: EmailTransport | null, onlyIds: string[]) =>
  processQueue({
    db: client,
    transport,
    env,
    onlyIds,
    now: () => new Date(Date.now() + CLOCK_MARGIN_MS),
  });

describe("queueEmail", () => {
  it("queues once for a booking, however many times it is called", async () => {
    const { id, email } = await booking();
    const first = await queueEmailWith(client, "booking_confirmation", {
      bookingId: id,
    });
    const second = await queueEmailWith(client, "booking_confirmation", {
      bookingId: id,
    });
    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toEqual({ ok: true, ids: [], duplicate: true });

    const rows = await logRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].recipient).toBe(email);
    expect(rows[0].status).toBe("queued");
  });

  it("uses the booking's language", async () => {
    const { id } = await booking({ locale: "el" });
    const logId = await queued("booking_confirmation", { bookingId: id });
    expect((await logRow(logId)).locale).toBe("el");
  });

  it("never throws and reports a missing booking", async () => {
    await expect(
      queueEmailWith(client, "booking_confirmation", {
        bookingId: randomUUID(),
      }),
    ).resolves.toEqual({ ok: false, reason: "booking_not_found" });
  });

  it("reports bad data without throwing", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await expect(
      queueEmailWith(client, "booking_confirmation", {
        bookingId: "not-an-id",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid_data" });
  });

  it("keeps ids, not guest details or links, in the payload", async () => {
    const { id } = await booking();
    const logId = await queued("booking_cancellation", {
      bookingId: id,
      refundCents: 500,
    });
    expect((await logRow(logId)).payload).toEqual({ refundCents: 500 });
  });

  it("queues host emails to each configured recipient", async () => {
    const { id } = await booking();
    const result = await queueEmailWith(client, "host_new_booking", {
      bookingId: id,
    });
    expect(result).toMatchObject({ ok: true });
    const rows = await logRows(id);
    expect(rows[0].recipient).toBe("host@miloscasa.com");
    expect(rows[0].locale).toBe("el");
  });
});

describe("worker", () => {
  it("sends in the guest's language and marks the row sent", async () => {
    const { id, email } = await booking({ locale: "el" });
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport = memoryTransport();

    const result = await worker(transport, [logId]);

    expect(result).toMatchObject({ status: "ok", sent: 1, failed: 0 });
    const [sent] = transport.sent;
    expect(sent.to).toBe(email);
    expect(sent.from).toEqual({
      name: "Casa Filakopi",
      address: "bookings@mail.miloscasa.com",
    });
    expect(sent.replyTo).toBe("host@miloscasa.com");
    expect(sent.subject).toContain("επιβεβαιώθηκε");
    expect(sent.html).toContain("Mia");
    expect(sent.text).toContain("100%");
    expect(sent.attachments.map((file) => file.filename)).toEqual([
      "casa-filakopi.ics",
    ]);

    const row = await logRow(logId);
    expect(row.status).toBe("sent");
    expect(row.resend_id).toBeTruthy();
    expect(row.sent_at).toBeTruthy();
    expect(row.attempts).toBe(1);
  });

  it("never sends one row twice under concurrency", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    // A slow send, so every worker is in flight together.
    const transport = memoryTransport(
      () => new Promise((resolve) => setTimeout(resolve, 50)),
    );

    const results = await Promise.all(
      Array.from({ length: 12 }, () => worker(transport, [logId])),
    );

    expect(transport.sent).toHaveLength(1);
    expect(results.reduce((total, item) => total + item.sent, 0)).toBe(1);
    expect((await logRow(logId)).attempts).toBe(1);
  });

  it("shares a batch between racing workers without overlap", async () => {
    const stays = await Promise.all([booking(), booking(), booking()]);
    const ids = await Promise.all(
      stays.map((stay) => queued("thank_you", { bookingId: stay.id })),
    );
    const transport = memoryTransport();

    await Promise.all(Array.from({ length: 6 }, () => worker(transport, ids)));

    const logIds = transport.sent.map((email) => email.logId).sort();
    expect(logIds).toEqual([...ids].sort());
  });

  it("does not resend a row that is sending and still leased", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    await db.query(
      `update public.email_logs
       set status = 'sending', next_attempt_at = now() + interval '5 minutes'
       where id = $1`,
      [logId],
    );
    const transport = memoryTransport();
    await worker(transport, [logId]);
    expect(transport.sent).toHaveLength(0);
  });

  it("takes back a row whose worker died", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    await db.query(
      `update public.email_logs
       set status = 'sending', attempts = 1, next_attempt_at = now() - interval '1 minute'
       where id = $1`,
      [logId],
    );
    const transport = memoryTransport();
    await worker(transport, [logId]);
    expect(transport.sent).toHaveLength(1);
    expect(await logRow(logId)).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("does not send before next_attempt_at", async () => {
    const { id } = await booking();
    const logId = await queued(
      "booking_confirmation",
      { bookingId: id },
      { sendAt: new Date(Date.now() + 3_600_000) },
    );
    const transport = memoryTransport();
    await worker(transport, [logId]);
    expect(transport.sent).toHaveLength(0);
    expect((await logRow(logId)).status).toBe("queued");
  });

  it("backs off after a failure, then gives up and stays visible", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport: EmailTransport = {
      name: "broken",
      send: async () => {
        throw new TransportError("provider down", true);
      },
    };

    const delays: number[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      await worker(transport, [logId]);
      const row = await logRow(logId);
      expect(row.attempts).toBe(attempt);
      expect(row.last_error).toBe("provider down");
      if (attempt < MAX_ATTEMPTS) {
        expect(row.status).toBe("queued");
        delays.push(new Date(row.next_attempt_at).getTime() - Date.now());
        await db.query(
          `update public.email_logs set next_attempt_at = now() where id = $1`,
          [logId],
        );
      }
    }
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[0]).toBeGreaterThan(50_000);
    expect((await logRow(logId)).status).toBe("failed");
  });

  it("does not retry what can never work", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport: EmailTransport = {
      name: "refusing",
      send: async () => {
        throw new TransportError("invalid address", false);
      },
    };
    expect(await worker(transport, [logId])).toMatchObject({ failed: 1 });
    expect(await logRow(logId)).toMatchObject({
      status: "failed",
      attempts: 1,
    });
  });

  it("queues safely with no transport, using up no attempts", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    const result = await worker(null, [logId]);
    expect(result.status).toBe("not_configured");
    expect(result.waiting).toBeGreaterThan(0);
    expect(await logRow(logId)).toMatchObject({
      status: "queued",
      attempts: 0,
    });
  });

  it("sends a row another track wrote directly (host_message)", async () => {
    const { id, email } = await booking();
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, locale, booking_id, payload)
       values ('host_message', $1, 'en', $2, $3) returning id`,
      [
        email,
        id,
        JSON.stringify({
          subject: "A note\r\nBcc: x@example.test",
          body: "See you <soon>\nYorgos {{reference}}",
          sent_by: randomUUID(),
        }),
      ],
    );
    const transport = memoryTransport();
    await worker(transport, [rows[0].id]);
    const [sent] = transport.sent;
    expect(sent.subject).toBe("A note Bcc: x@example.test");
    expect(sent.text).toContain("See you <soon>\nYorgos {{reference}}");
    expect(sent.html).toContain("See you &lt;soon&gt;<br>");
  });

  it("sends a sync conflict row written directly by CHN", async () => {
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, locale, payload)
       values ('sync_conflict', $1, 'en', $2) returning id`,
      [
        `email-db-${randomUUID()}@example.test`,
        JSON.stringify({
          channel: "Airbnb",
          checkIn: "2300-07-10",
          checkOut: "2300-07-12",
          summary: "Reserved",
        }),
      ],
    );
    const transport = memoryTransport();
    await worker(transport, [rows[0].id]);
    expect(transport.sent[0].subject).toBe(
      "Calendar conflict: Airbnb, 10 July 2300 to 12 July 2300",
    );
  });

  it("marks an unknown template failed, not stuck", async () => {
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient) values ('no_such', $1) returning id`,
      [`email-db-${randomUUID()}@example.test`],
    );
    await worker(memoryTransport(), [rows[0].id]);
    expect(await logRow(rows[0].id)).toMatchObject({
      status: "failed",
      last_error: "unknown template no_such",
    });
  });

  it("uses the text Yorgos saved in Admin", async () => {
    const { id } = await booking();
    await db.query(
      `insert into public.email_templates (key, locale, subject, body)
       values ('pre_arrival', 'en', 'See you {{guestName}}', 'Saved text.')
       on conflict (key, locale) do update set subject = excluded.subject, body = excluded.body`,
    );
    try {
      const logId = await queued("pre_arrival", { bookingId: id });
      const transport = memoryTransport();
      await worker(transport, [logId]);
      expect(transport.sent[0].subject).toBe("See you Mia");
      expect(transport.sent[0].text).toContain("Saved text.");
    } finally {
      await db.query(
        `delete from public.email_templates where key = 'pre_arrival' and locale = 'en'`,
      );
    }
  });
});

describe("attachments", () => {
  it("keeps a storage path in the row and sends the bytes", async () => {
    const { id } = await booking();
    const path = `email-tests/${randomUUID()}.pdf`;
    const bytes = Buffer.from("%PDF-1.4 test");
    const upload = await client.storage
      .from("uploads-private")
      .upload(path, bytes, { contentType: "application/pdf" });
    expect(upload.error).toBeNull();
    storedFiles.push(path);

    const logId = await queued(
      "thank_you",
      { bookingId: id },
      {
        attachments: [
          {
            bucket: "uploads-private",
            path,
            filename: "guide.pdf",
            contentType: "application/pdf",
          },
        ],
      },
    );
    const row = await logRow(logId);
    expect(row.payload.attachments[0].path).toBe(path);
    expect(JSON.stringify(row.payload)).not.toContain("PDF-1.4");

    const transport = memoryTransport();
    await worker(transport, [logId]);
    const [file] = transport.sent[0].attachments;
    expect(file.filename).toBe("guide.pdf");
    expect(file.content.equals(bytes)).toBe(true);
  });

  it("retries when the file cannot be read", async () => {
    const { id } = await booking();
    const logId = await queued(
      "thank_you",
      { bookingId: id },
      {
        attachments: [
          {
            bucket: "uploads-private",
            path: `email-tests/${randomUUID()}.pdf`,
            filename: "missing.pdf",
            contentType: "application/pdf",
          },
        ],
      },
    );
    const transport = memoryTransport();
    await worker(transport, [logId]);
    expect(transport.sent).toHaveLength(0);
    expect((await logRow(logId)).status).toBe("queued");
  });
});

describe("provisional documents (D17)", () => {
  it("refuses to queue the invoice email", async () => {
    const { id } = await booking();
    const result = await queueEmailWith(client, "invoice_document", {
      bookingId: id,
      invoiceId: randomUUID(),
    });
    expect(result).toEqual({ ok: false, reason: "provisional_blocked" });
    expect(await logRows(id)).toHaveLength(0);
  });

  it("stays refused when the Admin switch is on", async () => {
    await db.query(
      `insert into public.settings (key, value)
       values ('email', '{"invoiceEmailEnabled": true}')`,
    );
    try {
      const { id } = await booking();
      const result = await queueEmailWith(client, "invoice_document", {
        bookingId: id,
        invoiceId: randomUUID(),
      });
      expect(result).toEqual({ ok: false, reason: "provisional_blocked" });
    } finally {
      await db.query(`delete from public.settings where key = 'email'`);
    }
  });

  it("blocks a row written directly, at the last step", async () => {
    const { id, email } = await booking();
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, booking_id, payload)
       values ('invoice_document', $1, $2, $3) returning id`,
      [
        email,
        id,
        JSON.stringify({ invoiceId: randomUUID(), documentNumber: "TEST-1" }),
      ],
    );
    const transport = memoryTransport();
    expect(await worker(transport, [rows[0].id])).toMatchObject({ failed: 1 });
    expect(transport.sent).toHaveLength(0);
    expect((await logRow(rows[0].id)).last_error).toContain(
      "provisional_blocked",
    );
  });

  it("blocks an invoice file attached to any other guest email", async () => {
    const { id, email } = await booking();
    const { rows } = await db.query(
      `insert into public.email_logs (template_key, recipient, booking_id, payload)
       values ('host_message', $1, $2, $3) returning id`,
      [
        email,
        id,
        JSON.stringify({
          subject: "Your invoice",
          body: "Attached",
          attachments: [
            {
              bucket: "invoices",
              path: "x.pdf",
              filename: "x.pdf",
              contentType: "application/pdf",
            },
          ],
        }),
      ],
    );
    const transport = memoryTransport();
    await worker(transport, [rows[0].id]);
    expect(transport.sent).toHaveLength(0);
    expect((await logRow(rows[0].id)).status).toBe("failed");
  });
});

describe("guest links", () => {
  const linkOf = (text: string) => /https:\S+\/booking\/\S+/.exec(text)?.[0];

  it("puts a working link in the email and none in the row", async () => {
    const { id } = await booking();
    const token = await issueGuestToken(client, id, env.guestTokenSecret);
    await db.query(
      `update public.bookings set access_token_expires_at = now() + interval '1 day' where id = $1`,
      [id],
    );
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport = memoryTransport();
    await worker(transport, [logId]);

    expect(linkOf(transport.sent[0].text)).toBe(
      `https://casa.example.com/en/booking/${token}`,
    );
    const row = await logRow(logId);
    expect(JSON.stringify(row)).not.toContain(token);

    const { rows } = await db.query(
      `select public.booking_for_token($1) as booking`,
      [token],
    );
    expect(rows[0].booking.id).toBe(id);
  });

  it("gives a manual booking with no token a link of its own", async () => {
    const { id } = await booking();
    await db.query(
      `update public.bookings
       set access_token_hash = null, access_token_expires_at = null where id = $1`,
      [id],
    );
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport = memoryTransport();
    await worker(transport, [logId]);

    expect(linkOf(transport.sent[0].text)).toBeTruthy();
    const { rows } = await db.query(
      `select access_token_hash from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0].access_token_hash).toBe(
      hashGuestToken(deriveGuestToken(env.guestTokenSecret, id)),
    );
  });

  it("never replaces a token it did not issue", async () => {
    const { id } = await booking();
    const before = await db.query(
      `select access_token_hash from public.bookings where id = $1`,
      [id],
    );
    const logId = await queued("booking_confirmation", { bookingId: id });
    const transport = memoryTransport();
    await worker(transport, [logId]);

    expect(linkOf(transport.sent[0].text)).toBeUndefined();
    const after = await db.query(
      `select access_token_hash from public.bookings where id = $1`,
      [id],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("will not send a balance request with no way to pay", async () => {
    const { id } = await booking();
    await db.query(
      `update public.bookings set total_cents = 20000 where id = $1`,
      [id],
    );
    const logId = await queued("balance_request", { bookingId: id });
    const transport = memoryTransport();
    const result = await processQueue({
      db: client,
      transport,
      env: { siteUrl: env.siteUrl },
      onlyIds: [logId],
      now: () => new Date(Date.now() + CLOCK_MARGIN_MS),
    });
    expect(result.retried).toBe(1);
    expect(transport.sent).toHaveLength(0);
    expect(await logRow(logId)).toMatchObject({
      status: "queued",
      last_error: "guest link unavailable",
    });
  });
});

describe("webhook events", () => {
  async function sent() {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    await worker(memoryTransport(), [logId]);
    const row = await logRow(logId);
    return { logId, resendId: row.resend_id as string };
  }

  const event = (type: string, email_id: string, extra = {}) => ({
    type,
    data: { email_id, ...extra },
  });

  it("marks a row delivered, and a replay changes nothing", async () => {
    const { logId, resendId } = await sent();
    expect(await applyEvent(client, event("email.delivered", resendId))).toBe(
      "updated",
    );
    expect((await logRow(logId)).status).toBe("delivered");
    expect(await applyEvent(client, event("email.delivered", resendId))).toBe(
      "unchanged",
    );
    expect((await logRow(logId)).status).toBe("delivered");
  });

  it("keeps a bounce with its reason, whatever arrives later", async () => {
    const { logId, resendId } = await sent();
    await applyEvent(
      client,
      event("email.bounced", resendId, { bounce: { message: "No mailbox" } }),
    );
    expect(await logRow(logId)).toMatchObject({
      status: "bounced",
      last_error: "No mailbox",
    });
    await applyEvent(client, event("email.delivered", resendId));
    expect((await logRow(logId)).status).toBe("bounced");
  });

  it("finds a row by tag if the event beats the worker", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    await db.query(
      `update public.email_logs set status = 'sending' where id = $1`,
      [logId],
    );
    const outcome = await applyEvent(
      client,
      event("email.delivered", randomUUID(), {
        tags: { email_log_id: logId },
      }),
    );
    expect(outcome).toBe("updated");
    expect((await logRow(logId)).status).toBe("delivered");
  });

  it("keeps the webhook's status when the worker finishes second", async () => {
    const { id } = await booking();
    const logId = await queued("booking_confirmation", { bookingId: id });
    const resendId = randomUUID();
    const transport: EmailTransport = {
      name: "racing",
      send: async () => {
        await applyEvent(
          client,
          event("email.delivered", resendId, {
            tags: { email_log_id: logId },
          }),
        );
        return { id: resendId };
      },
    };
    await worker(transport, [logId]);
    expect(await logRow(logId)).toMatchObject({
      status: "delivered",
      resend_id: resendId,
    });
  });

  it("ignores events for other environments and other kinds", async () => {
    expect(await applyEvent(client, event("email.delivered", "unknown"))).toBe(
      "ignored",
    );
    expect(await applyEvent(client, event("email.opened", "unknown"))).toBe(
      "ignored",
    );
  });
});

describe("sendScheduledEmails", () => {
  const dueBooking = (dueOn: string, options: BookingOptions = {}) =>
    booking({
      ...options,
      breakdown: { nights: [], balanceCents: 5000, balanceDueOn: dueOn },
    });

  const run = (now: string, ...ids: string[]) =>
    sendScheduledEmails(client, new Date(now), { bookingIds: ids });

  const keysOf = async (id: string) =>
    (await logRows(id)).map((row) => row.template_key);

  /** confirm() paid 10000, so raising the total leaves a balance. */
  async function owing(id: string) {
    await db.query(
      `update public.bookings set total_cents = 20000 where id = $1`,
      [id],
    );
  }

  it("uses the date on Milos, not the server's", async () => {
    const stay = await dueBooking("2500-06-28", {
      checkIn: "2500-07-20",
      checkOut: "2500-07-25",
    });
    await owing(stay.id);

    // 23:59 on the 27th on Milos, summer time.
    await run("2500-06-27T20:59:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual([]);

    // 00:30 on the 28th on Milos, still the 27th in UTC.
    const result = await run("2500-06-27T21:30:00Z", stay.id);
    expect(result.today).toBe("2500-06-28");
    expect(await keysOf(stay.id)).toEqual(["balance_request"]);

    // Queued at night, it waits for the morning.
    const [row] = await logRows(stay.id);
    expect(new Date(row.next_attempt_at).toISOString()).toBe(
      "2500-06-28T06:00:00.000Z",
    );
  });

  it("queues each email once, even when runs race", async () => {
    const stay = await dueBooking("2501-06-28", {
      checkIn: "2501-07-20",
      checkOut: "2501-07-25",
    });
    await owing(stay.id);
    await Promise.all(
      Array.from({ length: 8 }, () => run("2501-06-28T10:00:00Z", stay.id)),
    );
    await run("2501-06-28T11:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual(["balance_request"]);
  });

  it("sends the reminder three days after, once", async () => {
    const stay = await dueBooking("2502-06-28", {
      checkIn: "2502-07-20",
      checkOut: "2502-07-25",
    });
    await owing(stay.id);
    await run("2502-06-28T10:00:00Z", stay.id);
    await run("2502-06-30T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual(["balance_request"]);
    await run("2502-07-01T10:00:00Z", stay.id);
    await run("2502-07-02T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual([
      "balance_request",
      "balance_reminder",
    ]);
  });

  it("catches up after a missed day, one email at a time", async () => {
    const stay = await dueBooking("2503-06-28", {
      checkIn: "2503-07-20",
      checkOut: "2503-07-25",
    });
    await owing(stay.id);
    await run("2503-07-05T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual(["balance_request"]);
  });

  it("asks nothing of a guest who has paid", async () => {
    const stay = await dueBooking("2504-06-28", {
      checkIn: "2504-07-20",
      checkOut: "2504-07-25",
    });
    // confirm() recorded a payment of the whole 10000.
    await run("2504-06-28T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual([]);
  });

  it("skips a cancelled booking", async () => {
    const stay = await dueBooking("2505-06-28", {
      checkIn: "2505-07-20",
      checkOut: "2505-07-25",
    });
    await owing(stay.id);
    await db.query(
      `update public.bookings set status = 'cancelled' where id = $1`,
      [stay.id],
    );
    await run("2505-06-28T10:00:00Z", stay.id);
    await run("2505-07-18T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual([]);
  });

  it("does not send what was queued before a cancellation", async () => {
    const stay = await dueBooking("2506-06-28", {
      checkIn: "2506-07-20",
      checkOut: "2506-07-25",
    });
    await owing(stay.id);
    await run("2506-06-28T10:00:00Z", stay.id);
    const [row] = await logRows(stay.id);
    await db.query(
      `update public.email_logs set next_attempt_at = now() where id = $1`,
      [row.id],
    );
    await db.query(
      `update public.bookings set status = 'cancelled' where id = $1`,
      [stay.id],
    );

    const transport = memoryTransport();
    expect(await worker(transport, [row.id])).toMatchObject({ skipped: 1 });
    expect(transport.sent).toHaveLength(0);
    expect((await logRow(row.id)).last_error).toContain("skipped");
  });

  it("sends pre-arrival three days before, and to a late booker", async () => {
    const stay = await booking({
      checkIn: "2507-07-20",
      checkOut: "2507-07-25",
    });
    await run("2507-07-16T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual([]);
    await run("2507-07-17T10:00:00Z", stay.id);
    await run("2507-07-18T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).toEqual(["pre_arrival"]);
  });

  it("leaves the thank-you off by default", async () => {
    const stay = await booking({
      checkIn: "2508-07-20",
      checkOut: "2508-07-25",
    });
    await run("2508-07-26T10:00:00Z", stay.id);
    expect(await keysOf(stay.id)).not.toContain("thank_you");
  });

  it("follows rules per language, on or off, once per booking", async () => {
    const stay = await booking({
      checkIn: "2509-07-20",
      checkOut: "2509-07-25",
      locale: "el",
    });
    const rule = (id: string, enabled: boolean) => ({
      id,
      name: id,
      enabled,
      anchor: "check_in",
      offsetDays: -7,
      copy: {
        en: { subject: "A week to go", body: "Hi {{guestName}}" },
        el: { subject: "Μία εβδομάδα", body: "Γεια {{guestName}}" },
      },
    });
    await db.query(
      `insert into public.settings (key, value) values ('scheduled_messages', $1)`,
      [JSON.stringify([rule("on", true), rule("off", false)])],
    );
    try {
      await run("2509-07-12T10:00:00Z", stay.id);
      expect(await keysOf(stay.id)).toEqual([]);
      await run("2509-07-13T10:00:00Z", stay.id);
      await run("2509-07-13T11:00:00Z", stay.id);
      const rows = await logRows(stay.id);
      expect(rows).toHaveLength(1);
      expect(rows[0].payload.ruleId).toBe("on");

      await db.query(
        `update public.email_logs set next_attempt_at = now() where id = $1`,
        [rows[0].id],
      );
      const transport = memoryTransport();
      await worker(transport, [rows[0].id]);
      expect(transport.sent[0].subject).toBe("Μία εβδομάδα");
      expect(transport.sent[0].text).toContain("Γεια Mia");

      // Past its short catch-up, a new rule leaves older stays alone.
      const late = await booking({
        checkIn: "2509-08-20",
        checkOut: "2509-08-25",
      });
      await run("2509-08-17T10:00:00Z", late.id);
      expect(await keysOf(late.id)).not.toContain("scheduled_message");
    } finally {
      await db.query(
        `delete from public.settings where key = 'scheduled_messages'`,
      );
    }
  });

  it("holds a one-off until its date", async () => {
    const { id } = await booking();
    const result = await queueEmailWith(
      client,
      "scheduled_message",
      { bookingId: id, subject: "One", body: "Just you" },
      { sendAt: new Date("2099-01-01T07:00:00Z") },
    );
    if (!result.ok) throw new Error(result.reason);
    const [logId] = result.ids;

    const transport = memoryTransport();
    await worker(transport, [logId]);
    expect(transport.sent).toHaveLength(0);

    await db.query(
      `update public.email_logs set next_attempt_at = now() where id = $1`,
      [logId],
    );
    await worker(transport, [logId]);
    expect(transport.sent[0].subject).toBe("One");
  });
});
