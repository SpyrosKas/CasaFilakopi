import { describe, expect, it } from "vitest";
import {
  addDays,
  buildPriceBreakdown,
  calculateRefund,
  checkStayRules,
  daysBetween,
  linesTotal,
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
const date = (r: Random, span = 800) => addDays(START, r.int(0, span));

function randomStay(r: Random) {
  const checkIn = date(r);
  return {
    roomId: ROOM_ID,
    checkIn,
    checkOut: addDays(checkIn, r.int(1, 40)),
    adults: r.int(1, 4),
    children: r.int(0, 2),
  };
}

function randomFee(r: Random): TaxFeeRow {
  const percent = r.chance(0.5);
  const from = r.chance(0.3) ? date(r) : null;
  return fee({
    kind: percent
      ? "percent"
      : r.pick(["per_stay", "per_night", "per_guest_night"] as const),
    amount_cents: percent ? null : r.int(0, 5000),
    rate_basis_points: percent ? r.int(1, 3333) : null,
    is_vat: r.chance(0.3),
    valid_from: from,
    valid_to: r.chance(0.3) ? date(r) : null,
    is_active: r.chance(0.9),
    sort_order: r.int(0, 3),
  });
}

function randomPayment(r: Random): PaymentRules {
  const deposit = r.pick<PaymentRules["deposit"]>([
    { kind: "percent", percent: r.int(1, 100) },
    { kind: "percent", percent: r.int(1, 9999) / 100 },
    { kind: "fixed", amountCents: r.int(1, 500000) },
  ]);
  return {
    mode: r.pick(["full", "deposit", "on_arrival"] as const),
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
    now: new Date(Date.UTC(2027, 0, 1) + r.int(0, 86400 * 800) * 1000),
  });
}

describe("every random quote", () => {
  const r = randomSource(20261107);
  const quotes = Array.from({ length: RUNS }, () => {
    const input = randomInput(r);
    return { input, breakdown: buildPriceBreakdown(input) };
  });

  it("has lines that sum to the total", () => {
    for (const { breakdown } of quotes) {
      expect(linesTotal(breakdown.lines)).toBe(breakdown.totalCents);
    }
  });

  it("has dueNow + balance equal to the total", () => {
    for (const { breakdown } of quotes) {
      expect(breakdown.dueNowCents + breakdown.balanceCents).toBe(
        breakdown.totalCents,
      );
    }
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
        daysBetween(input.stay.checkIn, input.stay.checkOut),
      );
      const accommodation = breakdown.lines.filter(
        (line) => line.kind === "accommodation",
      );
      expect(linesTotal(accommodation)).toBe(
        breakdown.nights.reduce((sum, night) => sum + night.cents, 0),
      );
    }
  });

  it("has a due date exactly when there is a balance", () => {
    for (const { breakdown } of quotes) {
      expect(breakdown.balanceDueOn !== null).toBe(breakdown.balanceCents > 0);
    }
  });

  it("names a promo only when a discount rule accepted it", () => {
    for (const { breakdown } of quotes) {
      expect(breakdown.promoCode === null).toBe(
        breakdown.promoRejection !== undefined,
      );
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

  it("stays between 0 and paid, and adds back up to paid", () => {
    for (let i = 0; i < RUNS; i++) {
      const paidCents = r.int(0, 2_000_000);
      const checkIn = date(r);
      const { refundCents, retainedCents } = calculateRefund({
        rules: randomRules(),
        checkIn,
        cancelledOn: addDays(checkIn, -r.int(-10, 120)),
        paidCents,
      });
      expect(Number.isSafeInteger(refundCents)).toBe(true);
      expect(refundCents).toBeGreaterThanOrEqual(0);
      expect(refundCents).toBeLessThanOrEqual(paidCents);
      expect(refundCents + retainedCents).toBe(paidCents);
    }
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
        cancelledOn: addDays(checkIn, -days),
        paidCents: 99999,
      });
      expect(refundCents).toBeLessThanOrEqual(previous);
      previous = refundCents;
    }
  });
});

describe("every random availability check", () => {
  const r = randomSource(2718);

  it("gives an answer and never throws", () => {
    for (let i = 0; i < RUNS; i++) {
      const start = date(r);
      const result = checkStayRules({
        stay: randomStay(r),
        room: ROOM,
        restrictions: [
          restriction({
            start_date: start,
            end_date: addDays(start, r.int(0, 60)),
            min_stay: r.chance(0.5) ? r.int(1, 7) : null,
            max_stay: r.chance(0.5) ? r.int(7, 30) : null,
            closed_to_arrival: r.chance(0.2),
            closed_to_departure: r.chance(0.2),
            allowed_check_in_days: r.chance(0.3) ? [r.int(0, 6)] : null,
          }),
        ],
        booking: BOOKING,
        now: new Date(Date.UTC(2027, 0, 1) + r.int(0, 86400 * 800) * 1000),
      });
      expect(typeof result.ok).toBe("boolean");
    }
  });
});
