import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  admin,
  asRole,
  confirm,
  createAdmin,
  createHold,
  createRoom,
  db,
  expireHold,
  PRICE,
  RULES,
} from "./helpers";

// One test for each finding of the independent review (T2.22).

let roomId: string;

beforeEach(async () => {
  roomId = await createRoom();
});

afterAll(async () => {
  await db.end();
});

const JUNE = { checkIn: "2032-06-01", checkOut: "2032-06-05" };

const statusOf = async (id: string) =>
  (await db.query(`select status from public.bookings where id = $1`, [id]))
    .rows[0].status as string;

const claimsOf = async (id: string) =>
  (
    await db.query(
      `select count(*)::int as n from public.inventory_claims where booking_id = $1`,
      [id],
    )
  ).rows[0].n as number;

const paymentOf = async (id: string) =>
  (await db.query(`select id from public.payments where booking_id = $1`, [id]))
    .rows[0].id as string;

const addCalendar = async () =>
  (
    await db.query(
      `insert into public.external_calendars (room_id, channel)
       values ($1, 'airbnb') returning id`,
      [roomId],
    )
  ).rows[0].id as string;

const paid = async () => {
  const id = await createHold({ roomId, ...JUNE });
  await confirm(id);
  return { id, paymentId: await paymentOf(id) };
};

describe("replayed Stripe events (finding 1)", () => {
  it("a replay after dates_lost never takes the dates, even when they are free again", async () => {
    const late = await createHold({ roomId, ...JUNE });
    await expireHold(late);
    const winner = await createHold({ roomId, ...JUNE });
    await confirm(winner);
    const intent = randomUUID();

    expect((await confirm(late, intent)).outcome).toBe("dates_lost");
    await db.query(`select public.cancel_booking($1)`, [winner]);

    expect((await confirm(late, intent)).outcome).toBe("dates_lost");
    expect(await statusOf(late)).toBe("expired");
    expect(await claimsOf(late)).toBe(0);
  });

  it("a replay after a legitimate cancel does not report dates_lost", async () => {
    const id = await createHold({ roomId, ...JUNE });
    const intent = randomUUID();
    await confirm(id, intent);
    await db.query(`select public.cancel_booking($1)`, [id]);

    expect((await confirm(id, intent)).outcome).toBe("already_confirmed");
    expect(await statusOf(id)).toBe("cancelled");
  });
});

describe("imports that collide with a hold (findings 2 and 3)", () => {
  const upsert = (calendar: string, start: string, end: string) =>
    db.query(`select public.upsert_external_event($1, $2, $3, $4) as r`, [
      calendar,
      randomUUID(),
      start,
      end,
    ]);

  it("refuses to confirm dates an import has already sold", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await upsert(await addCalendar(), "2032-06-03", "2032-06-08");

    expect((await confirm(id)).outcome).toBe("dates_lost");
    expect(await claimsOf(id)).toBe(0);
    expect(await statusOf(id)).toBe("expired");
  });

  it("a hold waits for an uncommitted import, then sees it", async () => {
    await paid();
    const calendar = await addCalendar();

    const importer = await db.connect();
    await importer.query("begin");
    await importer.query(
      `select public.upsert_external_event($1, 'race', '2032-06-03', '2032-06-08')`,
      [calendar],
    );

    let settled = false;
    const hold = createHold({
      roomId,
      checkIn: "2032-06-06",
      checkOut: "2032-06-07",
    }).finally(() => {
      settled = true;
    });
    const caught = hold.catch((e: Error) => e.message);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);

    await importer.query("commit");
    importer.release();
    expect(await caught).toBe("dates_unavailable");
  });

  it("reports a conflict as new only once (repeat alerts)", async () => {
    await paid();
    const calendar = await addCalendar();
    const run = async () =>
      (
        await db.query(
          `select public.upsert_external_event($1, 'x', '2032-06-03', '2032-06-08') as r`,
          [calendar],
        )
      ).rows[0].r;

    expect((await run()).is_new_conflict).toBe(true);
    const second = await run();
    expect(second.is_conflicted).toBe(true);
    expect(second.is_new_conflict).toBe(false);
  });

  it("rejects bad dates cleanly", async () => {
    await expect(
      upsert(await addCalendar(), "2032-06-08", "2032-06-03"),
    ).rejects.toThrow("invalid_dates");
  });
});

