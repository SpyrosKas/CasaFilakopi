import { describe, expect, it } from "vitest";
import {
  DEFAULT_RULES,
  describeRules,
  formatEuros,
  rulesSchema,
} from "@/lib/admin/rules";
import type { CancellationRules, PaymentRules } from "@/lib/domain/contracts";
import { calculateRefund } from "@/lib/domain/refund";
import {
  parseCancellationTiers,
  parsePaymentRules,
} from "@/lib/domain/settings";

const FULL = { mode: "full", deposit: null, balanceDaysBefore: 0 };
const DEPOSIT = {
  mode: "deposit",
  deposit: { kind: "percent", percent: 30 },
  balanceDaysBefore: 14,
};

const tiers = (...pairs: [number, number][]) => ({
  isNonRefundable: false,
  tiers: pairs.map(([daysBefore, refundPercent]) => ({
    daysBefore,
    refundPercent,
  })),
});
const SEED_TIERS = tiers([30, 100], [0, 0]);

const issue = (payment: unknown, cancellation: unknown = SEED_TIERS) =>
  rulesSchema.safeParse({ payment, cancellation }).error?.issues[0];

describe("what can be saved", () => {
  it("saves full payment in the agreed shape", () => {
    const rules = { payment: FULL, cancellation: SEED_TIERS };
    expect(rulesSchema.parse(rules)).toEqual(rules);
  });

  it("saves the seed's deposit in the agreed shape", () => {
    const rules = { payment: DEPOSIT, cancellation: SEED_TIERS };
    expect(rulesSchema.parse(rules)).toEqual(rules);
  });

  it("keeps 0 days, meaning the rest is paid on arrival", () => {
    const payment = { ...DEPOSIT, balanceDaysBefore: 0 };
    expect(
      rulesSchema.parse({ payment, cancellation: SEED_TIERS }).payment
        .balanceDaysBefore,
    ).toBe(0);
  });

  it.each([1, 12.5, 33.33, 99.99])("allows a %d%% deposit", (percent) => {
    const payment = { ...DEPOSIT, deposit: { kind: "percent", percent } };
    expect(issue(payment)).toBeUndefined();
  });

  it("starts on full payment, as the domain does", () => {
    expect(DEFAULT_RULES.payment.mode).toBe("full");
    expect(DEFAULT_RULES.payment.deposit).toBeNull();
  });

  it("everything it accepts, the domain accepts too", () => {
    const { payment, cancellation } = rulesSchema.parse({
      payment: DEPOSIT,
      cancellation: tiers([0, 0], [30, 100], [14, 50]),
    });
    expect(parsePaymentRules(payment)).toEqual(payment);
    expect(parseCancellationTiers(cancellation.tiers)).toEqual(
      cancellation.tiers,
    );
  });
});

describe("refused payment rules", () => {
  it("refuses Deposit with no percentage, which would stop checkout", () => {
    const refused = issue({ ...DEPOSIT, deposit: null });
    expect(refused?.message).toBe("Please type the deposit percentage.");
    expect(refused?.path).toEqual(["payment", "deposit"]);
  });

  it.each([
    ["0 percent", { kind: "percent", percent: 0 }],
    ["under 1 percent", { kind: "percent", percent: 0.99 }],
    ["100 percent", { kind: "percent", percent: 100 }],
    ["120 percent", { kind: "percent", percent: 120 }],
    ["a negative percent", { kind: "percent", percent: -1 }],
    ["three decimals", { kind: "percent", percent: 12.345 }],
  ])("refuses a deposit of %s", (_name, deposit) => {
    expect(issue({ ...DEPOSIT, deposit })?.message).toMatch(/at most 2 dec/);
  });

  it("refuses a fixed deposit, even though the domain could read one", () => {
    const deposit = { kind: "fixed", amountCents: 20000 };
    expect(parsePaymentRules({ ...DEPOSIT, deposit }).deposit).toEqual(deposit);
    expect(issue({ ...DEPOSIT, deposit })).toBeDefined();
  });

  it("refuses the removed on_arrival mode", () => {
    expect(issue({ ...FULL, mode: "on_arrival" })?.message).toBe(
      "Please choose how guests pay.",
    );
  });

  it("refuses a deposit left on full payment", () => {
    expect(issue({ ...FULL, deposit: DEPOSIT.deposit })?.message).toMatch(
      /only be set/,
    );
  });

  it.each([-1, 1.5, 366])("refuses %d balance days", (balanceDaysBefore) => {
    expect(issue({ ...DEPOSIT, balanceDaysBefore })?.message).toMatch(
      /from 0 to 365/,
    );
  });

  it("allows the longest balance period", () => {
    expect(issue({ ...DEPOSIT, balanceDaysBefore: 365 })).toBeUndefined();
  });

  it("refuses fields the contract does not have", () => {
    expect(issue({ ...FULL, role: "owner" })).toBeDefined();
    expect(
      rulesSchema.safeParse({
        payment: FULL,
        cancellation: SEED_TIERS,
        capturedAt: "2026-01-01",
      }).success,
    ).toBe(false);
  });
});

