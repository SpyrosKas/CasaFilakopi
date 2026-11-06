import { describe, expect, it } from "vitest";
import {
  cancellationRulesSchema,
  centsToEuros,
  describeRules,
  eurosToCents,
  paymentRulesSchema,
  rulesSchema,
} from "@/lib/admin/rules";
import type { CancellationRules, PaymentRules } from "@/lib/domain/contracts";

const tiers = (...pairs: [number, number][]) => ({
  isNonRefundable: false,
  tiers: pairs.map(([daysBefore, refundPercent]) => ({
    daysBefore,
    refundPercent,
  })),
});

const firstMessage = (input: unknown) =>
  cancellationRulesSchema.safeParse(input).error?.issues[0]?.message;

describe("payment rules", () => {
  it("accepts the values in supabase/seed.sql unchanged", () => {
    const seed = {
      mode: "deposit",
      deposit: { kind: "percent", percent: 30 },
      balanceDaysBefore: 14,
    };
    expect(paymentRulesSchema.parse(seed)).toEqual(seed);
  });

  it("accepts a fixed deposit", () => {
    const rules = {
      mode: "deposit",
      deposit: { kind: "fixed", amountCents: 15000 },
      balanceDaysBefore: 7,
    };
    expect(paymentRulesSchema.parse(rules)).toEqual(rules);
  });

  it.each([
    ["no deposit in deposit mode", { mode: "deposit", deposit: null }],
    [
      "a deposit with full payment",
      { mode: "full", deposit: { kind: "percent", percent: 30 } },
    ],
    [
      "a 100 percent deposit",
      { mode: "deposit", deposit: { kind: "percent", percent: 100 } },
    ],
    [
      "a 0 percent deposit",
      { mode: "deposit", deposit: { kind: "percent", percent: 0 } },
    ],
    [
      "a part-cent amount",
      { mode: "deposit", deposit: { kind: "fixed", amountCents: 10.5 } },
    ],
    ["an unknown mode", { mode: "later", deposit: null }],
  ])("rejects %s", (_name, rules) => {
    const input = { balanceDaysBefore: 14, ...rules };
    expect(paymentRulesSchema.safeParse(input).success).toBe(false);
  });

  it("rejects negative or fractional balance days", () => {
    for (const balanceDaysBefore of [-1, 1.5, 366]) {
      const input = { mode: "full", deposit: null, balanceDaysBefore };
      expect(paymentRulesSchema.safeParse(input).success).toBe(false);
    }
  });

  it("rejects fields the contract does not have", () => {
    const input = {
      mode: "full",
      deposit: null,
      balanceDaysBefore: 1,
      role: "owner",
    };
    expect(paymentRulesSchema.safeParse(input).success).toBe(false);
  });
});

describe("cancellation rules", () => {
  it("accepts the seed tiers and keeps them in stored order", () => {
    const seed = tiers([30, 100], [0, 0]);
    expect(cancellationRulesSchema.parse(seed)).toEqual(seed);
  });

  it("sorts tiers typed in any order", () => {
    const parsed = cancellationRulesSchema.parse(
      tiers([0, 0], [30, 100], [7, 50]),
    );
    expect(parsed.tiers.map((tier) => tier.daysBefore)).toEqual([30, 7, 0]);
  });

  it("accepts non-refundable with no tiers", () => {
    const rules = { isNonRefundable: true, tiers: [] };
    expect(cancellationRulesSchema.parse(rules)).toEqual(rules);
  });

  it("rejects a refund that grows closer to arrival", () => {
    expect(firstMessage(tiers([30, 50], [7, 80], [0, 0]))).toMatch(
      /closer to arrival/,
    );
  });

  it("rejects two tiers paying the same refund", () => {
    expect(firstMessage(tiers([30, 50], [7, 50], [0, 0]))).toMatch(
      /closer to arrival/,
    );
  });

  it("rejects two tiers for the same day", () => {
    expect(firstMessage(tiers([30, 100], [30, 50], [0, 0]))).toMatch(
      /same number of days/,
    );
  });

  it("rejects tiers that leave late cancellations uncovered", () => {
    expect(firstMessage(tiers([30, 100], [7, 50]))).toMatch(/0 days/);
  });

  it("rejects no tiers unless non-refundable", () => {
    expect(firstMessage(tiers())).toMatch(/at least one line/);
  });

  it("rejects tiers on a non-refundable rule", () => {
    expect(firstMessage({ ...tiers([0, 0]), isNonRefundable: true })).toMatch(
      /Remove the refund lines/,
    );
  });

  it("rejects out-of-range numbers", () => {
    expect(firstMessage(tiers([-1, 0]))).toMatch(/0 to 365/);
    expect(firstMessage(tiers([0, 101]))).toMatch(/0 to 100/);
    expect(firstMessage(tiers([0, 12.5]))).toMatch(/0 to 100/);
  });

  it("rejects more than ten lines", () => {
    const many = Array.from({ length: 11 }, (_, i): [number, number] => [
      (10 - i) * 10,
      100 - i,
    ]);
    expect(firstMessage(tiers(...many))).toMatch(/10 lines/);
  });
});

