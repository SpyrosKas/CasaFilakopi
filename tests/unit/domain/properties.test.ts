import { describe, expect, it } from "vitest";
import {
  buildPriceBreakdown,
  calculateRefund,
  checkStayRules,
  type BreakdownInput,
  type TaxFeeRow,
} from "@/lib/domain";
import type { CancellationRules, PaymentRules } from "@/lib/domain/contracts";
import {
  BOOKING,
  breakdownInput,
  fee,
  promo,
  restriction,
  ROOM,
  ROOM_ID,
} from "./fixtures";

const RUNS = 5000;

// The oracle below reworks each answer from the rules, sharing no code with
// lib/domain: its own date helpers and BigInt rounding. A test that compared
// the engine's total with the engine's lines would prove nothing.

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;
const isoDate = (day: number) =>
  new Date(day * DAY_MS).toISOString().slice(0, 10);
const shift = (date: string, days: number) => isoDate(dayNumber(date) + days);
const weekday = (date: string) =>
  new Date(dayNumber(date) * DAY_MS).getUTCDay();

const athensToday = (now: Date) =>
  now.toLocaleDateString("sv-SE", { timeZone: "Europe/Athens" });
const athensClockHour = (now: Date) =>
  Number(
    now.toLocaleString("en-GB", {
      timeZone: "Europe/Athens",
      hour: "2-digit",
      hourCycle: "h23",
    }),
  );

/** Half up, in exact arithmetic. */
const shareOf = (cents: number, basisPoints: number) =>
  Number(
    (BigInt(cents) * BigInt(basisPoints) * BigInt(2) + BigInt(10000)) /
      BigInt(20000),
  );

const inWindow = (date: string, row: TaxFeeRow) =>
  (!row.valid_from || row.valid_from <= date) &&
  (!row.valid_to || date <= row.valid_to);

function expectedTotal(input: BreakdownInput): number {
  const { stay, room, seasons, overrides, fees, promo: code } = input;
  const nights: string[] = [];
  for (let day = dayNumber(stay.checkIn); isoDate(day) < stay.checkOut; day++) {
    nights.push(isoDate(day));
  }

  let house = room.cleaning_fee_cents;
  for (const night of nights) {
    const override = overrides.findLast((row) => row.night === night);
    const season = seasons.find(
      (row) => row.start_date <= night && row.end_date >= night,
    );
    const isWeekend = input.weekendDays.includes(weekday(night));
    if (override) house += override.nightly_cents;
    else if (!season) house += room.base_price_cents;
    else if (isWeekend && season.weekend_cents !== null) {
      house += season.weekend_cents;
    } else house += season.nightly_cents;
  }
  const guests = stay.adults + stay.children;
  const extra = Math.max(guests - room.base_occupancy, 0);
  house += extra * nights.length * room.extra_guest_fee_cents;

  const discount = !code
    ? 0
    : Math.min(
        code.kind === "percent" ? shareOf(house, code.value) : code.value,
        house,
      );
  const afterDiscount = house - discount;

  let total = afterDiscount;
  for (const row of fees.filter((candidate) => candidate.is_active)) {
    const nightsCovered = nights.filter((n) => inWindow(n, row)).length;
    const amount = row.amount_cents ?? 0;
    if (row.kind === "per_night") total += amount * nightsCovered;
    if (row.kind === "per_guest_night") {
      total += amount * nightsCovered * guests;
    }
    if (!inWindow(stay.checkIn, row)) continue;
    if (row.kind === "per_stay") total += amount;
    if (row.kind === "percent") {
      total += shareOf(afterDiscount, row.rate_basis_points ?? 0);
    }
  }
  return total;
}

function expectedDueNow(input: BreakdownInput, total: number): number {
  const { mode, deposit, balanceDaysBefore } = input.payment;
  if (mode === "full") return total;
  const dueOn = shift(input.stay.checkIn, -balanceDaysBefore);
  if (athensToday(input.now) >= dueOn) return total;
  if (deposit?.kind === "percent") {
    return shareOf(total, Math.round(deposit.percent * 100));
  }
  return Math.min(deposit?.amountCents ?? 0, total);
}

/** Seeded, so a failure reproduces. */
function randomSource(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  const chance = (p: number) => next() < p;
  const pick = <T>(items: T[]): T => items[int(0, items.length - 1)];
  return { int, chance, pick };
}

type Random = ReturnType<typeof randomSource>;

const START = "2027-01-01";
const date = (r: Random, span = 800) => shift(START, r.int(0, span));
const randomNow = (r: Random) =>
  new Date(Date.UTC(2027, 0, 1) + r.int(0, 86400 * 800) * 1000);

