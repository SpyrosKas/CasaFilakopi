import { describe, expect, it } from "vitest";
import {
  addDays,
  athensDate,
  buildRulesSnapshot,
  calculateRefund,
} from "@/lib/domain";
import type { CancellationRules } from "@/lib/domain/contracts";
import { DEPOSIT_30 } from "./fixtures";

const TIER_30 = { daysBefore: 30, refundPercent: 100 };
const TIER_14 = { daysBefore: 14, refundPercent: 50 };
const TIER_0 = { daysBefore: 0, refundPercent: 0 };

const RULES: CancellationRules = {
  isNonRefundable: false,
  tiers: [TIER_30, TIER_14, TIER_0],
};

const CHECK_IN = "2027-07-15";

const refund = (
  daysBefore: number,
  paidCents = 100000,
  rules: CancellationRules = RULES,
  checkIn = CHECK_IN,
) =>
  calculateRefund({
    rules,
    checkIn,
    cancelledOn: addDays(checkIn, -daysBefore),
    paidCents,
  });

describe("tier boundaries", () => {
  it.each([
    [31, 100000, TIER_30],
    [30, 100000, TIER_30],
    [29, 50000, TIER_14],
    [15, 50000, TIER_14],
    [14, 50000, TIER_14],
    [13, 0, TIER_0],
    [1, 0, TIER_0],
    [0, 0, TIER_0],
  ])("%i days before refunds %i", (days, refundCents, appliedTier) => {
    expect(refund(days)).toEqual({
      refundCents,
      retainedCents: 100000 - refundCents,
      appliedTier,
    });
  });

  it("does not depend on tier order", () => {
    const rules = { ...RULES, tiers: [TIER_0, TIER_30, TIER_14] };
    expect(refund(14, 100000, rules).appliedTier).toEqual(TIER_14);
    expect(refund(30, 100000, rules).appliedTier).toEqual(TIER_30);
  });

  it("refunds nothing after check-in", () => {
    expect(refund(-1)).toEqual({
      refundCents: 0,
      retainedCents: 100000,
      appliedTier: null,
    });
  });

  it("refunds nothing when no tier reaches that close to check-in", () => {
    const rules = { ...RULES, tiers: [TIER_30] };
    expect(refund(29, 100000, rules)).toEqual({
      refundCents: 0,
      retainedCents: 100000,
      appliedTier: null,
    });
  });

  it("refunds nothing with no tiers", () => {
    expect(refund(90, 100000, { ...RULES, tiers: [] }).refundCents).toBe(0);
  });
});

describe("the seed policy", () => {
  const seed: CancellationRules = {
    isNonRefundable: false,
    tiers: [TIER_30, TIER_0],
  };

  it("is free until 30 days out, then nothing", () => {
    expect(refund(30, 5000, seed).refundCents).toBe(5000);
    expect(refund(29, 5000, seed).refundCents).toBe(0);
  });
});

describe("non-refundable", () => {
  it("refunds nothing, however early", () => {
    expect(refund(365, 100000, { ...RULES, isNonRefundable: true })).toEqual({
      refundCents: 0,
      retainedCents: 100000,
      appliedTier: null,
    });
  });
});

describe("amounts", () => {
  it("rounds half up, and retained is the remainder", () => {
    expect(refund(14, 1005)).toMatchObject({
      refundCents: 503,
      retainedCents: 502,
    });
  });

  it("honours a fractional percentage", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: 33.33 }],
    };
    expect(refund(5, 100000, rules).refundCents).toBe(33330);
  });

  it("never refunds more than was paid, even with a corrupt tier", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: 150 }],
    };
    expect(refund(5, 100000, rules)).toMatchObject({
      refundCents: 100000,
      retainedCents: 0,
    });
  });

  it("never goes negative with a corrupt tier", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: -20 }],
    };
    expect(refund(5, 100000, rules).refundCents).toBe(0);
  });

  it("handles nothing paid", () => {
    expect(refund(30, 0)).toMatchObject({ refundCents: 0, retainedCents: 0 });
  });

  it("refuses a fractional or negative amount paid", () => {
    expect(() => refund(30, 10.5)).toThrow(RangeError);
    expect(() => refund(30, -1)).toThrow(RangeError);
  });
});

describe("dates", () => {
  it("counts across a leap day", () => {
    expect(
      calculateRefund({
        rules: RULES,
        checkIn: "2028-03-01",
        cancelledOn: "2028-01-31",
        paidCents: 1000,
      }).appliedTier,
    ).toEqual(TIER_30);
    expect(
      calculateRefund({
        rules: RULES,
        checkIn: "2027-03-01",
        cancelledOn: "2027-01-31",
        paidCents: 1000,
      }).appliedTier,
    ).toEqual(TIER_14);
  });

  it("counts across a year boundary", () => {
    expect(refund(30, 1000, RULES, "2028-01-10").appliedTier).toEqual(TIER_30);
    expect(refund(29, 1000, RULES, "2028-01-10").appliedTier).toEqual(TIER_14);
  });

  it.each(["2027-04-15", "2027-11-15"])(
    "keeps the boundary exact when DST falls inside the window before %s",
    (checkIn) => {
      expect(refund(30, 1000, RULES, checkIn).appliedTier).toEqual(TIER_30);
      expect(refund(29, 1000, RULES, checkIn).appliedTier).toEqual(TIER_14);
    },
  );

  it("takes the day from Athens: a cancel after local midnight loses the tier", () => {
    // 30 days before 15 July is 15 June. 20:59:59 UTC is still 15 June locally.
    const on = (iso: string) =>
      calculateRefund({
        rules: RULES,
        checkIn: CHECK_IN,
        cancelledOn: athensDate(new Date(iso)),
        paidCents: 1000,
      }).refundCents;
    expect(on("2027-06-15T20:59:59Z")).toBe(1000);
    expect(on("2027-06-15T21:00:00Z")).toBe(500);
  });

  it("uses the winter offset in Athens at local midnight", () => {
    const on = (iso: string) =>
      calculateRefund({
        rules: RULES,
        checkIn: "2028-01-30",
        cancelledOn: athensDate(new Date(iso)),
        paidCents: 1000,
      }).refundCents;
    expect(on("2027-12-31T21:59:59Z")).toBe(1000);
    expect(on("2027-12-31T22:00:00Z")).toBe(500);
  });
});

describe("snapshot", () => {
  it("applies the rules it was given, whatever settings say today", () => {
    const now = new Date("2027-06-01T06:00:00Z");
    const snapshot = buildRulesSnapshot(DEPOSIT_30, RULES, now);
    expect(snapshot).toEqual({
      payment: DEPOSIT_30,
      cancellation: RULES,
      capturedAt: "2027-06-01T06:00:00.000Z",
    });
    expect(
      calculateRefund({
        rules: snapshot.cancellation,
        checkIn: CHECK_IN,
        cancelledOn: "2027-06-15",
        paidCents: 2000,
      }).refundCents,
    ).toBe(2000);
  });
});
