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
const TOTAL = 100000;

const refund = (
  daysBefore: number,
  paidCents = TOTAL,
  rules: CancellationRules = RULES,
  checkIn = CHECK_IN,
  totalCents = TOTAL,
) =>
  calculateRefund({
    rules,
    checkIn,
    cancelledOn: addDays(checkIn, -daysBefore),
    totalCents,
    paidCents,
  });

describe("tier boundaries, paid in full", () => {
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
      retainedCents: TOTAL - refundCents,
      stillOwedCents: 0,
      appliedTier,
    });
  });

  it("does not depend on tier order", () => {
    const rules = { ...RULES, tiers: [TIER_0, TIER_30, TIER_14] };
    expect(refund(14, TOTAL, rules).appliedTier).toEqual(TIER_14);
    expect(refund(30, TOTAL, rules).appliedTier).toEqual(TIER_30);
  });

  it("refunds nothing after check-in", () => {
    expect(refund(-1)).toEqual({
      refundCents: 0,
      retainedCents: TOTAL,
      stillOwedCents: 0,
      appliedTier: null,
    });
  });

  it("refunds nothing when no tier reaches that close to check-in", () => {
    const rules = { ...RULES, tiers: [TIER_30] };
    expect(refund(29, TOTAL, rules)).toEqual({
      refundCents: 0,
      retainedCents: TOTAL,
      stillOwedCents: 0,
      appliedTier: null,
    });
  });

  it("refunds nothing with no tiers", () => {
    expect(refund(90, TOTAL, { ...RULES, tiers: [] }).refundCents).toBe(0);
  });
});

describe("tiers are a percentage of the booking, not of what was paid", () => {
  it("50% tier with a 30% deposit paid: nothing back, 200.00 still owed", () => {
    expect(refund(14, 30000)).toEqual({
      refundCents: 0,
      retainedCents: 30000,
      stillOwedCents: 20000,
      appliedTier: TIER_14,
    });
  });

  it("50% tier paid in full: half back", () => {
    expect(refund(14, TOTAL)).toMatchObject({
      refundCents: 50000,
      retainedCents: 50000,
      stillOwedCents: 0,
    });
  });

  it("50% tier with exactly the charge paid: nothing either way", () => {
    expect(refund(14, 50000)).toMatchObject({
      refundCents: 0,
      retainedCents: 50000,
      stillOwedCents: 0,
    });
  });

  it("50% tier with more than the charge paid: the excess back", () => {
    expect(refund(14, 70000)).toMatchObject({
      refundCents: 20000,
      retainedCents: 50000,
      stillOwedCents: 0,
    });
  });

  it("100% tier returns a part payment in full", () => {
    expect(refund(30, 30000)).toEqual({
      refundCents: 30000,
      retainedCents: 0,
      stillOwedCents: 0,
      appliedTier: TIER_30,
    });
  });

  it("0% tier charges the whole booking", () => {
    expect(refund(5, 30000)).toEqual({
      refundCents: 0,
      retainedCents: 30000,
      stillOwedCents: 70000,
      appliedTier: TIER_0,
    });
  });

  it("nothing paid leaves the whole charge owed", () => {
    expect(refund(14, 0)).toMatchObject({
      refundCents: 0,
      retainedCents: 0,
      stillOwedCents: 50000,
    });
  });

  it("the seed policy: free to 30 days, then the whole booking", () => {
    const seed = { isNonRefundable: false, tiers: [TIER_30, TIER_0] };
    expect(refund(30, 30000, seed).refundCents).toBe(30000);
    expect(refund(29, 30000, seed)).toMatchObject({
      refundCents: 0,
      stillOwedCents: 70000,
    });
  });
});

describe("non-refundable", () => {
  const rules = { ...RULES, isNonRefundable: true };

  it("charges the whole booking, however early", () => {
    expect(refund(365, TOTAL, rules)).toEqual({
      refundCents: 0,
      retainedCents: TOTAL,
      stillOwedCents: 0,
      appliedTier: null,
    });
  });

  it("leaves the rest owed on a part payment", () => {
    expect(refund(365, 30000, rules)).toEqual({
      refundCents: 0,
      retainedCents: 30000,
      stillOwedCents: 70000,
      appliedTier: null,
    });
  });
});