function randomStay(r: Random) {
  const checkIn = date(r);
  return {
    roomId: ROOM_ID,
    checkIn,
    checkOut: shift(checkIn, r.int(1, 40)),
    adults: r.int(1, 4),
    children: r.int(0, 2),
  };
}

function randomFee(r: Random): TaxFeeRow {
  const percent = r.chance(0.5);
  return fee({
    kind: percent
      ? "percent"
      : r.pick(["per_stay", "per_night", "per_guest_night"] as const),
    amount_cents: percent ? null : r.int(0, 5000),
    rate_basis_points: percent ? r.int(1, 3333) : null,
    is_vat: r.chance(0.3),
    valid_from: r.chance(0.3) ? date(r) : null,
    valid_to: r.chance(0.3) ? date(r) : null,
    is_active: r.chance(0.9),
    sort_order: r.int(0, 3),
  });
}

function randomPayment(r: Random): PaymentRules {
  const deposit = r.pick<PaymentRules["deposit"]>([
    { kind: "percent", percent: r.int(1, 99) },
    { kind: "percent", percent: r.int(1, 9999) / 100 },
    { kind: "fixed", amountCents: r.int(1, 500000) },
  ]);
  return {
    mode: r.pick(["full", "deposit"] as const),
    deposit,
    balanceDaysBefore: r.int(0, 60),
  };
}

function randomInput(r: Random) {
  return breakdownInput({
    stay: randomStay(r),
    room: {
      ...ROOM,
      base_price_cents: r.int(1, 99999),
      extra_guest_fee_cents: r.int(0, 4999),
      cleaning_fee_cents: r.chance(0.2) ? 0 : r.int(1, 9999),
    },
    seasons: [
      {
        start_date: "2027-05-01",
        end_date: "2027-09-30",
        nightly_cents: r.int(1, 99999),
        weekend_cents: r.chance(0.5) ? r.int(1, 99999) : null,
      },
    ],
    overrides: Array.from({ length: r.int(0, 5) }, () => ({
      night: date(r),
      nightly_cents: r.int(0, 99999),
    })),
    fees: Array.from({ length: r.int(0, 4) }, () => randomFee(r)),
    weekendDays: r.pick([[5, 6], [6, 0], [], [4, 5, 6]]),
    payment: randomPayment(r),
    promoCode: "CODE",
    promo: r.chance(0.5)
      ? promo({
          kind: r.chance(0.5) ? "percent" : "fixed",
          value: r.int(1, 20000),
        })
      : null,
    now: randomNow(r),
  });
}