describe("refused cancellation rules", () => {
  const tierIssue = (cancellation: unknown) => issue(FULL, cancellation);

  it("refuses a bigger refund closer to arrival, in any order", () => {
    expect(tierIssue(tiers([30, 50], [7, 80], [0, 0]))?.message).toMatch(
      /closer to arrival/,
    );
    expect(tierIssue(tiers([7, 80], [0, 0], [30, 50]))?.message).toMatch(
      /closer to arrival/,
    );
  });

  it("refuses two lines for the same day", () => {
    expect(tierIssue(tiers([30, 100], [30, 50], [0, 0]))?.message).toMatch(
      /same number of days/,
    );
  });

  it("refuses more than two decimals, and out-of-range numbers", () => {
    expect(tierIssue(tiers([0, 12.345]))?.message).toMatch(/2 decimals/);
    expect(tierIssue(tiers([0, 101]))?.message).toMatch(/0 to 100/);
    expect(tierIssue(tiers([-1, 0]))?.message).toMatch(/from 0 to 3650/);
    expect(tierIssue(tiers([1.5, 0]))?.message).toMatch(/from 0 to 3650/);
    expect(tierIssue(tiers([3651, 0]))?.message).toMatch(/from 0 to 3650/);
    expect(tierIssue(tiers([3650, 0]))).toBeUndefined();
  });

  it("refuses no lines unless non-refundable", () => {
    expect(tierIssue(tiers())?.message).toMatch(/at least one line/);
  });

  it("refuses lines on a non-refundable rule", () => {
    expect(
      tierIssue({ ...tiers([0, 0]), isNonRefundable: true })?.message,
    ).toMatch(/Remove the refund lines/);
  });

  it("refuses more than ten lines", () => {
    const many = Array.from({ length: 11 }, (_, i): [number, number] => [
      (10 - i) * 10,
      100 - i,
    ]);
    expect(tierIssue(tiers(...many))?.message).toMatch(/10 lines/);
  });
});

describe("what the domain allows, the screen allows", () => {
  it("sorts lines typed in any order, longest notice first", () => {
    const { cancellation } = rulesSchema.parse({
      payment: FULL,
      cancellation: tiers([0, 0], [30, 100], [7, 50]),
    });
    expect(cancellation.tiers.map((tier) => tier.daysBefore)).toEqual([
      30, 7, 0,
    ]);
  });

  it("allows equal percentages and two decimals", () => {
    expect(issue(FULL, tiers([30, 50], [7, 50], [0, 33.33]))).toBeUndefined();
  });

  it("allows no line for 0 days: late cancellations get nothing", () => {
    expect(issue(FULL, tiers([30, 100]))).toBeUndefined();
  });
});

describe("non-refundable rules work with calculateRefund", () => {
  // Parsed exactly as saved, so this is the stored shape.
  const { cancellation: rules } = rulesSchema.parse({
    payment: FULL,
    cancellation: { isNonRefundable: true, tiers: [] },
  });
  const base = {
    rules,
    checkIn: "2027-07-20",
    cancelledOn: "2027-01-01",
    totalCents: 100_000,
  };

  it("stores true with no tiers, which the domain can read back", () => {
    expect(rules).toEqual({ isNonRefundable: true, tiers: [] });
    expect(parseCancellationTiers(rules.tiers)).toEqual([]);
  });

  it("keeps a full payment", () => {
    expect(calculateRefund({ ...base, paidCents: 100_000 })).toEqual({
      refundCents: 0,
      retainedCents: 100_000,
      stillOwedCents: 0,
      appliedTier: null,
    });
  });

  it("keeps a deposit and leaves the rest owed", () => {
    expect(calculateRefund({ ...base, paidCents: 30_000 })).toEqual({
      refundCents: 0,
      retainedCents: 30_000,
      stillOwedCents: 70_000,
      appliedTier: null,
    });
  });
});

