import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  admin,
  anon,
  confirm,
  createAdmin,
  createHold,
  createRoom,
  db,
} from "./helpers";

const DENIED = /permission denied|row-level security/;
const TOKEN = `tok-${randomUUID()}`;

const PRIVATE_TABLES = [
  "admin_attempts",
  "admin_profiles",
  "audit_log",
  "availability_blocks",
  "booking_reference_counters",
  "bookings",
  "cancellation_policies",
  "consent_log",
  "contact_messages",
  "email_logs",
  "email_templates",
  "external_calendars",
  "external_events",
  "guests",
  "holds",
  "ical_export_tokens",
  "inventory_claims",
  "invoice_lines",
  "invoice_series",
  "invoices",
  "job_runs",
  "payments",
  "promo_codes",
  "rate_overrides",
  "refunds",
  "restrictions",
  "seasons",
  "stripe_events",
  "sync_logs",
  "taxes_fees",
];

let owner: { id: string };
let staff: { id: string };
let roomId: string;
let bookingId: string;

beforeAll(async () => {
  owner = await createAdmin("owner");
  staff = await createAdmin("staff");
  roomId = await createRoom();
  bookingId = await createHold({
    roomId,
    checkIn: "2031-06-01",
    checkOut: "2031-06-05",
    token: TOKEN,
  });
  await db.query(
    `update public.bookings set internal_notes = 'private note' where id = $1`,
    [bookingId],
  );
  await confirm(bookingId);
  await db.query(
    `insert into public.settings (key, value) values ('test_private', '{"a":1}')
     on conflict do nothing`,
  );
  await db.query(
    `insert into public.faq (question, answer, status) values
     ('{"en":"draft q"}', '{"en":"a"}', 'draft'),
     ('{"en":"live q"}', '{"en":"a"}', 'published')`,
  );
  await db.query(
    `with p as (
       insert into public.pages (slug, status) values ($1, 'published') returning id
     )
     insert into public.content_blocks (page_id, key, draft, published)
     select id, 'hero', '{"t":"secret draft"}', '{"t":"live"}' from p`,
    [`p-${randomUUID()}`],
  );
});

afterAll(async () => {
  await db.end();
});

describe("structure", () => {
  it("every public table has RLS enabled and forced", async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not (c.relrowsecurity and c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("anon can execute only public_availability", async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.proname)).toEqual(["public_availability"]);
  });

  it("signed-in users can execute only the role helpers and availability", async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
       order by 1`,
    );
    expect(rows.map((r) => r.proname)).toEqual([
      "current_admin_role",
      "is_admin",
      "is_owner",
      "public_availability",
    ]);
  });

  it("every security definer function pins its search_path", async () => {
    const { rows } = await db.query(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef
         and not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')`,
    );
    expect(rows).toEqual([]);
  });

  it("the test list covers every table with no public access", async () => {
    const { rows } = await db.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
         and not has_table_privilege('anon', c.oid, 'select')
         and not has_any_column_privilege('anon', c.oid, 'select')
       order by 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual([...PRIVATE_TABLES].sort());
  });
});