describe("repeating the calculation", () => {
  it.each([
    ["paid in full", 14, TOTAL],
    ["overpaid", 14, 70000],
    ["full refund tier", 30, 30000],
  ])("refunds nothing the second time: %s", (_, days, paid) => {
    const first = refund(days, paid);
    expect(first.refundCents).toBeGreaterThan(0);

    const second = refund(days, paid - first.refundCents);
    expect(second).toMatchObject({
      refundCents: 0,
      retainedCents: first.retainedCents,
      stillOwedCents: 0,
    });
  });

  it("does not change what is owed when nothing was refunded", () => {
    expect(refund(14, 30000)).toEqual(refund(14, 30000));
  });
});

describe("amounts", () => {
  it("rounds the refundable share half up, in the guest's favour", () => {
    // 50% of 10.05 is 5.03 refundable, so the charge is 5.02.
    expect(refund(14, 1005, RULES, CHECK_IN, 1005)).toMatchObject({
      refundCents: 503,
      retainedCents: 502,
    });
  });

  it("honours a fractional percentage", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: 33.33 }],
    };
    expect(refund(5, TOTAL, rules).refundCents).toBe(33330);
  });

  it("never refunds more than was paid, even with a corrupt tier", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: 150 }],
    };
    expect(refund(5, 30000, rules)).toMatchObject({
      refundCents: 30000,
      retainedCents: 0,
      stillOwedCents: 0,
    });
  });

  it("never goes negative with a corrupt tier", () => {
    const rules = {
      ...RULES,
      tiers: [{ daysBefore: 0, refundPercent: -20 }],
    };
    expect(refund(5, TOTAL, rules).refundCents).toBe(0);
  });

  it("handles a free booking", () => {
    expect(refund(30, 0, RULES, CHECK_IN, 0)).toMatchObject({
      refundCents: 0,
      retainedCents: 0,
      stillOwedCents: 0,
    });
  });

  it("refuses a fractional or negative amount", () => {
    expect(() => refund(30, 10.5)).toThrow(RangeError);
    expect(() => refund(30, -1)).toThrow(RangeError);
    expect(() => refund(30, 100, RULES, CHECK_IN, 10.5)).toThrow(RangeError);
    expect(() => refund(30, 100, RULES, CHECK_IN, -1)).toThrow(RangeError);
  });
});

describe("dates", () => {
  it("counts across a leap day", () => {
    const tierFor = (checkIn: string, cancelledOn: string) =>
      calculateRefund({
        rules: RULES,
        checkIn,
        cancelledOn,
        totalCents: 1000,
        paidCents: 1000,
      }).appliedTier;
    expect(tierFor("2028-03-01", "2028-01-31")).toEqual(TIER_30);
    expect(tierFor("2027-03-01", "2027-01-31")).toEqual(TIER_14);
  });

  it("counts across a year boundary", () => {
    expect(refund(30, 1000, RULES, "2028-01-10", 1000).appliedTier).toEqual(
      TIER_30,
    );
    expect(refund(29, 1000, RULES, "2028-01-10", 1000).appliedTier).toEqual(
      TIER_14,
    );
  });

  it.each(["2027-04-15", "2027-11-15"])(
    "keeps the boundary exact when DST falls inside the window before %s",
    (checkIn) => {
      expect(refund(30, 1000, RULES, checkIn, 1000).appliedTier).toEqual(
        TIER_30,
      );
      expect(refund(29, 1000, RULES, checkIn, 1000).appliedTier).toEqual(
        TIER_14,
      );
    },
  );

  it("takes the day from Athens: a cancel after local midnight loses the tier", () => {
    // 30 days before 15 July is 15 June. 20:59:59 UTC is still 15 June locally.
    const on = (iso: string) =>
      calculateRefund({
        rules: RULES,
        checkIn: CHECK_IN,
        cancelledOn: athensDate(new Date(iso)),
        totalCents: 1000,
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
        totalCents: 1000,
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
        totalCents: 2000,
        paidCents: 2000,
      }).refundCents,
    ).toBe(2000);
  });
});