describe("audit log (findings 4 and 5)", () => {
  it("records the before and after of a settings change", async () => {
    await db.query(
      `update public.settings set value = '{"enabled": ["en"]}' where key = 'languages'`,
    );
    const { rows } = await db.query(
      `select entity_id, before, after from public.audit_log
       where entity = 'settings' and action = 'update' order by id desc limit 1`,
    );
    expect(rows[0].entity_id).toBe("languages");
    expect(rows[0].before.value).toEqual({ enabled: ["en", "el"] });
    expect(rows[0].after.value).toEqual({ enabled: ["en"] });
    await db.query(
      `update public.settings set value = '{"enabled": ["en", "el"]}' where key = 'languages'`,
    );
  });

  it("names the admin behind a server-side cancel", async () => {
    const owner = await createAdmin("owner");
    const { id } = await paid();
    await db.query(`select public.cancel_booking($1, 'x', $2)`, [id, owner.id]);
    const { rows } = await db.query(
      `select actor_id from public.audit_log
       where entity = 'bookings' and entity_id = $1 order by id desc limit 1`,
      [id],
    );
    expect(rows[0].actor_id).toBe(owner.id);
  });

  it("does not carry the actor into the next transaction", async () => {
    const owner = await createAdmin("owner");
    const { id } = await paid();
    await db.query(`select public.cancel_booking($1, 'x', $2)`, [id, owner.id]);
    await db.query(`update public.rooms set max_children = 1 where id = $1`, [
      roomId,
    ]);
    const { rows } = await db.query(
      `select actor_id from public.audit_log
       where entity = 'rooms' and entity_id = $1 order by id desc limit 1`,
      [roomId],
    );
    expect(rows[0].actor_id).toBeNull();
  });
});

describe("money validation (finding 6)", () => {
  const pay = (id: string, cents: number, intent: string | null) =>
    db.query(`select public.confirm_booking($1, 'full', $2, $3, $4) as r`, [
      id,
      cents,
      intent,
      randomUUID(),
    ]);

  it("does not confirm a wrong amount, but records the money", async () => {
    const id = await createHold({ roomId, ...JUNE });
    const { rows } = await pay(id, 1, randomUUID());
    expect(rows[0].r.outcome).toBe("amount_mismatch");
    expect(await statusOf(id)).toBe("pending_payment");
    await paymentOf(id);
  });

  it("refuses a payment belonging to another booking", async () => {
    const a = await createHold({ roomId, ...JUNE });
    const intent = randomUUID();
    await confirm(a, intent);
    const b = await createHold({
      roomId,
      checkIn: "2032-07-01",
      checkOut: "2032-07-05",
    });
    await expect(pay(b, 10000, intent)).rejects.toThrow(
      "payment_booking_mismatch",
    );
  });

  it("flags a second, different payment", async () => {
    const { id } = await paid();
    const { rows } = await pay(id, 10000, randomUUID());
    expect(rows[0].r.outcome).toBe("extra_payment");
  });

  it("requires a payment intent", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await expect(pay(id, 10000, null)).rejects.toThrow(
      "payment_intent_required",
    );
  });
});

describe("nothing due now (finding 7)", () => {
  it("confirms without a payment", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await db.query(
      `update public.bookings set due_now_cents = 0 where id = $1`,
      [id],
    );
    const { rows } = await db.query(
      `select public.confirm_without_payment($1) as r`,
      [id],
    );
    expect(rows[0].r.outcome).toBe("confirmed");
  });

  it("cannot skip a payment that is due", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await expect(
      db.query(`select public.confirm_without_payment($1)`, [id]),
    ).rejects.toThrow("payment_required");
  });
});

