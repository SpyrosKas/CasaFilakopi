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
import {
  createAvailabilityService,
  createPricingService,
  loadRulesSnapshot,
} from "../../lib/domain/services";
import { createHold, db } from "./helpers";

// Reads the seeded settings and writes only to a room made for this file, which
// is removed afterwards. The shared seed room is never touched.

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

let roomId: string;
let promoCode: string;
const bookingIds: string[] = [];

beforeAll(async () => {
  roomId = randomUUID();
  promoCode = `ENGINE-${randomUUID()}`;
  await db.query(
    `insert into public.rooms (id, slug, name, max_adults, max_children, base_occupancy,
       base_price_cents, extra_guest_fee_cents, cleaning_fee_cents)
     values ($1, $2, '{"en":"Engine test"}', 4, 2, 2, 10000, 1000, 3000)`,
    [roomId, `engine-${roomId}`],
  );
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
    [promoCode, [roomId]],
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
  await db.query(`delete from public.rooms where id = $1`, [roomId]);
  // The audit triggers log every row above, so those entries go last.
  await db.query(
    `delete from public.audit_log
     where entity_id = any($1)
       or before ->> 'room_id' = $2
       or after ->> 'room_id' = $2`,
    [[roomId, ...bookingIds], roomId],
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

describe("settings", () => {
  it("parses the seeded rows", async () => {
    const { data } = await admin
      .from("settings")
      .select("key, value")
      .in("key", ["booking", "payment"]);
    const value = (key: string) => data?.find((r) => r.key === key)?.value;
    expect(parseBookingSettings(value("booking")).weekendDays).toEqual([5, 6]);
    expect(parsePaymentRules(value("payment")).mode).toBeDefined();
  });

  it("builds a snapshot from the seeded policy", async () => {
    const snapshot = await loadRulesSnapshot(admin, NOW);
    expect(snapshot.capturedAt).toBe(NOW.toISOString());
    expect(snapshot.cancellation.tiers.length).toBeGreaterThan(0);
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
    bookingIds.push(
      await createHold({
        roomId,
        checkIn: "2027-11-10",
        checkOut: "2027-11-12",
      }),
    );
    expect(
      await availability.checkStay(stay("2027-11-11", "2027-11-13")),
    ).toEqual({
      ok: false,
      reason: "dates_unavailable",
    });
    expect(
      await availability.checkStay(stay("2027-11-12", "2027-11-14")),
    ).toEqual({
      ok: true,
    });
    expect(
      await availability.checkStay(stay("2027-11-08", "2027-11-10")),
    ).toEqual({
      ok: true,
    });
  });
});

describe("getCalendar", () => {
  it("returns one row per night from the RPC", async () => {
    const calendar = await availability.getCalendar(
      roomId,
      "2027-11-09",
      "2027-11-13",
    );
    expect(calendar).toEqual([
      { night: "2027-11-09", isAvailable: true },
      { night: "2027-11-10", isAvailable: false },
      { night: "2027-11-11", isAvailable: false },
      { night: "2027-11-12", isAvailable: true },
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
    const kinds = breakdown.lines.map((line) => line.kind);
    expect(kinds).toContain("extra_guest");
    expect(kinds).toContain("cleaning");
    expect(
      breakdown.lines.reduce((sum, line) => sum + line.totalCents, 0),
    ).toBe(breakdown.totalCents);
    expect(breakdown.dueNowCents + breakdown.balanceCents).toBe(
      breakdown.totalCents,
    );
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
    expect(breakdown.lines.some((l) => l.kind === "discount")).toBe(true);
  });

  it("does not let a wildcard match a code", async () => {
    const breakdown = await pricing.quote(
      { stay: stay("2027-10-04", "2027-10-06"), promoCode: "%" },
      NOW,
    );
    expect(breakdown.promoCode).toBeNull();
    expect(breakdown.promoRejection).toBe("not_found");
  });

  it("rejects a promo for a room outside its list", async () => {
    const breakdown = await pricing.quote(
      {
        stay: { ...stay("2027-10-04", "2027-10-06"), roomId: SEED_ROOM },
        promoCode,
      },
      NOW,
    );
    expect(breakdown.promoRejection).toBe("room_not_eligible");
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
