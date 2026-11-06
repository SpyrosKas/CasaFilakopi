import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAYMENT_RULES,
  DEFAULT_WEEKEND_DAYS,
  parseBookingSettings,
  parseCancellationTiers,
  parsePaymentRules,
} from "@/lib/domain";

// The values in supabase/seed.sql, unchanged.
const SEED_BOOKING = {
  holdMinutes: 35,
  checkoutSessionMinutes: 30,
  sameDayCutoffHour: 12,
  horizonMonths: 18,
};
const SEED_PAYMENT = {
  mode: "deposit",
  deposit: { kind: "percent", percent: 30 },
  balanceDaysBefore: 14,
};

describe("booking settings", () => {
  it("reads the seed and defaults the new keys", () => {
    expect(parseBookingSettings(SEED_BOOKING)).toEqual({
      ...SEED_BOOKING,
      weekendDays: [5, 6],
      minLeadDays: 0,
    });
    expect(DEFAULT_WEEKEND_DAYS).toEqual([5, 6]);
  });

  it("keeps a configured weekend, including none", () => {
    expect(
      parseBookingSettings({ ...SEED_BOOKING, weekendDays: [0, 6] })
        .weekendDays,
    ).toEqual([0, 6]);
    expect(
      parseBookingSettings({ ...SEED_BOOKING, weekendDays: [] }).weekendDays,
    ).toEqual([]);
  });

  it.each([
    [{ ...SEED_BOOKING, weekendDays: [7] }],
    [{ ...SEED_BOOKING, sameDayCutoffHour: 25 }],
    [{ ...SEED_BOOKING, horizonMonths: 0 }],
    [{ ...SEED_BOOKING, holdMinutes: 30 }],
    [{ holdMinutes: 35 }],
    [null],
  ])("refuses %j", (value) => {
    expect(() => parseBookingSettings(value)).toThrow();
  });
});

describe("holdMinutes", () => {
  it("accepts the shortest hold create_hold allows", () => {
    expect(
      parseBookingSettings({ ...SEED_BOOKING, holdMinutes: 31 }).holdMinutes,
    ).toBe(31);
  });
});

describe("payment rules", () => {
  it("reads the seed", () => {
    expect(parsePaymentRules(SEED_PAYMENT)).toEqual(SEED_PAYMENT);
  });

  it("reads a fixed deposit", () => {
    const value = {
      mode: "deposit",
      deposit: { kind: "fixed", amountCents: 20000 },
      balanceDaysBefore: 30,
    };
    expect(parsePaymentRules(value)).toEqual(value);
  });

  it("treats 0 balance days as paying the balance on arrival", () => {
    expect(
      parsePaymentRules({ ...SEED_PAYMENT, balanceDaysBefore: 0 })
        .balanceDaysBefore,
    ).toBe(0);
  });

  it.each([[undefined], [null], [{}]])("defaults %j to full", (value) => {
    expect(parsePaymentRules(value)).toEqual({
      mode: "full",
      deposit: null,
      balanceDaysBefore: 0,
    });
    expect(DEFAULT_PAYMENT_RULES.mode).toBe("full");
  });

  it("defaults a missing mode to full", () => {
    expect(parsePaymentRules({ balanceDaysBefore: 7 }).mode).toBe("full");
  });

  it.each([12.5, 33.33, 0.01, 99.99])("accepts a %d%% deposit", (percent) => {
    const deposit = { kind: "percent", percent };
    expect(parsePaymentRules({ ...SEED_PAYMENT, deposit }).deposit).toEqual(
      deposit,
    );
  });

  it.each([
    [{ ...SEED_PAYMENT, deposit: null }],
    [{ ...SEED_PAYMENT, mode: "on_arrival" }],
    [{ ...SEED_PAYMENT, mode: "later" }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 0 } }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 100 } }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 120 } }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 12.345 } }],
    [{ ...SEED_PAYMENT, deposit: { kind: "fixed", amountCents: 10.5 } }],
  ])("refuses %j", (value) => {
    expect(() => parsePaymentRules(value)).toThrow();
  });
});

describe("cancellation tiers", () => {
  it("reads the seed", () => {
    const tiers = [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ];
    expect(parseCancellationTiers(tiers)).toEqual(tiers);
  });

  it("accepts tiers in any order, and equal percentages", () => {
    const tiers = [
      { daysBefore: 0, refundPercent: 50 },
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 14, refundPercent: 50 },
    ];
    expect(parseCancellationTiers(tiers)).toEqual(tiers);
  });

  it("accepts two decimals, and no tiers at all", () => {
    expect(
      parseCancellationTiers([{ daysBefore: 7, refundPercent: 33.33 }]),
    ).toHaveLength(1);
    expect(parseCancellationTiers([])).toEqual([]);
  });

  it.each([
    ["a refund above 100%", [{ daysBefore: 0, refundPercent: 101 }]],
    ["a negative refund", [{ daysBefore: 0, refundPercent: -1 }]],
    ["three decimals", [{ daysBefore: 0, refundPercent: 33.333 }]],
    ["negative days", [{ daysBefore: -1, refundPercent: 0 }]],
    ["fractional days", [{ daysBefore: 1.5, refundPercent: 0 }]],
    [
      "duplicate days",
      [
        { daysBefore: 14, refundPercent: 50 },
        { daysBefore: 14, refundPercent: 25 },
      ],
    ],
    [
      "more back closer to check-in",
      [
        { daysBefore: 30, refundPercent: 50 },
        { daysBefore: 14, refundPercent: 75 },
      ],
    ],
    [
      "the same, out of order",
      [
        { daysBefore: 14, refundPercent: 75 },
        { daysBefore: 30, refundPercent: 50 },
      ],
    ],
  ])("refuses %s", (_, tiers) => {
    expect(() => parseCancellationTiers(tiers)).toThrow();
  });
});

describe("limits that stop a typing slip breaking checkout", () => {
  const deposit = (percent: number, balanceDaysBefore = 14) => ({
    mode: "deposit",
    deposit: { kind: "percent", percent },
    balanceDaysBefore,
  });

  it("refuses an absurd balance timing", () => {
    expect(() => parsePaymentRules(deposit(30, 101000000))).toThrow();
    expect(() => parsePaymentRules(deposit(30, 366))).toThrow();
    expect(parsePaymentRules(deposit(30, 365)).balanceDaysBefore).toBe(365);
  });

  it("refuses a deposit under 1%", () => {
    expect(() => parsePaymentRules(deposit(0.01))).toThrow();
    expect(parsePaymentRules(deposit(1)).mode).toBe("deposit");
  });

  it("refuses an absurd tier", () => {
    expect(() =>
      parseCancellationTiers([{ daysBefore: 10000000, refundPercent: 50 }]),
    ).toThrow();
  });
});
