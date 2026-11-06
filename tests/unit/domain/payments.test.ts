import { describe, expect, it } from "vitest";
import { buildPriceBreakdown, splitPayment } from "@/lib/domain";
import type { PaymentRules } from "@/lib/domain/contracts";
import { breakdownInput, DEPOSIT_30, FULL, stay } from "./fixtures";

const CHECK_IN = "2027-07-15";
const split = (
  rules: PaymentRules,
  totalCents = 100000,
  today = "2027-06-01",
) => splitPayment({ totalCents, rules, checkIn: CHECK_IN, today });

const fixedDeposit = (amountCents: number): PaymentRules => ({
  ...DEPOSIT_30,
  deposit: { kind: "fixed", amountCents },
});

describe("full payment", () => {
  it("takes everything now", () => {
    expect(split(FULL)).toEqual({
      dueNowCents: 100000,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });
});

describe("deposit", () => {
  it("splits by percentage, with the balance due before check-in", () => {
    expect(split(DEPOSIT_30)).toEqual({
      dueNowCents: 30000,
      balanceCents: 70000,
      balanceDueOn: "2027-07-01",
    });
  });

  it("rounds the deposit half up and derives the balance", () => {
    expect(split(DEPOSIT_30, 1005)).toMatchObject({
      dueNowCents: 302,
      balanceCents: 703,
    });
    expect(split(DEPOSIT_30, 33333)).toMatchObject({
      dueNowCents: 10000,
      balanceCents: 23333,
    });
  });

  it("takes a fixed amount", () => {
    expect(split(fixedDeposit(25000))).toMatchObject({
      dueNowCents: 25000,
      balanceCents: 75000,
    });
  });

  it("caps a fixed deposit at the total, leaving no balance", () => {
    expect(split(fixedDeposit(250000))).toEqual({
      dueNowCents: 100000,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });

  it("clears the due date when a 100% deposit leaves no balance", () => {
    const rules: PaymentRules = {
      ...DEPOSIT_30,
      deposit: { kind: "percent", percent: 100 },
    };
    expect(split(rules)).toEqual({
      dueNowCents: 100000,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });

  it("keeps the split when the balance falls due tomorrow", () => {
    expect(split(DEPOSIT_30, 100000, "2027-06-30")).toMatchObject({
      dueNowCents: 30000,
      balanceDueOn: "2027-07-01",
    });
  });

  it("keeps the split when the balance falls due today", () => {
    expect(split(DEPOSIT_30, 100000, "2027-07-01")).toMatchObject({
      dueNowCents: 30000,
      balanceDueOn: "2027-07-01",
    });
  });

  it("takes everything now once the due date has passed", () => {
    expect(split(DEPOSIT_30, 100000, "2027-07-02")).toEqual({
      dueNowCents: 100000,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });

  it("does not need a deposit rule once the due date has passed", () => {
    expect(
      splitPayment({
        totalCents: 1000,
        rules: { ...DEPOSIT_30, deposit: null },
        checkIn: CHECK_IN,
        today: CHECK_IN,
      }).dueNowCents,
    ).toBe(1000);
  });

  it("fails loudly when deposit mode has no rule", () => {
    expect(() => split({ ...DEPOSIT_30, deposit: null })).toThrow(
      "Deposit mode needs a deposit rule",
    );
  });

  it("computes the due date across a leap day and a year end", () => {
    const due = (checkIn: string, balanceDaysBefore: number) =>
      splitPayment({
        totalCents: 1000,
        rules: { ...DEPOSIT_30, balanceDaysBefore },
        checkIn,
        today: "2027-06-01",
      }).balanceDueOn;
    expect(due("2028-03-01", 1)).toBe("2028-02-29");
    expect(due("2028-01-05", 14)).toBe("2027-12-22");
    expect(due("2027-11-05", 14)).toBe("2027-10-22");
  });
});

describe("on arrival", () => {
  const rules: PaymentRules = { ...FULL, mode: "on_arrival" };

  it("takes nothing now, with the balance due at check-in", () => {
    expect(split(rules)).toEqual({
      dueNowCents: 0,
      balanceCents: 100000,
      balanceDueOn: CHECK_IN,
    });
  });

  it("ignores a stored deposit rule", () => {
    expect(split({ ...DEPOSIT_30, mode: "on_arrival" }).dueNowCents).toBe(0);
  });

  it("holds on the day of arrival", () => {
    expect(split(rules, 1000, CHECK_IN).dueNowCents).toBe(0);
  });
});

describe("a free stay", () => {
  it("owes nothing in any mode", () => {
    expect(split(DEPOSIT_30, 0)).toEqual({
      dueNowCents: 0,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });
});

describe("in the breakdown", () => {
  it("uses the Athens date to decide the due date has passed", () => {
    // Balance due 2027-06-01. Late on 1 June UTC it is already 2 June in Athens.
    const input = (now: Date) =>
      breakdownInput({
        stay: stay({ checkIn: "2027-06-15", checkOut: "2027-06-17" }),
        payment: DEPOSIT_30,
        now,
      });
    const before = buildPriceBreakdown(input(new Date("2027-06-01T20:59:59Z")));
    const after = buildPriceBreakdown(input(new Date("2027-06-01T21:00:00Z")));

    expect(before.dueNowCents).toBe(8400);
    expect(before.balanceDueOn).toBe("2027-06-01");
    expect(after.dueNowCents).toBe(after.totalCents);
    expect(after.balanceDueOn).toBeNull();
  });
});