describe("rules as a whole", () => {
  it("rejects anything but the two known sections", () => {
    const input = {
      payment: { mode: "full", deposit: null, balanceDaysBefore: 0 },
      cancellation: tiers([0, 0]),
      capturedAt: "2026-01-01",
    };
    expect(rulesSchema.safeParse(input).success).toBe(false);
  });
});

describe("euro amounts", () => {
  it.each([
    ["150", 15000],
    ["150.5", 15050],
    ["150,50", 15050],
    ["0.07", 7],
    ["19.99", 1999],
  ])("reads %s without rounding errors", (input, cents) => {
    expect(eurosToCents(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-5", "1e3"])("refuses %s", (input) => {
    expect(eurosToCents(input)).toBeNull();
  });

  it("writes amounts back", () => {
    expect(centsToEuros(15000)).toBe("150");
    expect(centsToEuros(15050)).toBe("150.50");
    expect(centsToEuros(7)).toBe("0.07");
  });
});

describe("guest preview", () => {
  const full: PaymentRules = {
    mode: "full",
    deposit: null,
    balanceDaysBefore: 14,
  };
  const noRefund: CancellationRules = { isNonRefundable: true, tiers: [] };

  it("explains a percentage deposit and when the rest is due", () => {
    const { payment } = describeRules(
      {
        mode: "deposit",
        deposit: { kind: "percent", percent: 30 },
        balanceDaysBefore: 14,
      },
      noRefund,
    );
    expect(payment).toEqual([
      "You pay 30% of the price when you book.",
      "The rest is due 14 days before you arrive.",
    ]);
  });

  it("explains a fixed deposit due on the day", () => {
    const { payment } = describeRules(
      {
        mode: "deposit",
        deposit: { kind: "fixed", amountCents: 15050 },
        balanceDaysBefore: 0,
      },
      noRefund,
    );
    expect(payment).toEqual([
      "You pay €150.50 when you book.",
      "The rest is due on the day you arrive.",
    ]);
  });

  it("explains full payment and paying on arrival", () => {
    expect(describeRules(full, noRefund).payment).toEqual([
      "You pay the full price when you book.",
    ]);
    expect(
      describeRules({ ...full, mode: "on_arrival" }, noRefund).payment,
    ).toEqual(["You pay nothing now. You pay when you arrive."]);
  });

  it("explains each tier as a range of days", () => {
    const { cancellation } = describeRules(
      full,
      tiers([30, 100], [7, 50], [0, 0]),
    );
    expect(cancellation).toEqual([
      "If you cancel 30 days or more before you arrive, you get all your money back.",
      "If you cancel 7 to 29 days before you arrive, you get 50% of your money back.",
      "If you cancel less than 7 days before you arrive, you get nothing back.",
    ]);
  });

  it("explains a single day and a single rule", () => {
    expect(
      describeRules(full, tiers([2, 100], [1, 50], [0, 0])).cancellation[1],
    ).toBe(
      "If you cancel 1 day before you arrive, you get 50% of your money back.",
    );
    expect(describeRules(full, tiers([0, 100])).cancellation).toEqual([
      "If you cancel at any time, you get all your money back.",
    ]);
  });

  it("explains a non-refundable rule", () => {
    expect(describeRules(full, noRefund).cancellation).toEqual([
      "If you cancel, you get no refund.",
    ]);
  });
});