describe("privileges", () => {
  it("functions created later are not public (finding 8)", async () => {
    const client = await db.connect();
    await client.query("begin");
    await client.query(
      `create function public.future_probe() returns int language sql as 'select 1'`,
    );
    const { rows } = await client.query(
      `select has_function_privilege('anon', 'public.future_probe()', 'execute') as a,
              has_function_privilege('authenticated', 'public.future_probe()', 'execute') as b`,
    );
    await client.query("rollback");
    client.release();
    expect(rows[0]).toEqual({ a: false, b: false });
  });

  it("the server role can run booking functions through RLS", async () => {
    await asRole("service_role", null, async (c) => {
      await c.query(
        `select public.create_hold($1, '2032-06-01', '2032-06-05', 2, 0,
           '{"email":"s@example.test"}'::jsonb, $2::jsonb, 100, 100, $3::jsonb,
           'v1', $4, now())`,
        [roomId, PRICE, RULES, randomUUID()],
      );
    });
  });

  it("the owner can update and delete site photos (finding 10)", async () => {
    const owner = await createAdmin("owner");
    await admin(owner.id, "aal2", async (c) => {
      await c.query(
        `insert into storage.objects (bucket_id, name) values ('media', 'a.jpg')`,
      );
      const moved = await c.query(
        `update storage.objects set name = 'b.jpg' where bucket_id = 'media' and name = 'a.jpg'`,
      );
      expect(moved.rowCount).toBe(1);
      // Supabase blocks plain SQL deletes here; the switch lets this test reach
      // the same RLS policy the Storage API goes through.
      await c.query(
        `select set_config('storage.allow_delete_query', 'true', true)`,
      );
      const removed = await c.query(
        `delete from storage.objects where bucket_id = 'media' and name = 'b.jpg'`,
      );
      expect(removed.rowCount).toBe(1);
    });
  });

  it("the owner cannot edit the invoice counter", async () => {
    const owner = await createAdmin("owner");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`update public.invoice_series set last_number = 100`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("empty feeds (finding 9)", () => {
  it("an empty feed does not release sold dates", async () => {
    const calendar = await addCalendar();
    await db.query(
      `select public.upsert_external_event($1, 'a', '2032-06-01', '2032-06-05')`,
      [calendar],
    );
    await expect(
      db.query(`select public.remove_missing_external_events($1, '{}')`, [
        calendar,
      ]),
    ).rejects.toThrow("empty_feed_refused");
    await expect(createHold({ roomId, ...JUNE })).rejects.toThrow(
      "dates_unavailable",
    );

    await db.query(
      `select public.remove_missing_external_events($1, '{}', true)`,
      [calendar],
    );
    await createHold({ roomId, ...JUNE });
  });
});

describe("refunds (findings 11 and 12)", () => {
  const reserve = async (id: string, paymentId: string, cents: number) =>
    (
      await db.query(`select public.reserve_refund($1, $2, $3) as r`, [
        id,
        paymentId,
        cents,
      ])
    ).rows[0].r as string;

  const settle = (refundId: string, status: string) =>
    db.query(`select public.settle_refund($1, $2, $3)`, [
      refundId,
      status,
      randomUUID(),
    ]);

  it("refuses to refund a disputed payment", async () => {
    const { id, paymentId } = await paid();
    await db.query(
      `update public.payments set status = 'disputed' where id = $1`,
      [paymentId],
    );
    await expect(reserve(id, paymentId, 100)).rejects.toThrow(
      "payment_not_refundable",
    );
  });

  it("the cap counts refunds still in flight", async () => {
    const { id, paymentId } = await paid();
    await reserve(id, paymentId, 8000);
    await expect(reserve(id, paymentId, 3000)).rejects.toThrow(
      "refund_exceeds_payment",
    );
  });

  it("10 concurrent reservations cannot exceed the payment", async () => {
    const { id, paymentId } = await paid();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => reserve(id, paymentId, 4000)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });

  it("a failed refund frees the reservation", async () => {
    const { id, paymentId } = await paid();
    await settle(await reserve(id, paymentId, 10000), "failed");
    await reserve(id, paymentId, 10000);
  });

  it("marks refunded on settle, and back if Stripe later reports failure", async () => {
    const { id, paymentId } = await paid();
    await db.query(`select public.cancel_booking($1)`, [id]);
    const refund = await reserve(id, paymentId, 10000);
    expect(await statusOf(id)).toBe("cancelled");

    await settle(refund, "succeeded");
    expect(await statusOf(id)).toBe("refunded");

    await settle(refund, "failed");
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("records a dashboard refund even past the cap, since the money moved", async () => {
    const { id, paymentId } = await paid();
    await reserve(id, paymentId, 10000);
    await db.query(`select public.record_refund($1, $2, 500, $3)`, [
      id,
      paymentId,
      randomUUID(),
    ]);
  });

  it("a full refund before cancelling still ends as refunded", async () => {
    const { id, paymentId } = await paid();
    await db.query(`select public.record_refund($1, $2, 10000)`, [
      id,
      paymentId,
    ]);
    await db.query(`select public.cancel_booking($1)`, [id]);
    expect(await statusOf(id)).toBe("refunded");
  });

  it("a cancelled booking with no payment is not marked refunded", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await db.query(`select public.cancel_booking($1)`, [id]);
    expect(await statusOf(id)).toBe("cancelled");
  });

  it("hand-entered payments allow for earlier refunds", async () => {
    const { id, paymentId } = await paid();
    await db.query(`select public.record_refund($1, $2, 5000)`, [
      id,
      paymentId,
    ]);
    await db.query(`select public.record_payment($1, 'extra', 'cash', 5000)`, [
      id,
    ]);
  });
});

describe("concurrency", () => {
  it("confirm and expiry cleanup never deadlock (finding 13)", async () => {
    const bookings = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        createHold({
          roomId,
          checkIn: `2032-08-${String(i + 1).padStart(2, "0")}`,
          checkOut: `2032-08-${String(i + 2).padStart(2, "0")}`,
        }),
      ),
    );
    await Promise.all(bookings.map(expireHold));

    const results = await Promise.allSettled([
      ...bookings.map((id) => confirm(id)),
      ...Array.from({ length: 10 }, () =>
        db.query(`select public.release_expired_holds($1)`, [roomId]),
      ),
    ]);
    expect(results.filter((r) => r.status === "rejected")).toEqual([]);
  });

  it("the constraint itself holds without the room lock", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 30 }, () =>
        db.query(
          `select public.create_block($1, '2032-09-01', '2032-09-10', 'other')`,
          [roomId],
        ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("promo codes (finding 14)", () => {
  const addPromo = async (maxUses: number) => {
    const code = `T${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.promo_codes (code, kind, value, max_uses)
       values ($1, 'percent', 1000, $2)`,
      [code, maxUses],
    );
    return code;
  };

  const used = async (code: string) =>
    (
      await db.query(
        `select used_count from public.promo_codes where code = $1`,
        [code],
      )
    ).rows[0].used_count as number;

  it("one remaining use goes to exactly one of 10 guests", async () => {
    const promo = await addPromo(1);
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        createHold({
          roomId,
          checkIn: `2032-08-${String(i * 2 + 1).padStart(2, "0")}`,
          checkOut: `2032-08-${String(i * 2 + 2).padStart(2, "0")}`,
          promo,
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await used(promo)).toBe(1);
  });

  it("gives the use back when the hold expires or is cancelled", async () => {
    const promo = await addPromo(2);
    const a = await createHold({ roomId, ...JUNE, promo });
    const b = await createHold({
      roomId,
      checkIn: "2032-07-01",
      checkOut: "2032-07-05",
      promo,
    });
    expect(await used(promo)).toBe(2);
    await expireHold(a);
    await db.query(`select public.release_expired_holds($1)`, [roomId]);
    expect(await used(promo)).toBe(1);
    await db.query(`select public.cancel_booking($1)`, [b]);
    expect(await used(promo)).toBe(0);
  });

  it("a confirmed booking keeps its use", async () => {
    const promo = await addPromo(1);
    const id = await createHold({ roomId, ...JUNE, promo });
    await confirm(id);
    await db.query(`select public.cancel_booking($1)`, [id]);
    expect(await used(promo)).toBe(1);
  });
});

describe("remaining findings", () => {
  it("a line cannot be moved off an issued invoice", async () => {
    const series = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active)
       values ('receipt', $1, false) returning id`,
      [randomUUID()],
    );
    const draft = await db.query(
      `insert into public.invoices (doc_type) values ('receipt') returning id`,
    );
    const line = await db.query(
      `insert into public.invoice_lines (invoice_id, description, unit_cents, total_cents)
       values ($1, 'x', 1, 1) returning id`,
      [draft.rows[0].id],
    );
    await db.query(
      `update public.invoices
       set status = 'issued', series_id = $1, number = 1, issued_at = now()
       where id = $2`,
      [series.rows[0].id, draft.rows[0].id],
    );
    const other = await db.query(
      `insert into public.invoices (doc_type) values ('receipt') returning id`,
    );
    await expect(
      db.query(
        `update public.invoice_lines set invoice_id = $1 where id = $2`,
        [other.rows[0].id, line.rows[0].id],
      ),
    ).rejects.toThrow("issued_invoice_immutable");
  });

  it("marketing opt-in is logged and reaches the guest only after payment", async () => {
    const email = `${randomUUID()}@example.test`;
    const id = await createHold({ roomId, ...JUNE, email, marketing: true });
    const consent = await db.query(
      `select granted from public.consent_log where subject = $1`,
      [id],
    );
    expect(consent.rows).toEqual([{ granted: true }]);

    const guest = () =>
      db.query(`select marketing_consent from public.guests where email = $1`, [
        email,
      ]);
    expect((await guest()).rows[0].marketing_consent).toBe(false);
    await confirm(id);
    expect((await guest()).rows[0].marketing_consent).toBe(true);
  });

  it("a manual booking can carry a guest link token", async () => {
    const hash = randomUUID();
    await db.query(
      `select public.create_manual_booking(
         $1, '2032-06-01', '2032-06-05', 2, 0, '{"name":"G"}'::jsonb,
         $2::jsonb, 100, $3::jsonb, 'manual', null, $4, '2099-01-01')`,
      [roomId, PRICE, RULES, hash],
    );
    const { rows } = await db.query(
      `select 1 from public.bookings where access_token_hash = $1`,
      [hash],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("admin hardening (ADMIN security review)", () => {
  const addVerifiedFactor = (userId: string) =>
    db.query(
      `insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
       values ($1, $2, 'totp', 'verified', now(), now(), $3)`,
      [randomUUID(), userId, randomUUID()],
    );

  const canReadBookings = async (id: string, aal: "aal1" | "aal2") => {
    const { rows } = await admin(id, aal, (c) =>
      c.query(`select public.is_admin() as ok`),
    );
    return rows[0].ok as boolean;
  };

  it("staff who enabled MFA have no access at aal1 (finding 2)", async () => {
    const staff = await createAdmin("staff");
    expect(await canReadBookings(staff.id, "aal1")).toBe(true);

    await addVerifiedFactor(staff.id);
    expect(await canReadBookings(staff.id, "aal1")).toBe(false);
    expect(await canReadBookings(staff.id, "aal2")).toBe(true);
  });

  it("an unverified factor does not lock staff out", async () => {
    const staff = await createAdmin("staff");
    await db.query(
      `insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at, friendly_name)
       values ($1, $2, 'totp', 'unverified', now(), now(), $3)`,
      [randomUUID(), staff.id, randomUUID()],
    );
    expect(await canReadBookings(staff.id, "aal1")).toBe(true);
  });

  it("nobody reaches login attempts through the API", async () => {
    const owner = await createAdmin("owner");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select * from public.admin_attempts`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select public.save_rules('{}', '[]', false)`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("purges old attempts only", async () => {
    const scope = randomUUID();
    await db.query(
      `insert into public.admin_attempts (scope, key_hash, created_at)
       values ($1, 'old', now() - interval '8 days'), ($1, 'new', now())`,
      [scope],
    );
    await db.query(`select public.purge_admin_attempts()`);
    const { rows } = await db.query(
      `select key_hash from public.admin_attempts where scope = $1`,
      [scope],
    );
    expect(rows).toEqual([{ key_hash: "new" }]);
    await db.query(`delete from public.admin_attempts where scope = $1`, [
      scope,
    ]);
  });

  describe("save_rules", () => {
    const read = async () => {
      const payment = await db.query(
        `select value from public.settings where key = 'payment'`,
      );
      const policy = await db.query(
        `select tiers, is_non_refundable from public.cancellation_policies where is_default`,
      );
      return { payment: payment.rows[0].value, policy: policy.rows[0] };
    };

    it("rolls both tables back when one write fails (finding 7)", async () => {
      const before = await read();
      await expect(
        db.query(`select public.save_rules($1::jsonb, null, false)`, [
          JSON.stringify({ mode: "full", deposit: null, balanceDaysBefore: 1 }),
        ]),
      ).rejects.toThrow();
      expect(await read()).toEqual(before);
    });

    it("saves both, names the actor, and restores afterwards", async () => {
      const before = await read();
      const owner = await createAdmin("owner");
      await db.query(`select public.save_rules($1::jsonb, $2::jsonb, $3, $4)`, [
        JSON.stringify({ mode: "full", deposit: null, balanceDaysBefore: 3 }),
        JSON.stringify([{ daysBefore: 5, refundPercent: 100 }]),
        false,
        owner.id,
      ]);
      const after = await read();
      expect(after.payment.balanceDaysBefore).toBe(3);
      expect(after.policy.tiers).toEqual([
        { daysBefore: 5, refundPercent: 100 },
      ]);

      const { rows } = await db.query(
        `select actor_id from public.audit_log
         where entity = 'settings' and entity_id = 'payment' order by id desc limit 1`,
      );
      expect(rows[0].actor_id).toBe(owner.id);

      await db.query(`select public.save_rules($1::jsonb, $2::jsonb, $3)`, [
        JSON.stringify(before.payment),
        JSON.stringify(before.policy.tiers),
        before.policy.is_non_refundable,
      ]);
    });
  });

  it("audits property changes", async () => {
    await db.query(`update public.property set phone = phone`);
    const { rows } = await db.query(
      `select after from public.audit_log where entity = 'property' order by id desc limit 1`,
    );
    expect(rows[0].after).not.toBeNull();
  });
});

describe("details added to imported bookings (D19)", () => {
  const importEvent = async () => {
    const calendar = await addCalendar();
    const { rows } = await db.query(
      `select public.upsert_external_event($1, $2, '2032-10-01', '2032-10-05') as r`,
      [calendar, randomUUID()],
    );
    return { calendar, eventId: rows[0].r.event_id as string };
  };

  const save = (
    id: string,
    amount: number | null,
    actor: string | null = null,
  ) =>
    db.query(
      `select public.update_external_event_details($1, ' Maria ', 'm@example.test', '', 'Late', $2, $3)`,
      [id, amount, actor],
    );

  it("stores contacts and amount, and audits who changed them without the contacts", async () => {
    const owner = await createAdmin("owner");
    const { eventId } = await importEvent();
    await save(eventId, 42000, owner.id);

    const { rows } = await db.query(
      `select guest_name, guest_email, guest_phone, amount_cents
       from public.external_events where id = $1`,
      [eventId],
    );
    expect(rows[0]).toEqual({
      guest_name: "Maria",
      guest_email: "m@example.test",
      guest_phone: null,
      amount_cents: 42000,
    });

    const audit = await db.query(
      `select actor_id, after from public.audit_log
       where entity = 'external_events' and entity_id = $1`,
      [eventId],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].actor_id).toBe(owner.id);
    expect(JSON.stringify(audit.rows)).not.toContain("example.test");
  });

  it("a later sync keeps what Yorgos entered", async () => {
    const { calendar, eventId } = await importEvent();
    await save(eventId, 42000);
    const { rows: before } = await db.query(
      `select uid from public.external_events where id = $1`,
      [eventId],
    );
    await db.query(
      `select public.upsert_external_event($1, $2, '2032-10-02', '2032-10-06', 'Reserved')`,
      [calendar, before[0].uid],
    );
    const { rows } = await db.query(
      `select guest_name, amount_cents, start_date from public.external_events where id = $1`,
      [eventId],
    );
    expect(rows[0]).toEqual({
      guest_name: "Maria",
      amount_cents: 42000,
      start_date: "2032-10-02",
    });
  });

  it("refuses a negative amount, an unknown event, and direct access", async () => {
    const { eventId } = await importEvent();
    await expect(save(eventId, -1)).rejects.toThrow();
    await expect(save(randomUUID(), 1)).rejects.toThrow("event_not_found");

    const staff = await createAdmin("staff");
    await expect(
      admin(staff.id, "aal1", (c) =>
        c.query(`update public.external_events set amount_cents = 1`),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("no signed-in session reads the amount directly", async () => {
    const { eventId } = await importEvent();
    await save(eventId, 42000);
    const staff = await createAdmin("staff");
    await expect(
      admin(staff.id, "aal1", (c) =>
        c.query(`select amount_cents from public.external_events`),
      ),
    ).rejects.toThrow(/permission denied/);
    const contacts = await admin(staff.id, "aal1", (c) =>
      c.query(`select guest_name from public.external_events where id = $1`, [
        eventId,
      ]),
    );
    expect(contacts.rows[0].guest_name).toBe("Maria");
  });

  it("saving contacts can leave the amount alone", async () => {
    const { eventId } = await importEvent();
    await save(eventId, 42000);
    await db.query(
      `select public.update_external_event_details($1, 'New', null, null, null, 1, null, false)`,
      [eventId],
    );
    const { rows } = await db.query(
      `select guest_name, amount_cents from public.external_events where id = $1`,
      [eventId],
    );
    expect(rows[0]).toEqual({ guest_name: "New", amount_cents: 42000 });
  });
});

describe("ADMIN-OPS review fixes", () => {
  it("dates a refund when it completes", async () => {
    const { id, paymentId } = await paid();
    const reserved = await db.query(
      `select public.reserve_refund($1, $2, 100) as r`,
      [id, paymentId],
    );
    const refundId = reserved.rows[0].r as string;
    const settled = async () =>
      (
        await db.query(`select settled_at from public.refunds where id = $1`, [
          refundId,
        ])
      ).rows[0].settled_at;

    expect(await settled()).toBeNull();
    await db.query(`select public.settle_refund($1, 'succeeded')`, [refundId]);
    expect(await settled()).not.toBeNull();

    const direct = await db.query(
      `select public.record_refund($1, $2, 100) as r`,
      [id, paymentId],
    );
    const { rows } = await db.query(
      `select settled_at from public.refunds where id = $1`,
      [direct.rows[0].r],
    );
    expect(rows[0].settled_at).not.toBeNull();
  });

  it("counts a disputed payment toward the hand-entered cap", async () => {
    const { id, paymentId } = await paid();
    await db.query(
      `update public.payments set status = 'disputed' where id = $1`,
      [paymentId],
    );
    await expect(
      db.query(`select public.record_payment($1, 'extra', 'cash', 100)`, [id]),
    ).rejects.toThrow("overpayment");
  });
});

describe("booking notes and price history", () => {
  it("saves notes through the server only, and audits the actor without the text", async () => {
    const owner = await createAdmin("owner");
    const id = await createHold({ roomId, ...JUNE });
    await db.query(
      `select public.update_booking_notes($1, ' Late arrival ', $2)`,
      [id, owner.id],
    );
    const { rows } = await db.query(
      `select internal_notes from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0].internal_notes).toBe("Late arrival");

    const audit = await db.query(
      `select actor_id, after from public.audit_log
       where entity = 'bookings' and entity_id = $1 order by id desc limit 1`,
      [id],
    );
    expect(audit.rows[0].actor_id).toBe(owner.id);
    expect(JSON.stringify(audit.rows[0].after)).not.toContain("Late arrival");

    await expect(
      db.query(`select public.update_booking_notes($1, 'x')`, [randomUUID()]),
    ).rejects.toThrow("booking_not_found");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select public.update_booking_notes($1, 'x')`, [id]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("records which night's price changed", async () => {
    await db.query(
      `insert into public.rate_overrides (room_id, night, nightly_cents)
       values ($1, '2032-11-01', 15000)`,
      [roomId],
    );
    const { rows } = await db.query(
      `select action from public.audit_log
       where entity = 'rate_overrides' and entity_id = $1`,
      [`${roomId}:2032-11-01`],
    );
    expect(rows).toEqual([{ action: "insert" }]);
  });
});

describe("channel link privacy", () => {
  it("no signed-in session reads an import link directly", async () => {
    const owner = await createAdmin("owner");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select import_url from public.external_calendars`),
      ),
    ).rejects.toThrow(/permission denied/);
    const { rows } = await admin(owner.id, "aal2", (c) =>
      c.query(
        `select channel, is_enabled from public.external_calendars limit 1`,
      ),
    );
    expect(Array.isArray(rows)).toBe(true);
  });
});

