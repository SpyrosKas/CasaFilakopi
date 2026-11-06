import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  confirm,
  createHold,
  createRoom,
  db,
  expireHold,
  PRICE,
  RULES,
} from "./helpers";

let roomId: string;

beforeEach(async () => {
  roomId = await createRoom();
});

afterAll(async () => {
  await db.end();
});

const claimCount = async (room: string) =>
  (
    await db.query(
      `select count(*)::int as n from public.inventory_claims where room_id = $1`,
      [room],
    )
  ).rows[0].n as number;

const overlappingPairs = async (room: string) =>
  (
    await db.query(
      `select count(*)::int as n from public.inventory_claims a
       join public.inventory_claims b
         on a.room_id = b.room_id and a.id < b.id and a.stay && b.stay
       where a.room_id = $1`,
      [room],
    )
  ).rows[0].n as number;

describe("overbooking protection (QA-02)", () => {
  it("lets exactly one of 50 simultaneous requests hold the same dates", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, () =>
        createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-08" }),
      ),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(49);
    expect(lost.every((r) => r.reason.message === "dates_unavailable")).toBe(
      true,
    );
    expect(await claimCount(roomId)).toBe(1);
  });

  it("never overlaps when 40 sliding date ranges race", async () => {
    await Promise.allSettled(
      Array.from({ length: 40 }, (_, i) => {
        const start = new Date(Date.UTC(2030, 6, 1 + i));
        const end = new Date(Date.UTC(2030, 6, 1 + i + 3));
        return createHold({
          roomId,
          checkIn: start.toISOString().slice(0, 10),
          checkOut: end.toISOString().slice(0, 10),
        });
      }),
    );
    expect(await claimCount(roomId)).toBeGreaterThan(0);
    expect(await overlappingPairs(roomId)).toBe(0);
  });

  it("allows check-in on another guest's check-out day", async () => {
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
    await createHold({ roomId, checkIn: "2030-06-05", checkOut: "2030-06-09" });
    expect(await claimCount(roomId)).toBe(2);
  });

  it("does not let different rooms interfere", async () => {
    const other = await createRoom();
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
    await createHold({
      roomId: other,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    expect(await claimCount(other)).toBe(1);
  });

  it("blocks a hold on host-blocked dates and vice versa", async () => {
    await db.query(
      `select public.create_block($1, '2030-06-01', '2030-06-10', 'maintenance')`,
      [roomId],
    );
    await expect(
      createHold({ roomId, checkIn: "2030-06-09", checkOut: "2030-06-12" }),
    ).rejects.toThrow("dates_unavailable");

    await createHold({ roomId, checkIn: "2030-07-01", checkOut: "2030-07-05" });
    await expect(
      db.query(
        `select public.create_block($1, '2030-07-04', '2030-07-06', 'other')`,
        [roomId],
      ),
    ).rejects.toThrow("dates_unavailable");
  });

  it("removing a block frees the dates", async () => {
    const { rows } = await db.query(
      `select public.create_block($1, '2030-06-01', '2030-06-10', 'other') as id`,
      [roomId],
    );
    await db.query(`select public.remove_block($1)`, [rows[0].id]);
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
  });

  it("rejects bad dates, past stays and short holds", async () => {
    await expect(
      createHold({ roomId, checkIn: "2030-06-05", checkOut: "2030-06-05" }),
    ).rejects.toThrow("invalid_dates");
    await expect(
      createHold({ roomId, checkIn: "2020-06-01", checkOut: "2020-06-05" }),
    ).rejects.toThrow("invalid_dates");
    await expect(
      createHold({
        roomId,
        checkIn: "2030-06-01",
        checkOut: "2030-06-05",
        minutes: 15,
      }),
    ).rejects.toThrow("hold_too_short");
  });

  it("refuses an inactive room", async () => {
    await db.query(`update public.rooms set is_active = false where id = $1`, [
      roomId,
    ]);
    await expect(
      createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" }),
    ).rejects.toThrow("room_inactive");
  });
});

