import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "../../lib/db/types";
import {
  parseBookingSettings,
  parsePaymentRules,
} from "../../lib/domain/settings";
import { QuoteError } from "../../lib/domain/breakdown";
import { addDays, athensDate } from "../../lib/domain/dates";
import {
  createAvailabilityService,
  createPricingService,
  loadRulesSnapshot,
  prepareCheckout,
  type CheckoutInput,
} from "../../lib/domain/services";
import { db } from "./helpers";

// Reads the seeded settings and writes only to rooms made for this file, which
// are removed afterwards. The shared seed room is never touched.
//
// Two clocks are in play. Most tests fix NOW and use the 2027 rows below. Real
// holds go through create_hold, which reads the database clock, so those tests
// use today's date and a room with no dated rows.

const SEED_ROOM = "00000000-0000-4000-8000-000000000001";
const URL = "http://127.0.0.1:54321";
const NOW = new Date("2027-06-01T06:00:00Z");

function localKeys() {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const { SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } =
    process.env;
  if (SUPABASE_SECRET_KEY && NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return {
      secret: SUPABASE_SECRET_KEY,
      publishable: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    };
  }
  // CI has no .env.local, only a running local stack.
  const status = execSync("supabase status -o env", { encoding: "utf8" });
  const read = (name: string) => {
    const value = new RegExp(`^${name}="(.+)"$`, "m").exec(status)?.[1];
    if (!value) throw new Error(`No ${name} from supabase status`);
    return value;
  };
  return { secret: read("SECRET_KEY"), publishable: read("PUBLISHABLE_KEY") };
}

const keys = localKeys();