describe("every random quote", () => {
  const r = randomSource(20261107);
  const quotes = Array.from({ length: RUNS }, () => {
    const input = randomInput(r);
    return { input, breakdown: buildPriceBreakdown(input) };
  });

  const sum = (amounts: number[]) => amounts.reduce((a, b) => a + b, 0);

  it("totals what the rules say, to the cent", () => {
    for (const { input, breakdown } of quotes) {
      expect(breakdown.totalCents).toBe(expectedTotal(input));
    }
  });

  it("has lines that sum to that total", () => {
    for (const { input, breakdown } of quotes) {
      expect(sum(breakdown.lines.map((line) => line.totalCents))).toBe(
        expectedTotal(input),
      );
    }
  });

  it("takes what the rules say now, and dueNow + balance is the total", () => {
    for (const { input, breakdown } of quotes) {
      const total = expectedTotal(input);
      const dueNow = expectedDueNow(input, total);
      expect(breakdown.dueNowCents).toBe(dueNow);
      expect(breakdown.balanceCents).toBe(total - dueNow);
    }
  });

  it("reaches both a split and a payment in full", () => {
    const split = quotes.filter((q) => q.breakdown.balanceCents > 0);
    expect(split.length).toBeGreaterThan(100);
    expect(split.length).toBeLessThan(RUNS - 100);
  });

  it("is whole cents, never negative in what the guest owes", () => {
    for (const { breakdown } of quotes) {
      const amounts = [
        breakdown.totalCents,
        breakdown.dueNowCents,
        breakdown.balanceCents,
      ];
      for (const amount of amounts) {
        expect(Number.isSafeInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("has every line equal to quantity times unit", () => {
    for (const { breakdown } of quotes) {
      for (const line of breakdown.lines) {
        expect(Number.isSafeInteger(line.totalCents)).toBe(true);
        expect(line.quantity * line.unitCents).toBe(line.totalCents);
      }
    }
  });

  it("has one price per night, matching the accommodation lines", () => {
    for (const { input, breakdown } of quotes) {
      expect(breakdown.nights).toHaveLength(
        dayNumber(input.stay.checkOut) - dayNumber(input.stay.checkIn),
      );
      const accommodation = breakdown.lines.filter(
        (line) => line.kind === "accommodation",
      );
      expect(sum(accommodation.map((line) => line.totalCents))).toBe(
        sum(breakdown.nights.map((night) => night.cents)),
      );
    }
  });

  it("has a due date exactly when there is a balance", () => {
    for (const { breakdown } of quotes) {
      expect(breakdown.balanceDueOn !== null).toBe(breakdown.balanceCents > 0);
    }
  });

  it("says a typed code failed exactly when no code was applied", () => {
    for (const { input, breakdown } of quotes) {
      expect(breakdown.promoCode === null).toBe(input.promo === null);
      expect(breakdown.promoRejected === true).toBe(input.promo === null);
    }
  });
});

describe("every random refund", () => {
  const r = randomSource(31415);

  const randomRules = (): CancellationRules => ({
    isNonRefundable: r.chance(0.1),
    tiers: Array.from({ length: r.int(0, 4) }, () => ({
      daysBefore: r.int(0, 90),
      refundPercent: r.chance(0.5) ? r.int(0, 100) : r.int(0, 10000) / 100,
    })),
  });

  /** What the house keeps, reworked from the rules. */
  function expectedCharge(
    rules: CancellationRules,
    daysBefore: number,
    totalCents: number,
  ) {
    if (rules.isNonRefundable) return totalCents;
    const inForce = rules.tiers.filter((t) => t.daysBefore <= daysBefore);
    const closest = Math.max(...inForce.map((t) => t.daysBefore));
    const tier = inForce.find((t) => t.daysBefore === closest);
    const basisPoints = Math.round((tier?.refundPercent ?? 0) * 100);
    return totalCents - shareOf(totalCents, basisPoints);
  }

  const cases = Array.from({ length: RUNS }, () => {
    const totalCents = r.int(0, 2_000_000);
    const checkIn = date(r);
    const daysBefore = r.int(-10, 120);
    const input = {
      rules: randomRules(),
      checkIn,
      cancelledOn: shift(checkIn, -daysBefore),
      totalCents,
      // Less than, equal to and above the total.
      paidCents: r.pick([
        totalCents,
        r.int(0, totalCents),
        totalCents + r.int(0, 50000),
      ]),
    };
    const charge = expectedCharge(input.rules, daysBefore, totalCents);
    return { input, charge, outcome: calculateRefund(input) };
  });

  it("gives back exactly what was paid above the charge", () => {
    for (const { input, charge, outcome } of cases) {
      expect(outcome.refundCents).toBe(Math.max(input.paidCents - charge, 0));
    }
  });

  it("keeps the charge between what is retained and what is still owed", () => {
    for (const { charge, outcome } of cases) {
      expect(outcome.retainedCents + outcome.stillOwedCents).toBe(charge);
    }
  });

  it("stays between 0 and paid, and adds back up to paid", () => {
    for (const { input, outcome } of cases) {
      expect(Number.isSafeInteger(outcome.refundCents)).toBe(true);
      expect(outcome.refundCents).toBeGreaterThanOrEqual(0);
      expect(outcome.refundCents).toBeLessThanOrEqual(input.paidCents);
      expect(outcome.refundCents + outcome.retainedCents).toBe(input.paidCents);
    }
  });

  it("never owes and refunds at once", () => {
    for (const { outcome } of cases) {
      expect(outcome.refundCents * outcome.stillOwedCents).toBe(0);
    }
  });

  it("refunds nothing more when repeated after paying the refund", () => {
    for (const { input, outcome } of cases) {
      const again = calculateRefund({
        ...input,
        paidCents: input.paidCents - outcome.refundCents,
      });
      expect(again.refundCents).toBe(0);
      expect(again.stillOwedCents).toBe(outcome.stillOwedCents);
    }
  });

  it("reaches a refund, a retained amount and a sum still owed", () => {
    const count = (test: (o: (typeof cases)[0]["outcome"]) => boolean) =>
      cases.filter((c) => test(c.outcome)).length;
    expect(count((o) => o.refundCents > 0)).toBeGreaterThan(100);
    expect(count((o) => o.retainedCents > 0)).toBeGreaterThan(100);
    expect(count((o) => o.stillOwedCents > 0)).toBeGreaterThan(100);
  });

  it("never pays more for cancelling later under monotonic tiers", () => {
    const rules: CancellationRules = {
      isNonRefundable: false,
      tiers: [
        { daysBefore: 60, refundPercent: 100 },
        { daysBefore: 30, refundPercent: 50 },
        { daysBefore: 7, refundPercent: 25 },
      ],
    };
    const checkIn = "2028-01-15";
    let previous = Infinity;
    for (let days = 120; days >= -5; days--) {
      const { refundCents } = calculateRefund({
        rules,
        checkIn,
        cancelledOn: shift(checkIn, -days),
        totalCents: 99999,
        paidCents: 99999,
      });
      expect(refundCents).toBeLessThanOrEqual(previous);
      previous = refundCents;
    }
  });
});

describe("every random availability check", () => {
  const r = randomSource(2718);

  /** 18 months on, clamped to the month's end. */
  function horizonFrom(today: string) {
    const [year, month, day] = today.split("-").map(Number);
    const months = month - 1 + BOOKING.horizonMonths;
    const lastDay = new Date(Date.UTC(year, months + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, months, Math.min(day, lastDay)))
      .toISOString()
      .slice(0, 10);
  }

  const cases = Array.from({ length: RUNS }, () => {
    const now = randomNow(r);
    const today = athensToday(now);
    const checkIn = r.chance(0.1) ? today : shift(today, r.int(-2, 620));
    const checkOut = shift(checkIn, r.int(1, 40));
    const stay = {
      roomId: ROOM_ID,
      checkIn,
      checkOut,
      adults: r.int(0, 5),
      children: r.int(0, 3),
    };
    const start = shift(checkIn, r.int(-30, 5));
    const rule = restriction({
      start_date: start,
      end_date: shift(start, r.int(0, 60)),
      min_stay: r.chance(0.3) ? r.int(1, 7) : null,
      max_stay: r.chance(0.3) ? r.int(7, 30) : null,
      closed_to_arrival: r.chance(0.1),
      closed_to_departure: r.chance(0.1),
      allowed_check_in_days: r.chance(0.2) ? [r.int(0, 6), r.int(0, 6)] : null,
    });

    const nights = dayNumber(checkOut) - dayNumber(checkIn);
    const covers = (date: string) =>
      rule.start_date <= date && date <= rule.end_date;
    const onArrival = covers(checkIn);
    const broken = new Set<string>();
    if (checkIn < today) broken.add("invalid_dates");
    if (stay.adults < 1 || stay.adults > 4 || stay.children > 2) {
      broken.add("over_capacity");
    }
    if (checkIn === today && athensClockHour(now) >= 12) {
      broken.add("lead_time_not_met");
    }
    if (shift(checkOut, -1) > horizonFrom(today)) {
      broken.add("beyond_booking_horizon");
    }
    if (onArrival && rule.min_stay !== null && nights < rule.min_stay) {
      broken.add("below_min_stay");
    }
    if (onArrival && rule.max_stay !== null && nights > rule.max_stay) {
      broken.add("above_max_stay");
    }
    if (onArrival && rule.closed_to_arrival) broken.add("closed_to_arrival");
    if (covers(checkOut) && rule.closed_to_departure) {
      broken.add("closed_to_departure");
    }
    if (
      onArrival &&
      rule.allowed_check_in_days &&
      !rule.allowed_check_in_days.includes(weekday(checkIn))
    ) {
      broken.add("check_in_day_not_allowed");
    }

    const result = checkStayRules({
      stay,
      room: ROOM,
      restrictions: [rule],
      booking: BOOKING,
      now,
    });
    return { broken, result };
  });

  it("passes a stay exactly when no rule is broken", () => {
    for (const { broken, result } of cases) {
      expect(result.ok).toBe(broken.size === 0);
    }
  });

  it("always names a rule that really is broken", () => {
    for (const { broken, result } of cases) {
      if (!result.ok) expect(broken).toContain(result.reason);
    }
  });

  it("reaches every rule, and a good share of accepted stays", () => {
    const reasons = new Set(
      cases.flatMap(({ result }) => (result.ok ? [] : [result.reason])),
    );
    expect([...reasons].sort()).toEqual([
      "above_max_stay",
      "below_min_stay",
      "beyond_booking_horizon",
      "check_in_day_not_allowed",
      "closed_to_arrival",
      "closed_to_departure",
      "invalid_dates",
      "lead_time_not_met",
      "over_capacity",
    ]);
    expect(cases.filter((c) => c.result.ok).length).toBeGreaterThan(500);
  });
});