describe("hold expiry", () => {
  it("a new request takes over an expired hold in the same transaction", async () => {
    const first = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await expireHold(first);
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });

    const { rows } = await db.query(
      `select status from public.bookings where id = $1`,
      [first],
    );
    expect(rows[0].status).toBe("expired");
    expect(await claimCount(roomId)).toBe(1);
  });

  it("the cleanup job leaves live holds alone", async () => {
    const live = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    const dead = await createHold({
      roomId,
      checkIn: "2030-06-10",
      checkOut: "2030-06-15",
    });
    await expireHold(dead);
    await db.query(`select public.release_expired_holds($1)`, [roomId]);

    const { rows } = await db.query(
      `select id, status from public.bookings where id = any($1::uuid[])`,
      [[live, dead]],
    );
    const status = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(status[live]).toBe("pending_payment");
    expect(status[dead]).toBe("expired");
  });
});

describe("payment confirmation (BKG-12, PAY-04)", () => {
  const paymentCount = async (id: string) =>
    (
      await db.query(
        `select count(*)::int as n from public.payments where booking_id = $1`,
        [id],
      )
    ).rows[0].n as number;

  it("confirms, assigns a reference and turns the hold into a booking", async () => {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    const result = await confirm(id);
    expect(result.outcome).toBe("confirmed");
    expect(result.reference).toMatch(/^CF-\d{4}-\d{5}$/);

    const { rows } = await db.query(
      `select kind from public.inventory_claims where booking_id = $1`,
      [id],
    );
    expect(rows[0].kind).toBe("booking");
    const holds = await db.query(
      `select 1 from public.holds where booking_id = $1`,
      [id],
    );
    expect(holds.rowCount).toBe(0);
  });

  it("handles the same webhook 10 times at once as one payment", async () => {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    const intent = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => confirm(id, intent)),
    );
    expect(results.filter((r) => r.outcome === "confirmed")).toHaveLength(1);
    expect(await paymentCount(id)).toBe(1);
  });

  it("confirms a late payment when the dates are still free", async () => {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await expireHold(id);
    await db.query(`select public.release_expired_holds()`);
    expect((await confirm(id)).outcome).toBe("confirmed");
  });

  it("reports dates_lost and keeps the payment when someone else took the dates", async () => {
    const late = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await expireHold(late);
    const winner = await createHold({
      roomId,
      checkIn: "2030-06-03",
      checkOut: "2030-06-08",
    });
    await confirm(winner);

    expect((await confirm(late)).outcome).toBe("dates_lost");
    expect(await paymentCount(late)).toBe(1);
    expect(await claimCount(roomId)).toBe(1);
  });

  it("reports dates_lost when the booking was cancelled mid-payment", async () => {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await db.query(`select public.cancel_booking($1)`, [id]);
    expect((await confirm(id)).outcome).toBe("dates_lost");
  });
});

describe("guest data", () => {
  it("an unauthenticated booking cannot change an existing guest", async () => {
    await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
      email: "same@example.test",
      name: "Real Name",
    });
    await createHold({
      roomId,
      checkIn: "2030-07-01",
      checkOut: "2030-07-05",
      email: "SAME@example.test",
      name: "Impostor",
    });
    const { rows } = await db.query(
      `select full_name from public.guests where lower(email) = 'same@example.test'`,
    );
    expect(rows).toEqual([{ full_name: "Real Name" }]);
    await db.query(
      `delete from public.bookings where guest_email ilike 'same@example.test'`,
    );
    await db.query(
      `delete from public.guests where lower(email) = 'same@example.test'`,
    );
  });
});

