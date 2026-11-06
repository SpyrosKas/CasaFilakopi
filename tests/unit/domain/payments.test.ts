import { describe, expect, it } from "vitest";
import { buildPriceBreakdown, paymentKindOf, splitPayment } from "@/lib/domain";
import type { PaymentRules } from "@/lib/domain/contracts";
import { breakdownInput, DEPOSIT_30, FULL, stay } from "./fixtures";

const CHECK_IN = "2027-07-15";
// With DEPOSIT_30 the balance falls due on 1 July, 14 days before.
const split = (
  rules: PaymentRules,
  totalCents = 100000,
  today = "2027-06-01",
) => splitPayment({ totalCents, rules, checkIn: CHECK_IN, today });

const fixedDeposit = (amountCents: number): PaymentRules => ({
  ...DEPOSIT_30,
  deposit: { kind: "fixed", amountCents },
});

const IN_FULL = { dueNowCents: 100000, balanceCents: 0, balanceDueOn: null };

describe("full payment", () => {
  it("takes everything now", () => {
    expect(split(FULL)).toEqual(IN_FULL);
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
    expect(split(fixedDeposit(250000))).toEqual(IN_FULL);
  });

  it("keeps the split the day before the balance falls due", () => {
    expect(split(DEPOSIT_30, 100000, "2027-06-30")).toEqual({
      dueNowCents: 30000,
      balanceCents: 70000,
      balanceDueOn: "2027-07-01",
    });
  });

  it("takes everything when booking on the due date", () => {
    expect(split(DEPOSIT_30, 100000, "2027-07-01")).toEqual(IN_FULL);
  });

  it("takes everything when booking after the due date", () => {
    expect(split(DEPOSIT_30, 100000, "2027-07-02")).toEqual(IN_FULL);
  });

  it("does not need a deposit rule once the due date has come", () => {
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

describe("a balance paid on arrival", () => {
  const onArrival: PaymentRules = { ...DEPOSIT_30, balanceDaysBefore: 0 };

  it("falls due on the check-in date", () => {
    expect(split(onArrival)).toEqual({
      dueNowCents: 30000,
      balanceCents: 70000,
      balanceDueOn: CHECK_IN,
    });
  });

  it("holds the day before arrival", () => {
    expect(split(onArrival, 100000, "2027-07-14").dueNowCents).toBe(30000);
  });

  it("does not hold for a same-day booking, which pays in full", () => {
    expect(split(onArrival, 100000, CHECK_IN)).toEqual(IN_FULL);
  });
});

describe("a free stay", () => {
  it("owes nothing", () => {
    expect(split(DEPOSIT_30, 0)).toEqual({
      dueNowCents: 0,
      balanceCents: 0,
      balanceDueOn: null,
    });
  });
});

describe("paymentKindOf", () => {
  it("is deposit only while a balance remains", () => {
    expect(paymentKindOf(split(DEPOSIT_30))).toBe("deposit");
    expect(paymentKindOf(split(FULL))).toBe("full");
  });

  it("is full in deposit mode once everything is due now", () => {
    expect(paymentKindOf(split(DEPOSIT_30, 100000, "2027-07-01"))).toBe("full");
    expect(paymentKindOf(split(fixedDeposit(250000)))).toBe("full");
  });

  it("is full for a free stay", () => {
    expect(paymentKindOf(split(DEPOSIT_30, 0))).toBe("full");
  });
});

describe("in the breakdown", () => {
  it("uses the Athens date to decide the due date has come", () => {
    // Balance due 2 June. Late on 1 June UTC it is already 2 June in Athens.
    const input = (now: Date) =>
      breakdownInput({
        stay: stay({ checkIn: "2027-06-16", checkOut: "2027-06-18" }),
        payment: DEPOSIT_30,
        now,
      });
    const before = buildPriceBreakdown(input(new Date("2027-06-01T20:59:59Z")));
    const after = buildPriceBreakdown(input(new Date("2027-06-01T21:00:00Z")));

    expect(before.dueNowCents).toBe(8400);
    expect(before.balanceDueOn).toBe("2027-06-02");
    expect(after.dueNowCents).toBe(28000);
    expect(after.balanceDueOn).toBeNull();
  });
});
