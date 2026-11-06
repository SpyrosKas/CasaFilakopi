import { describe, expect, it } from "vitest";
import {
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
    [{ holdMinutes: 35 }],
    [null],
  ])("refuses %j", (value) => {
    expect(() => parseBookingSettings(value)).toThrow();
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

  it("defaults the deposit to none outside deposit mode", () => {
    expect(
      parsePaymentRules({ mode: "full", balanceDaysBefore: 0 }).deposit,
    ).toBeNull();
  });

  it.each([
    [{ ...SEED_PAYMENT, deposit: null }],
    [{ ...SEED_PAYMENT, mode: "later" }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 0 } }],
    [{ ...SEED_PAYMENT, deposit: { kind: "percent", percent: 120 } }],
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

  it("refuses a refund above 100%", () => {
    expect(() =>
      parseCancellationTiers([{ daysBefore: 0, refundPercent: 101 }]),
    ).toThrow();
  });
});