describe("cancel, modify and refund", () => {
  async function paidBooking() {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await confirm(id);
    const { rows } = await db.query(
      `select id from public.payments where booking_id = $1`,
      [id],
    );
    return { id, paymentId: rows[0].id as string };
  }

  const refund = (
    booking: string,
    payment: string,
    cents: number,
    ref?: string,
  ) =>
    db.query(`select public.record_refund($1, $2, $3, $4)`, [
      booking,
      payment,
      cents,
      ref ?? null,
    ]);

  const statusOf = async (id: string) =>
    (await db.query(`select status from public.bookings where id = $1`, [id]))
      .rows[0].status as string;

  it("cancelling frees the dates and is safe to repeat", async () => {
    const { id } = await paidBooking();
    await db.query(`select public.cancel_booking($1, 'guest request')`, [id]);
    const again = await db.query(`select public.cancel_booking($1) as r`, [id]);
    expect(again.rows[0].r.outcome).toBe("already_cancelled");
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
  });

  it("marks a cancelled booking refunded only once fully refunded", async () => {
    const { id, paymentId } = await paidBooking();
    await db.query(`select public.cancel_booking($1)`, [id]);
    await refund(id, paymentId, 4000);
    expect(await statusOf(id)).toBe("cancelled");
    await refund(id, paymentId, 6000);
    expect(await statusOf(id)).toBe("refunded");
  });

  it("cannot refund more than was paid, even concurrently", async () => {
    const { id, paymentId } = await paidBooking();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => refund(id, paymentId, 4000)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    await expect(refund(id, paymentId, 4000)).rejects.toThrow(
      "refund_exceeds_payment",
    );
  });

  it("the same Stripe refund is recorded once", async () => {
    const { id, paymentId } = await paidBooking();
    const stripeRefund = randomUUID();
    await refund(id, paymentId, 1000, stripeRefund);
    await refund(id, paymentId, 1000, stripeRefund);
    const { rows } = await db.query(
      `select count(*)::int as n from public.refunds where booking_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("modifying into occupied dates fails and changes nothing", async () => {
    const { id } = await paidBooking();
    await createHold({ roomId, checkIn: "2030-07-01", checkOut: "2030-07-05" });
    await expect(
      db.query(
        `select public.modify_booking($1, $2, '2030-07-03', '2030-07-06', $3::jsonb, 12000)`,
        [id, roomId, PRICE],
      ),
    ).rejects.toThrow("dates_unavailable");
    const { rows } = await db.query(
      `select check_in, total_cents from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ check_in: "2030-06-01", total_cents: 10000 });
  });

  it("modifying into free dates moves the claim", async () => {
    const { id } = await paidBooking();
    await db.query(
      `select public.modify_booking($1, $2, '2030-08-01', '2030-08-04', $3::jsonb, 8000)`,
      [id, roomId, PRICE],
    );
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
  });

  it("caps hand-entered payments at the booking total", async () => {
    const { id } = await paidBooking();
    await expect(
      db.query(`select public.record_payment($1, 'balance', 'cash', 100)`, [
        id,
      ]),
    ).rejects.toThrow("overpayment");
  });

  it("rejects an illegal status change", async () => {
    const { id } = await paidBooking();
    await expect(
      db.query(`select public.transition_booking($1, 'completed')`, [id]),
    ).rejects.toThrow("invalid_transition");
    await db.query(`select public.transition_booking($1, 'checked_in')`, [id]);
    await db.query(`select public.transition_booking($1, 'completed')`, [id]);
  });
});

describe("manual bookings", () => {
  it("creates a confirmed booking that blocks the dates", async () => {
    await db.query(
      `select public.create_manual_booking(
         $1, '2030-06-01', '2030-06-05', 2, 0, '{"name":"Phone Guest"}'::jsonb,
         $2::jsonb, 10000, $3::jsonb)`,
      [roomId, PRICE, RULES],
    );
    await expect(
      createHold({ roomId, checkIn: "2030-06-02", checkOut: "2030-06-03" }),
    ).rejects.toThrow("dates_unavailable");
  });
});