const admin = createClient<Database>(URL, keys.secret, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const availability = createAvailabilityService(admin, () => NOW);
const pricing = createPricingService(admin);

const inDays = (days: number) => addDays(athensDate(new Date()), days);

let roomId: string;
let plainRoomId: string;
let promoCode: string;
const bookingIds: string[] = [];
const extraRooms: string[] = [];

const insertRoom = (id: string) =>
  db.query(
    `insert into public.rooms (id, slug, name, max_adults, max_children, base_occupancy,
       base_price_cents, extra_guest_fee_cents, cleaning_fee_cents)
     values ($1, $2, '{"en":"Engine test"}', 4, 2, 2, 10000, 1000, 3000)`,
    [id, `engine-${id}`],
  );

const guest = (): CheckoutInput["guest"] => ({
  name: "Engine Guest",
  email: `${randomUUID()}@example.test`,
  locale: "en",
});

const checkout = (
  stayRequest: CheckoutInput["stay"],
  code?: string,
): CheckoutInput => ({
  stay: stayRequest,
  promoCode: code,
  guest: guest(),
  termsVersion: "engine-test",
  tokenHash: randomUUID(),
  tokenExpiresAt: "2099-01-01T00:00:00Z",
});

async function placeHold(input: CheckoutInput, now: Date) {
  const prepared = await prepareCheckout(admin, input, now);
  if (!prepared.ok) throw new Error(`Refused: ${prepared.reason}`);
  const { data, error } = await admin.rpc("create_hold", prepared.holdArgs);
  if (error) throw new Error(error.message);
  const { booking_id: bookingId } = data as { booking_id: string };
  bookingIds.push(bookingId);
  return { prepared, bookingId };
}

const usesOf = async (code: string) =>
  (
    await db.query(
      `select used_count from public.promo_codes where code = $1`,
      [code],
    )
  ).rows[0].used_count as number;

beforeAll(async () => {
  roomId = randomUUID();
  plainRoomId = randomUUID();
  promoCode = `ENGINE-${randomUUID()}`;
  await insertRoom(roomId);
  await insertRoom(plainRoomId);
  await db.query(
    `insert into public.seasons (room_id, name, start_date, end_date, nightly_cents, weekend_cents)
     values ($1, 'Engine', '2027-07-01', '2027-07-31', 20000, 25000)`,
    [roomId],
  );
  await db.query(
    `insert into public.rate_overrides (room_id, night, nightly_cents)
     values ($1, '2027-07-05', 30000)`,
    [roomId],
  );
  await db.query(
    `insert into public.restrictions (room_id, start_date, end_date, min_stay,
       closed_to_departure, allowed_check_in_days)
     values ($1, '2027-08-01', '2027-08-31', 3, false, null),
            ($1, '2027-09-10', '2027-09-10', null, true, null),
            ($1, '2027-09-20', '2027-09-30', null, false, '{6}')`,
    [roomId],
  );
  await db.query(
    `insert into public.promo_codes (code, kind, value, room_ids)
     values ($1, 'percent', 1000, $2)`,
    [promoCode, [roomId, plainRoomId]],
  );
});

afterAll(async () => {
  await db.query(`delete from public.promo_codes where code = $1`, [promoCode]);
  // Claims and holds cascade. The hold also made a guest, which must go too.
  const { rows } = await db.query(
    `delete from public.bookings where id = any($1) returning guest_id`,
    [bookingIds],
  );
  await db.query(`delete from public.guests where id = any($1)`, [
    rows.map((row) => row.guest_id),
  ]);
  const rooms = [roomId, plainRoomId, ...extraRooms];
  await db.query(`delete from public.rooms where id = any($1)`, [rooms]);
  // The audit triggers log every row above, so those entries go last.
  await db.query(
    `delete from public.audit_log
     where entity_id = any($1)
       or before ->> 'room_id' = any($2)
       or after ->> 'room_id' = any($2)`,
    [[...rooms, ...bookingIds], rooms],
  );
  await db.end();
});

const stay = (checkIn: string, checkOut: string, overrides = {}) => ({
  roomId,
  checkIn,
  checkOut,
  adults: 2,
  children: 0,
  ...overrides,
});

/** One live two-night hold, shared by whichever test asks for it first. */
let held: Promise<{ room: string; checkIn: string; checkOut: string }>;
function heldStay() {
  held ??= (async () => {
    const room = randomUUID();
    await insertRoom(room);
    extraRooms.push(room);
    const checkIn = inDays(300);
    const checkOut = addDays(checkIn, 2);
    await placeHold(
      checkout({ ...stay(checkIn, checkOut), roomId: room }),
      new Date(),
    );
    return { room, checkIn, checkOut };
  })();
  return held;
}

describe("settings", () => {
  it("parses the seeded rows", async () => {
    const { data } = await admin
      .from("settings")
      .select("key, value")
      .in("key", ["booking", "payment"]);
    const value = (key: string) => data?.find((r) => r.key === key)?.value;
    expect(parseBookingSettings(value("booking")).weekendDays).toEqual([5, 6]);
    expect(parsePaymentRules(value("payment"))).toEqual({
      mode: "deposit",
      deposit: { kind: "percent", percent: 30 },
      balanceDaysBefore: 14,
    });
  });

  it("builds a snapshot from the seeded policy", async () => {
    const snapshot = await loadRulesSnapshot(admin, NOW);
    expect(snapshot.capturedAt).toBe(NOW.toISOString());
    expect(snapshot.cancellation).toEqual({
      isNonRefundable: false,
      tiers: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    });
  });
});

describe("checkStay", () => {
  it("passes a free stay", async () => {
    expect(
      await availability.checkStay(stay("2027-10-04", "2027-10-06")),
    ).toEqual({
      ok: true,
    });
  });

  it("applies restrictions from the table", async () => {
    expect(
      await availability.checkStay(stay("2027-08-02", "2027-08-04")),
    ).toEqual({
      ok: false,
      reason: "below_min_stay",
    });
    expect(
      await availability.checkStay(stay("2027-09-08", "2027-09-10")),
    ).toEqual({
      ok: false,
      reason: "closed_to_departure",
    });
    // 20 September 2027 is a Monday, and only Saturday is allowed.
    expect(
      await availability.checkStay(stay("2027-09-20", "2027-09-22")),
    ).toEqual({
      ok: false,
      reason: "check_in_day_not_allowed",
    });
  });

  it("reports a missing room as inactive", async () => {
    expect(
      await availability.checkStay({
        ...stay("2027-10-04", "2027-10-06"),
        roomId: randomUUID(),
      }),
    ).toEqual({ ok: false, reason: "room_inactive" });
  });

  it("refuses bad dates without touching the database", async () => {
    expect(
      await availability.checkStay(stay("nonsense", "2027-10-06")),
    ).toEqual({
      ok: false,
      reason: "invalid_dates",
    });
  });

  it("sees a live hold, and allows turnover around it", async () => {
    const { room, checkIn, checkOut } = await heldStay();
    const realClock = createAvailabilityService(admin);
    const inHold = addDays(checkIn, 1);

    expect(
      await realClock.checkStay({
        ...stay(inHold, addDays(inHold, 2)),
        roomId: room,
      }),
    ).toEqual({ ok: false, reason: "dates_unavailable" });
    expect(
      await realClock.checkStay({
        ...stay(checkOut, addDays(checkOut, 2)),
        roomId: room,
      }),
    ).toEqual({ ok: true });
    expect(
      await realClock.checkStay({
        ...stay(addDays(checkIn, -2), checkIn),
        roomId: room,
      }),
    ).toEqual({ ok: true });
  });
});

describe("getCalendar", () => {
  it("returns one row per night from the RPC", async () => {
    const { room, checkIn, checkOut } = await heldStay();
    const calendar = await availability.getCalendar(
      room,
      addDays(checkIn, -1),
      addDays(checkOut, 1),
    );
    expect(calendar).toEqual([
      { night: addDays(checkIn, -1), isAvailable: true },
      { night: checkIn, isAvailable: false },
      { night: addDays(checkIn, 1), isAvailable: false },
      { night: checkOut, isAvailable: true },
    ]);
  });

  it("passes on the RPC's refusal", async () => {
    await expect(
      availability.getCalendar(roomId, "2027-11-09", "2027-11-09"),
    ).rejects.toThrow("invalid_dates");
  });
});

describe("quote", () => {
  it("combines season, weekend, override, extra guest and cleaning", async () => {
    // Thu 1 July to Tue 6 July: Thu, Fri, Sat, Sun, then the Mon override.
    const breakdown = await pricing.quote(
      { stay: stay("2027-07-01", "2027-07-06", { adults: 3 }) },
      NOW,
    );
    expect(breakdown.nights.map((n) => n.cents)).toEqual([
      20000, 25000, 25000, 20000, 30000,
    ]);
    expect(breakdown.lines.map((line) => [line.kind, line.totalCents])).toEqual(
      [
        ["accommodation", 40000],
        ["accommodation", 50000],
        ["accommodation", 30000],
        ["extra_guest", 5000],
        ["cleaning", 3000],
        ["fee", 1000],
      ],
    );
    expect(breakdown.totalCents).toBe(129000);
    // Seed: 30% deposit, the balance 14 days before check-in.
    expect(breakdown.dueNowCents).toBe(38700);
    expect(breakdown.balanceCents).toBe(90300);
    expect(breakdown.balanceDueOn).toBe("2027-06-17");
  });

  it("applies the seeded climate resilience fee", async () => {
    const breakdown = await pricing.quote(
      { stay: stay("2027-10-04", "2027-10-06") },
      NOW,
    );
    expect(breakdown.lines.find((l) => l.kind === "fee")).toMatchObject({
      quantity: 2,
      unitCents: 200,
      label: { en: "Climate resilience fee" },
    });
    expect(breakdown.totalCents).toBe(20000 + 3000 + 400);
  });

  it("finds a promo whatever its case and stores the real code", async () => {
    const breakdown = await pricing.quote(
      {
        stay: stay("2027-10-04", "2027-10-06"),
        promoCode: ` ${promoCode.toLowerCase()} `,
      },
      NOW,
    );
    expect(breakdown.promoCode).toBe(promoCode);
    expect(breakdown.lines.find((l) => l.kind === "discount")?.totalCents).toBe(
      -2300,
    );
    expect(breakdown.totalCents).toBe(23000 - 2300 + 400);
  });

  it("does not let a wildcard match a code", async () => {
    const breakdown = await pricing.quote(
      { stay: stay("2027-10-04", "2027-10-06"), promoCode: "%" },
      NOW,
    );
    expect(breakdown.promoCode).toBeNull();
    expect(breakdown.promoRejected).toBe(true);
    expect(breakdown.totalCents).toBe(23400);
  });

  it("rejects a promo for a room outside its list", async () => {
    const breakdown = await pricing.quote(
      {
        stay: { ...stay("2027-10-04", "2027-10-06"), roomId: SEED_ROOM },
        promoCode,
      },
      NOW,
    );
    expect(breakdown.promoRejected).toBe(true);
    expect(breakdown.promoCode).toBeNull();
  });

  it("refuses a missing room and bad dates", async () => {
    await expect(
      pricing.quote(
        {
          stay: {
            ...stay("2027-10-04", "2027-10-06"),
            roomId: randomUUID(),
          },
        },
        NOW,
      ),
    ).rejects.toThrow(new QuoteError("room_inactive"));
    await expect(
      pricing.quote({ stay: stay("2027-10-06", "2027-10-04") }, NOW),
    ).rejects.toThrow(new QuoteError("invalid_dates"));
  });

  it("refuses a bad guest count with a typed error", async () => {
    await expect(
      pricing.quote(
        { stay: stay("2027-10-04", "2027-10-06", { adults: 0 }) },
        NOW,
      ),
    ).rejects.toThrow(new QuoteError("over_capacity"));
  });
});

describe("prepareCheckout", () => {
  const rejected = (reason: string) => ({ ok: false, reason });

  it("returns the stay's rejection and places nothing", async () => {
    expect(
      await prepareCheckout(
        admin,
        checkout(stay("2027-08-02", "2027-08-04")),
        NOW,
      ),
    ).toEqual(rejected("below_min_stay"));
    expect(
      await prepareCheckout(
        admin,
        checkout(stay("2027-10-04", "2027-10-06", { adults: 9 })),
        NOW,
      ),
    ).toEqual(rejected("over_capacity"));
    expect(
      await prepareCheckout(admin, checkout(stay("bad", "2027-10-06")), NOW),
    ).toEqual(rejected("invalid_dates"));
  });

  it("gives every failed code the same answer, with no detail", async () => {
    const unknown = await prepareCheckout(
      admin,
      checkout(stay("2027-10-04", "2027-10-06"), "NO-SUCH-CODE"),
      NOW,
    );
    const otherRoom = await prepareCheckout(
      admin,
      checkout(
        { ...stay("2027-10-04", "2027-10-06"), roomId: SEED_ROOM },
        promoCode,
      ),
      NOW,
    );
    expect(unknown).toEqual(rejected("promo_unavailable"));
    expect(otherRoom).toEqual(unknown);
  });

  it("builds exact create_hold arguments from one view of settings", async () => {
    const input = checkout(
      stay("2027-10-04", "2027-10-06", { adults: 3, children: 1 }),
    );
    const prepared = await prepareCheckout(admin, input, NOW);
    if (!prepared.ok) throw new Error(prepared.reason);

    // 2 nights at 100.00, 2 extra guests at 10.00, 30.00 cleaning, 4.00 fee.
    const total = 20000 + 4000 + 3000 + 400;
    expect(prepared.paymentKind).toBe("deposit");
    expect(prepared.breakdown.totalCents).toBe(total);
    expect(prepared.holdArgs).toEqual({
      p_room_id: roomId,
      p_check_in: "2027-10-04",
      p_check_out: "2027-10-06",
      p_adults: 3,
      p_children: 1,
      p_guest: input.guest,
      p_price_breakdown: prepared.breakdown,
      p_total_cents: total,
      p_due_now_cents: 8220,
      p_rules_snapshot: {
        payment: {
          mode: "deposit",
          deposit: { kind: "percent", percent: 30 },
          balanceDaysBefore: 14,
        },
        cancellation: {
          isNonRefundable: false,
          tiers: [
            { daysBefore: 30, refundPercent: 100 },
            { daysBefore: 0, refundPercent: 0 },
          ],
        },
        capturedAt: NOW.toISOString(),
      },
      p_terms_version: "engine-test",
      p_token_hash: input.tokenHash,
      p_token_expires_at: input.tokenExpiresAt,
      p_hold_minutes: 35,
      p_promo_code: undefined,
    });
  });

  it("calls a booking inside the balance window a full payment", async () => {
    // 4 October less 14 days is 20 September, which is today here.
    const prepared = await prepareCheckout(
      admin,
      checkout(stay("2027-10-04", "2027-10-06")),
      new Date("2027-09-20T06:00:00Z"),
    );
    if (!prepared.ok) throw new Error(prepared.reason);
    expect(prepared.paymentKind).toBe("full");
    expect(prepared.holdArgs.p_due_now_cents).toBe(23400);
    expect(prepared.breakdown.balanceDueOn).toBeNull();
  });
});

describe("a real checkout through create_hold", () => {
  const plainStay = (checkIn: string, checkOut: string) => ({
    ...stay(checkIn, checkOut),
    roomId: plainRoomId,
  });

  it("stores exactly what prepareCheckout priced, and spends the code", async () => {
    const now = new Date();
    const checkIn = inDays(40);
    const checkOut = addDays(checkIn, 3);
    const usesBefore = await usesOf(promoCode);

    const { prepared, bookingId } = await placeHold(
      checkout(plainStay(checkIn, checkOut), promoCode.toLowerCase()),
      now,
    );

    // 3 nights at 100.00 and 30.00 cleaning, less 10%, plus 6.00 of fee.
    expect(prepared.breakdown.totalCents).toBe(33000 - 3300 + 600);
    expect(prepared.breakdown.dueNowCents).toBe(9090);
    expect(prepared.breakdown.balanceCents).toBe(21210);
    expect(prepared.paymentKind).toBe("deposit");

    const { rows } = await db.query(
      `select status, check_in::text, check_out::text, total_cents, due_now_cents,
         promo_code, price_breakdown, rules_snapshot
       from public.bookings where id = $1`,
      [bookingId],
    );
    expect(rows[0]).toMatchObject({
      status: "pending_payment",
      check_in: checkIn,
      check_out: checkOut,
      total_cents: 30300,
      due_now_cents: 9090,
      promo_code: promoCode,
    });
    expect(rows[0].price_breakdown).toEqual(prepared.breakdown);
    expect(rows[0].rules_snapshot).toEqual(prepared.holdArgs.p_rules_snapshot);
    expect(await usesOf(promoCode)).toBe(usesBefore + 1);

    const claims = await db.query(
      `select kind from public.inventory_claims where booking_id = $1`,
      [bookingId],
    );
    expect(claims.rows).toEqual([{ kind: "hold" }]);

    // The next guest in is turned away by the same door.
    expect(
      await prepareCheckout(
        admin,
        checkout(plainStay(checkIn, checkOut), promoCode),
        now,
      ),
    ).toEqual({ ok: false, reason: "dates_unavailable" });
  });

  it("sends no code when none was typed", async () => {
    const checkIn = inDays(80);
    const checkOut = addDays(checkIn, 2);
    const usesBefore = await usesOf(promoCode);

    const { bookingId } = await placeHold(
      checkout(plainStay(checkIn, checkOut)),
      new Date(),
    );

    const { rows } = await db.query(
      `select promo_code, total_cents from public.bookings where id = $1`,
      [bookingId],
    );
    expect(rows[0]).toEqual({
      promo_code: null,
      total_cents: 20000 + 3000 + 400,
    });
    expect(await usesOf(promoCode)).toBe(usesBefore);
  });
});

describe("a client without access", () => {
  it("fails loudly rather than quoting a house with no fees", async () => {
    const anon = createClient<Database>(URL, keys.publishable, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await expect(
      createPricingService(anon).quote(
        { stay: stay("2027-10-04", "2027-10-06") },
        NOW,
      ),
    ).rejects.toThrow("Missing setting");
  });
});