describe("scheduled jobs (T4.32)", () => {
  it("every job is scheduled", async () => {
    const { rows } = await db.query(`select jobname from cron.job order by 1`);
    expect(rows.map((r) => r.jobname)).toEqual(
      expect.arrayContaining([
        "channel-sync",
        "cms-cleanup",
        "complete-finished-bookings",
        "email-queue",
        "email-scheduled",
        "payments",
        "purge-admin-attempts",
        "release-expired-holds",
      ]),
    );
  });

  it("a site job does nothing until the secrets exist", async () => {
    const { rows } = await db.query(
      `select count(*)::int as n from vault.decrypted_secrets where name in ('site_url', 'cron_secret')`,
    );
    if (rows[0].n < 2) {
      const call = await db.query(
        `select public.call_cron_route('/api/cron/email') as id`,
      );
      expect(call.rows[0].id).toBeNull();
    }
  });

  it("a database job logs its run, and failures are recorded", async () => {
    await db.query(`select public.run_database_job('purge_admin_attempts')`);
    const ok = await db.query(
      `select status from public.job_runs where job = 'purge_admin_attempts' order by id desc limit 1`,
    );
    expect(ok.rows[0].status).toBe("success");

    await db.query(`select public.run_database_job('nope')`);
    const bad = await db.query(
      `select status, detail from public.job_runs where job = 'nope' order by id desc limit 1`,
    );
    expect(bad.rows[0]).toEqual({ status: "failed", detail: "unknown_job" });
    await db.query(`delete from public.job_runs where job = 'nope'`);
  });

  it("the hold job really expires a hold", async () => {
    const id = await createHold({ roomId, ...JUNE });
    await expireHold(id);
    await db.query(`select public.run_database_job('release_expired_holds')`);
    expect(await statusOf(id)).toBe("expired");
  });

  it("signed-in sessions cannot run jobs", async () => {
    const owner = await createAdmin("owner");
    await expect(
      admin(owner.id, "aal2", (c) =>
        c.query(`select public.call_cron_route('/api/cron/email')`),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("disputes", () => {
  const dispute = async () => {
    const id = await createHold({ roomId, ...JUNE });
    const intent = randomUUID();
    await confirm(id, intent);
    return { id, intent };
  };
  const statusOfPayment = async (intent: string) =>
    (
      await db.query(
        `select status from public.payments where stripe_payment_intent_id = $1`,
        [intent],
      )
    ).rows[0].status as string;
  const open = async (intent: string) =>
    (await db.query(`select public.open_dispute($1) as r`, [intent])).rows[0].r;
  const close = async (intent: string, won: boolean, id = "dp_1") =>
    (
      await db.query(`select public.close_dispute($1, $2, $3, 10000) as r`, [
        intent,
        `${id}-${intent}`,
        won,
      ])
    ).rows[0].r;

  it("opens once, and a won dispute restores the payment", async () => {
    const { intent } = await dispute();
    expect((await open(intent)).outcome).toBe("opened");
    expect((await open(intent)).outcome).toBe("already_open");
    expect(await statusOfPayment(intent)).toBe("disputed");
    expect((await close(intent, true)).outcome).toBe("won");
    expect(await statusOfPayment(intent)).toBe("succeeded");
  });

  it("a lost dispute counts as money gone, once only", async () => {
    const { id, intent } = await dispute();
    await open(intent);
    await close(intent, false);
    await close(intent, false);
    const { rows } = await db.query(
      `select count(*)::int as n, sum(amount_cents)::int as cents
       from public.refunds where booking_id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ n: 1, cents: 10000 });
  });

  it("ignores an unknown payment", async () => {
    expect((await open(randomUUID())).outcome).toBe("unknown");
  });
});