describe("anonymous visitor", () => {
  it.each(PRIVATE_TABLES)("cannot read %s", async (table) => {
    await expect(
      anon((c) => c.query(`select * from public.${table} limit 1`)),
    ).rejects.toThrow(DENIED);
  });

  it("cannot write to public content", async () => {
    for (const sql of [
      `update public.property set name = 'hacked'`,
      `update public.rooms set base_price_cents = 0`,
      `delete from public.media`,
      `insert into public.faq (question, answer) values ('{}', '{}')`,
    ]) {
      await expect(anon((c) => c.query(sql))).rejects.toThrow(DENIED);
    }
  });

  it("sees published FAQ only", async () => {
    const { rows } = await anon((c) =>
      c.query(`select question from public.faq`),
    );
    const text = JSON.stringify(rows);
    expect(text).toContain("live q");
    expect(text).not.toContain("draft q");
  });

  it("cannot read draft text", async () => {
    await expect(
      anon((c) => c.query(`select draft from public.content_blocks`)),
    ).rejects.toThrow(DENIED);
    const { rows } = await anon((c) =>
      c.query(`select published from public.content_blocks`),
    );
    expect(JSON.stringify(rows)).toContain("live");
  });

  it("reads a photo's path and size, never who uploaded it", async () => {
    await expect(
      anon((c) => c.query(`select created_by from public.media limit 1`)),
    ).rejects.toThrow(DENIED);
    await expect(
      anon((c) => c.query(`select * from public.media limit 1`)),
    ).rejects.toThrow(DENIED);
    await anon((c) =>
      c.query(
        `select id, path, width, height, alt, focus_x, focus_y from public.media limit 1`,
      ),
    );
  });

  it("cannot change a photo's framing", async () => {
    const { rowCount } = await anon((c) =>
      c.query(`update public.media set focus_x = 10, focus_y = 10`),
    ).catch(() => ({ rowCount: 0 }));
    expect(rowCount ?? 0).toBe(0);
  });

  it("sees only public settings", async () => {
    const { rows } = await anon((c) =>
      c.query(`select key from public.settings`),
    );
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("languages");
    expect(keys).not.toContain("payment");
    expect(keys).not.toContain("test_private");
  });

  it("cannot create holds or read a booking by token", async () => {
    await expect(
      anon((c) =>
        c.query(
          `select public.create_hold(gen_random_uuid(), now()::date, now()::date, 1, 0,
           '{}'::jsonb, '{}'::jsonb, 0, 0, '{}'::jsonb, 'v', 'h', now())`,
        ),
      ),
    ).rejects.toThrow(DENIED);
    await expect(
      anon((c) => c.query(`select public.booking_for_token($1)`, [TOKEN])),
    ).rejects.toThrow(DENIED);
  });

  it("availability reveals yes or no per night and nothing else", async () => {
    const { rows } = await anon((c) =>
      c.query(
        `select * from public.public_availability($1, '2031-05-31', '2031-06-06')`,
        [roomId],
      ),
    );
    expect(Object.keys(rows[0]).sort()).toEqual(["is_available", "night"]);
    expect(rows.map((r) => r.is_available)).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("availability rejects an unbounded range", async () => {
    await expect(
      anon((c) =>
        c.query(
          `select * from public.public_availability($1, '2031-01-01', '2040-01-01')`,
          [roomId],
        ),
      ),
    ).rejects.toThrow("invalid_dates");
  });

  it("cannot upload to storage", async () => {
    await expect(
      anon((c) =>
        c.query(
          `insert into storage.objects (bucket_id, name) values ('media', 'x.jpg')`,
        ),
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("guest token (SUP-15)", () => {
  const byToken = async (token: string) =>
    (await db.query(`select public.booking_for_token($1) as r`, [token]))
      .rows[0].r;

  it("returns the booking without internal notes", async () => {
    const booking = await byToken(TOKEN);
    expect(booking.id).toBe(bookingId);
    expect(booking).not.toHaveProperty("internal_notes");
    expect(booking).not.toHaveProperty("access_token_hash");
  });

  it("returns nothing for a wrong token", async () => {
    expect(await byToken("wrong")).toBeNull();
  });

  it("returns nothing once expired", async () => {
    await db.query(
      `update public.bookings set access_token_expires_at = now() - interval '1 day' where id = $1`,
      [bookingId],
    );
    expect(await byToken(TOKEN)).toBeNull();
    await db.query(
      `update public.bookings set access_token_expires_at = '2099-01-01' where id = $1`,
      [bookingId],
    );
  });
});

describe("staff", () => {
  it("reads bookings, guests and availability", async () => {
    const { rows } = await admin(staff.id, "aal1", (c) =>
      c.query(`select id from public.bookings where id = $1`, [bookingId]),
    );
    expect(rows).toHaveLength(1);
  });

  it("can edit availability rules and message status", async () => {
    await admin(staff.id, "aal1", (c) =>
      c.query(
        `insert into public.restrictions (room_id, start_date, end_date, min_stay)
         values ($1, '2031-01-01', '2031-01-31', 3)`,
        [roomId],
      ),
    );
  });

  it("cannot change bookings or payments directly", async () => {
    for (const sql of [
      `update public.bookings set total_cents = 0`,
      `update public.payments set amount_cents = 1`,
      `delete from public.inventory_claims`,
    ]) {
      await expect(
        admin(staff.id, "aal1", (c) => c.query(sql)),
      ).rejects.toThrow(DENIED);
    }
  });

  it("gets no rows from owner-only data", async () => {
    for (const table of [
      "audit_log",
      "invoices",
      "stripe_events",
      "job_runs",
    ]) {
      const { rows } = await admin(staff.id, "aal1", (c) =>
        c.query(`select * from public.${table}`),
      );
      expect(rows).toEqual([]);
    }
  });

  it("cannot see private settings or change configuration", async () => {
    const { rows } = await admin(staff.id, "aal1", (c) =>
      c.query(`select key from public.settings`),
    );
    expect(rows.map((r) => r.key)).not.toContain("payment");

    const updated = await admin(staff.id, "aal1", (c) =>
      c.query(`update public.rooms set base_price_cents = 1`),
    );
    expect(updated.rowCount).toBe(0);
  });

  it("cannot promote itself to owner", async () => {
    const updated = await admin(staff.id, "aal1", (c) =>
      c.query(`update public.admin_profiles set role = 'owner' where id = $1`, [
        staff.id,
      ]),
    );
    expect(updated.rowCount).toBe(0);
  });

  it("cannot upload site photos", async () => {
    await expect(
      admin(staff.id, "aal1", (c) =>
        c.query(
          `insert into storage.objects (bucket_id, name) values ('media', 'x.jpg')`,
        ),
      ),
    ).rejects.toThrow(DENIED);
  });

  it("cannot call server-only functions", async () => {
    await expect(
      admin(staff.id, "aal1", (c) =>
        c.query(`select public.cancel_booking($1)`, [bookingId]),
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("owner", () => {
  it("has no admin access until MFA is verified (SUP-13)", async () => {
    const { rows } = await admin(owner.id, "aal1", (c) =>
      c.query(`select id from public.bookings`),
    );
    expect(rows).toEqual([]);
    const profile = await admin(owner.id, "aal1", (c) =>
      c.query(`select role from public.admin_profiles where id = $1`, [
        owner.id,
      ]),
    );
    expect(profile.rows[0].role).toBe("owner");
  });

  it("reads everything after MFA, including the audit log", async () => {
    const { rows } = await admin(owner.id, "aal2", (c) =>
      c.query(`select id from public.bookings where id = $1`, [bookingId]),
    );
    expect(rows).toHaveLength(1);
    const audit = await admin(owner.id, "aal2", (c) =>
      c.query(
        `select after from public.audit_log where entity = 'bookings' and entity_id = $1`,
        [bookingId],
      ),
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit.rows)).not.toContain("@example.test");
  });

  it("changes rules and manages photos (D6, T4.24a)", async () => {
    await admin(owner.id, "aal2", async (c) => {
      const updated = await c.query(
        `update public.settings set value = '{"mode":"full"}' where key = 'payment'`,
      );
      expect(updated.rowCount).toBe(1);
      await c.query(
        `insert into storage.objects (bucket_id, name) values ('media', 'owner.jpg')`,
      );
    });
  });

  it("cannot change bookings directly either", async () => {
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`update public.bookings set total_cents = 0`),
      ),
    ).rejects.toThrow(DENIED);
  });

  it("cannot read private invoices through storage", async () => {
    await db.query(
      `insert into storage.objects (bucket_id, name) values ('invoices', $1)`,
      [`${randomUUID()}.pdf`],
    );
    const { rows } = await admin(owner.id, "aal2", (c) =>
      c.query(`select name from storage.objects where bucket_id = 'invoices'`),
    );
    expect(rows).toEqual([]);
  });

  it("nobody reads iCal export tokens through the API", async () => {
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select * from public.ical_export_tokens`),
      ),
    ).rejects.toThrow(DENIED);
  });
});

describe("rules snapshot (D6)", () => {
  it("editing settings leaves an existing booking's rules unchanged", async () => {
    const original = await db.query(
      `select value from public.settings where key = 'payment'`,
    );
    const before = await db.query(
      `select rules_snapshot from public.bookings where id = $1`,
      [bookingId],
    );
    await db.query(
      `update public.settings set value = '{"mode":"changed"}' where key = 'payment'`,
    );
    const after = await db.query(
      `select rules_snapshot from public.bookings where id = $1`,
      [bookingId],
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
    await db.query(
      `update public.settings set value = $1 where key = 'payment'`,
      [JSON.stringify(original.rows[0].value)],
    );
  });
});