describe("channel events (CHN-07, CHN-13)", () => {
  let calendarId: string;

  beforeEach(async () => {
    const { rows } = await db.query(
      `insert into public.external_calendars (room_id, channel) values ($1, 'airbnb') returning id`,
      [roomId],
    );
    calendarId = rows[0].id;
  });

  const upsert = async (uid: string, start: string, end: string) =>
    (
      await db.query(
        `select public.upsert_external_event($1, $2, $3, $4) as r`,
        [calendarId, uid, start, end],
      )
    ).rows[0].r as { is_conflicted: boolean };

  it("blocks direct booking on imported dates", async () => {
    expect((await upsert("a", "2030-06-01", "2030-06-05")).is_conflicted).toBe(
      false,
    );
    await expect(
      createHold({ roomId, checkIn: "2030-06-02", checkOut: "2030-06-03" }),
    ).rejects.toThrow("dates_unavailable");
  });

  it("stores and flags a collision, then still refuses direct bookings", async () => {
    const id = await createHold({
      roomId,
      checkIn: "2030-06-01",
      checkOut: "2030-06-05",
    });
    await confirm(id);
    expect((await upsert("a", "2030-06-03", "2030-06-08")).is_conflicted).toBe(
      true,
    );
    await db.query(`select public.cancel_booking($1)`, [id]);
    await expect(
      createHold({ roomId, checkIn: "2030-06-06", checkOut: "2030-06-07" }),
    ).rejects.toThrow("dates_unavailable");
  });

  it("moves an event whose dates changed, without duplicating it", async () => {
    await upsert("a", "2030-06-01", "2030-06-05");
    await upsert("a", "2030-06-10", "2030-06-12");
    expect(await claimCount(roomId)).toBe(1);
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
  });

  it("releases events that vanish from the feed", async () => {
    await upsert("a", "2030-06-01", "2030-06-05");
    await upsert("b", "2030-07-01", "2030-07-05");
    await db.query(`select public.remove_missing_external_events($1, $2)`, [
      calendarId,
      ["b"],
    ]);
    await createHold({ roomId, checkIn: "2030-06-01", checkOut: "2030-06-05" });
    await expect(
      createHold({ roomId, checkIn: "2030-07-01", checkOut: "2030-07-05" }),
    ).rejects.toThrow("dates_unavailable");
  });
});

describe("references and invoices", () => {
  it("gives 30 concurrent references no duplicates", async () => {
    const results = await Promise.all(
      Array.from({ length: 30 }, () =>
        db.query(`select public.next_booking_reference() as r`),
      ),
    );
    const refs = results.map((r) => r.rows[0].r);
    expect(new Set(refs).size).toBe(30);
  });

  it("numbers invoices without gaps, even after a rollback", async () => {
    const { rows } = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active)
       values ('receipt', $1, false) returning id`,
      [`T${Date.now()}`],
    );
    const seriesId = rows[0].id;
    await Promise.all(
      Array.from({ length: 20 }, () =>
        db.query(`select public.next_invoice_number($1)`, [seriesId]),
      ),
    );
    const client = await db.connect();
    await client.query("begin");
    await client.query(`select public.next_invoice_number($1)`, [seriesId]);
    await client.query("rollback");
    client.release();

    const next = await db.query(`select public.next_invoice_number($1) as n`, [
      seriesId,
    ]);
    expect(next.rows[0].n).toBe(21);
  });

  it("makes issued invoices immutable (INV-07)", async () => {
    const series = await db.query(
      `insert into public.invoice_series (doc_type, prefix, is_active)
       values ('receipt', $1, false) returning id`,
      [`I${Date.now()}`],
    );
    const { rows } = await db.query(
      `insert into public.invoices (series_id, number, doc_type, status, issued_at, total_cents)
       values ($1, 1, 'receipt', 'issued', now(), 5000) returning id`,
      [series.rows[0].id],
    );
    const id = rows[0].id;
    await expect(
      db.query(`update public.invoices set total_cents = 1 where id = $1`, [
        id,
      ]),
    ).rejects.toThrow("issued_invoice_immutable");
    await expect(
      db.query(`delete from public.invoices where id = $1`, [id]),
    ).rejects.toThrow("issued_invoice_immutable");
    await expect(
      db.query(
        `insert into public.invoice_lines (invoice_id, description, unit_cents, total_cents)
         values ($1, 'x', 1, 1)`,
        [id],
      ),
    ).rejects.toThrow("issued_invoice_immutable");
    await db.query(
      `update public.invoices set pdf_path = 'a.pdf' where id = $1`,
      [id],
    );
  });
});