describe("euro amounts", () => {
  it("writes whole and part euros", () => {
    expect(formatEuros(100_000)).toBe("€1,000");
    expect(formatEuros(33_330)).toBe("€333.30");
    expect(formatEuros(7)).toBe("€0.07");
  });
});

describe("guest preview", () => {
  const full: PaymentRules = {
    mode: "full",
    deposit: null,
    balanceDaysBefore: 0,
  };
  const deposit = (
    percent: number,
    balanceDaysBefore: number,
  ): PaymentRules => ({
    mode: "deposit",
    deposit: { kind: "percent", percent },
    balanceDaysBefore,
  });
  const noRefund: CancellationRules = { isNonRefundable: true, tiers: [] };
  const threeTiers = tiers([30, 100], [7, 50], [0, 0]);

  it("explains full payment", () => {
    expect(describeRules(full, noRefund).payment).toEqual([
      "You pay the full price when you book.",
    ]);
  });

  it("explains a deposit, when the rest is due, and booking late", () => {
    expect(describeRules(deposit(30, 14), noRefund).payment).toEqual([
      "You pay 30% of the booking price when you book.",
      "You pay the rest 14 days before you arrive.",
      "If you book later than that, you pay the full price when you book.",
    ]);
  });

  it("explains 0 days as paying on arrival", () => {
    expect(describeRules(deposit(30, 0), noRefund).payment).toEqual([
      "You pay 30% of the booking price when you book.",
      "You pay the rest when you arrive.",
    ]);
  });

  it("states refunds as a share of the booking price", () => {
    expect(describeRules(full, threeTiers).cancellation).toEqual([
      "If you cancel 30 days or more before you arrive, we refund the full booking price.",
      "If you cancel 7 to 29 days before you arrive, we refund 50% of the booking price.",
      "If you cancel less than 7 days before you arrive, we refund nothing.",
    ]);
  });

  it("adds the final period when there is no line for 0 days", () => {
    expect(describeRules(full, tiers([30, 100])).cancellation).toEqual([
      "If you cancel 30 days or more before you arrive, we refund the full booking price.",
      "If you cancel less than 30 days before you arrive, we refund nothing.",
    ]);
  });

  it("explains a single day and a single line", () => {
    expect(
      describeRules(full, tiers([2, 100], [1, 50], [0, 0])).cancellation[1],
    ).toBe(
      "If you cancel 1 day before you arrive, we refund 50% of the booking price.",
    );
    expect(describeRules(full, tiers([0, 100])).cancellation).toEqual([
      "If you cancel any time before you arrive, we refund the full booking price.",
    ]);
  });

  it("explains a non-refundable rule", () => {
    expect(describeRules(full, noRefund).cancellation).toEqual([
      "If you cancel any time before you arrive, we refund nothing.",
    ]);
  });

  it("gives a worked example for a guest who has paid everything", () => {
    const { example } = describeRules(full, threeTiers);
    expect(example.heading).toBe("Example: a booking of €1,000");
    expect(example.paidInFull).toEqual({
      heading: "If you have paid everything (€1,000)",
      lines: [
        "30 days or more before you arrive: you get €1,000 back.",
        "7 to 29 days before you arrive: you get €500 back and we keep €500.",
        "Less than 7 days before you arrive: we keep the €1,000.",
      ],
    });
    expect(example.depositOnly).toBeNull();
  });

  it("shows a deposit-only guest losing the deposit and still owing", () => {
    expect(
      describeRules(deposit(30, 14), threeTiers).example.depositOnly,
    ).toEqual({
      heading: "If you have paid only the deposit (€300)",
      lines: [
        "30 days or more before you arrive: you get €300 back.",
        "7 to 29 days before you arrive: we keep the €300 and you still owe €200.",
        "Less than 7 days before you arrive: we keep the €300 and you still owe €700.",
      ],
    });
  });

  it("shows part of a deposit coming back when the charge is smaller", () => {
    const { example } = describeRules(deposit(30, 14), tiers([7, 80], [0, 0]));
    expect(example.depositOnly?.lines[0]).toBe(
      "7 days or more before you arrive: you get €100 back and we keep €200.",
    );
  });

  it("uses exact cents for a deposit like 33.33%", () => {
    const { example } = describeRules(deposit(33.33, 14), noRefund);
    expect(example.depositOnly?.lines).toEqual([
      "Any time before you arrive: we keep the €333.30 and you still owe €666.70.",
    ]);
  });
});
