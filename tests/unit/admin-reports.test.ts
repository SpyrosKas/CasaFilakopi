import { describe, expect, it } from "vitest";
import {
  buildReport,
  monthlyReports,
  periodRange,
  yearsWithData,
  type ReportInput,
} from "@/lib/admin/reports";
import {
  stayFromBooking,
  stayFromExternal,
  type BookingInput,
  type ExternalInput,
} from "@/lib/admin/stays";
import { eachNight } from "@/lib/domain/dates";

// August 2019 for one house, worked out by hand. The same stays are written to
// the database in tests/e2e/admin-ops-fixtures.ts and read back off the page.

const RULES = {
  payment: { mode: "full" },
  cancellation: {
    isNonRefundable: false,
    tiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 10, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  },
};

const nightly = (from: string, to: string, cents: number) => ({
  nights: eachNight(from, to).map((night) => ({ night, cents })),
});

function booking(fields: Partial<BookingInput>): BookingInput {
  return {
    id: "x",
    reference: null,
    status: "completed",
    source: "direct",
    check_in: "2019-01-01",
    check_out: "2019-01-02",
    adults: 2,
    children: 0,
    guest_id: "g",
    guest_name: "Guest",
    guest_email: null,
    guest_phone: null,
    guest_country: null,
    locale: "en",
    special_requests: null,
    total_cents: 0,
    price_breakdown: { nights: [] },
    rules_snapshot: RULES,
    created_at: "2019-01-01T10:00:00Z",
    confirmed_at: "2019-01-01T10:00:00Z",
    cancelled_at: null,
    ...fields,
  };
}

function external(fields: Partial<ExternalInput>): ExternalInput {
  return {
    id: "e",
    start_date: "2019-01-01",
    end_date: "2019-01-02",
    summary: "Reserved",
    guest_name: null,
    guest_email: null,
    guest_phone: null,
    guest_notes: null,
    amount_cents: null,
    created_at: "2019-01-01T10:00:00Z",
    channel: "airbnb",
    is_conflicted: false,
    ...fields,
  };
}

const paid = (amount_cents: number) => ({
  status: "succeeded" as const,
  amount_cents,
});

const INPUT: ReportInput = {
  today: "2026-11-07",
  stays: [
    // A: 3 nights, one of them in August. Fully paid in June.
    stayFromBooking(
      booking({
        id: "a",
        check_in: "2019-07-30",
        check_out: "2019-08-02",
        total_cents: 60000,
        price_breakdown: nightly("2019-07-30", "2019-08-02", 15000),
        confirmed_at: "2019-05-01T10:00:00Z",
      }),
      [paid(60000), { status: "disputed", amount_cents: 5000 }],
      [],
    ),
    // B: 4 nights by hand. 400 of 1000 paid, so 600 is overdue.
    stayFromBooking(
      booking({
        id: "b",
        source: "manual",
        check_in: "2019-08-10",
        check_out: "2019-08-14",
        total_cents: 100000,
        price_breakdown: nightly("2019-08-10", "2019-08-14", 20000),
        confirmed_at: "2019-08-01T10:00:00Z",
      }),
      [paid(40000)],
      [],
    ),
    // C: cancelled 19 days out, so 50% back. Charge 150, paid 300 less 200
    // refunded is 100. He keeps that and the 50 short is not chased (D24).
    stayFromBooking(
      booking({
        id: "c",
        status: "cancelled",
        check_in: "2019-08-20",
        check_out: "2019-08-23",
        total_cents: 30000,
        price_breakdown: nightly("2019-08-20", "2019-08-23", 10000),
        confirmed_at: "2019-06-30T10:00:00Z",
        cancelled_at: "2019-08-01T10:00:00Z",
      }),
      [paid(30000)],
      [{ status: "succeeded", amount_cents: 20000 }],
    ),
    // D: never arrived, so no nights count.
    stayFromBooking(
      booking({
        id: "d",
        status: "no_show",
        check_in: "2019-08-25",
        check_out: "2019-08-27",
        total_cents: 20000,
        price_breakdown: nightly("2019-08-25", "2019-08-27", 10000),
        confirmed_at: "2019-08-02T10:00:00Z",
      }),
      [],
      [],
    ),
    // E: Airbnb, 3 nights, 500 typed in.
    stayFromExternal(
      external({
        id: "e",
        start_date: "2019-08-02",
        end_date: "2019-08-05",
        amount_cents: 50000,
        created_at: "2019-07-20T10:00:00Z",
      }),
    ),
    // F: Booking.com, 2 nights, no amount yet.
    stayFromExternal(
      external({
        id: "f",
        channel: "booking_com",
        start_date: "2019-08-06",
        end_date: "2019-08-08",
        created_at: "2019-08-03T10:00:00Z",
      }),
    ),
  ],
  payments: [
    {
      bookingId: "a",
      amountCents: 60000,
      status: "succeeded",
      at: "2019-06-01T10:00:00Z",
    },
    {
      bookingId: "a",
      amountCents: 5000,
      status: "disputed",
      at: "2019-08-02T10:00:00Z",
    },
    {
      bookingId: "b",
      amountCents: 40000,
      status: "succeeded",
      at: "2019-08-10T10:00:00Z",
    },
    {
      bookingId: "c",
      amountCents: 30000,
      status: "succeeded",
      at: "2019-07-01T10:00:00Z",
    },
    // Failed money never arrived.
    {
      bookingId: "b",
      amountCents: 999,
      status: "failed",
      at: "2019-08-10T10:00:00Z",
    },
  ],
  refunds: [
    {
      bookingId: "c",
      amountCents: 20000,
      status: "succeeded",
      at: "2019-08-01T10:00:00Z",
    },
    // Not gone yet, or never left.
    {
      bookingId: "c",
      amountCents: 111,
      status: "pending",
      at: "2019-08-01T10:00:00Z",
    },
    {
      bookingId: "c",
      amountCents: 222,
      status: "failed",
      at: "2019-08-01T10:00:00Z",
    },
  ],
  blocks: [{ start: "2019-08-28", end: "2019-08-30" }],
};

describe("August 2019, worked by hand", () => {
  const august = buildReport(INPUT, { year: 2019, month: 8 });

  it("keeps received, entered and booked apart", () => {
    expect(august.money).toEqual({
      paymentsCents: 40000,
      refundsCents: 20000,
      receivedCents: 20000,
      enteredCents: 50000,
      incomeCents: 70000,
      disputedCents: 5000,
      bookedCents: 100000,
      expectedCents: 0,
      owedCents: 60000,
      toRefundCents: 0,
    });
  });

  it("counts bookings", () => {
    expect(august.bookings).toEqual({
      made: 3,
      had: 3,
      expected: 0,
      cancelled: 1,
      noShows: 1,
    });
  });

  it("counts nights, and leaves closed nights out of what could be sold", () => {
    expect(august.nights).toEqual({
      booked: 10,
      available: 29,
      occupancyTenths: 345,
      averageNightCents: 19000,
      pricedNights: 5,
      averageStayTenths: 30,
    });
  });

  it("splits by source", () => {
    expect(august.bySource).toEqual([
      {
        source: "airbnb",
        bookings: 1,
        nights: 3,
        bookedCents: null,
        receivedCents: 0,
        enteredCents: 50000,
        noAmount: 0,
      },
      {
        source: "booking_com",
        bookings: 1,
        nights: 2,
        bookedCents: null,
        receivedCents: 0,
        enteredCents: 0,
        noAmount: 1,
      },
      {
        source: "direct",
        bookings: 0,
        nights: 1,
        bookedCents: null,
        receivedCents: -20000,
        enteredCents: 0,
        noAmount: 0,
      },
      {
        source: "manual",
        bookings: 1,
        nights: 4,
        bookedCents: 100000,
        receivedCents: 40000,
        enteredCents: 0,
        noAmount: 0,
      },
    ]);
  });

  it("says how many stays have no amount", () => {
    expect(august.noAmount).toEqual({ stays: 1, nights: 2, tab: "past" });
  });
});

describe("source cards", () => {
  it("add up to the income figures", () => {
    for (const period of [
      { year: 2019, month: 8 },
      { year: 2019, month: null },
    ]) {
      const report = buildReport(INPUT, period);
      const sum = (pick: (line: (typeof report.bySource)[number]) => number) =>
        report.bySource.reduce((total, line) => total + pick(line), 0);
      expect(sum((line) => line.receivedCents)).toBe(
        report.money.receivedCents,
      );
      expect(sum((line) => line.enteredCents)).toBe(report.money.enteredCents);
    }
  });
});

describe("the whole of 2019", () => {
  const year = buildReport(INPUT, { year: 2019, month: null });

  it("adds up", () => {
    expect(year.money.paymentsCents).toBe(130000);
    expect(year.money.receivedCents).toBe(110000);
    expect(year.money.incomeCents).toBe(160000);
    expect(year.bookings.made).toBe(6);
  });

  it("agrees with its twelve months", () => {
    const months = monthlyReports(INPUT, 2019);
    expect(
      months.reduce((sum, row) => sum + row.report.money.incomeCents, 0),
    ).toBe(year.money.incomeCents);
    expect(months.reduce((sum, row) => sum + row.report.nights.booked, 0)).toBe(
      year.nights.booked,
    );
  });
});

describe("what is still to come", () => {
  it("counts an upcoming stay as expected and its balance as still to come", () => {
    const stay = stayFromBooking(
      booking({
        id: "u",
        status: "confirmed",
        check_in: "2030-05-01",
        check_out: "2030-05-03",
        total_cents: 80000,
      }),
      [paid(20000)],
      [],
    );
    const imported = stayFromExternal(
      external({ id: "i", start_date: "2030-05-10", end_date: "2030-05-12" }),
    );
    const report = buildReport(
      {
        stays: [stay, imported],
        payments: [],
        refunds: [],
        blocks: [],
        today: "2026-11-07",
      },
      { year: 2030, month: 5 },
    );
    expect(report.money.expectedCents).toBe(60000);
    expect(report.money.owedCents).toBe(0);
    expect(report.bookings.expected).toBe(2);
    expect(report.bookings.had).toBe(0);
  });
});

describe("a goodwill refund (O1)", () => {
  const stay = stayFromBooking(
    booking({
      id: "g",
      status: "confirmed",
      check_in: "2030-05-01",
      check_out: "2030-05-03",
      total_cents: 50000,
    }),
    [paid(50000)],
    [{ status: "succeeded", amount_cents: 5000 }],
  );

  it("creates no debt", () => {
    expect(stay.balanceCents).toBe(0);
    expect(stay.moneyState).toBe("paid");
  });

  it("stays visible and reduces income", () => {
    expect(stay.money.refundedCents).toBe(5000);
    const report = buildReport(
      {
        stays: [stay],
        payments: [
          {
            bookingId: "g",
            amountCents: 50000,
            status: "succeeded",
            at: "2030-04-01T10:00:00Z",
          },
        ],
        refunds: [
          {
            bookingId: "g",
            amountCents: 5000,
            status: "succeeded",
            at: "2030-04-02T10:00:00Z",
          },
        ],
        blocks: [],
        today: "2026-11-07",
      },
      { year: 2030, month: 4 },
    );
    expect(report.money.incomeCents).toBe(45000);
    expect(report.money.owedCents).toBe(0);
  });
});

describe("a dispute (D8)", () => {
  it("does not ask for the disputed money twice", () => {
    const stay = stayFromBooking(
      booking({ status: "confirmed", total_cents: 50000 }),
      [paid(30000), { status: "disputed", amount_cents: 20000 }],
      [],
    );
    expect(stay.balanceCents).toBe(0);
  });
});

describe("average price per night (O3)", () => {
  it("is what the guest paid for the house, after a promo", () => {
    // 4 nights at 100 and 40 cleaning, less 10%: 44 off the 440.
    const stay = stayFromBooking(
      booking({
        id: "p",
        status: "completed",
        check_in: "2019-03-01",
        check_out: "2019-03-05",
        total_cents: 39600,
        price_breakdown: {
          ...nightly("2019-03-01", "2019-03-05", 10000),
          lines: [
            { kind: "accommodation", totalCents: 40000 },
            { kind: "cleaning", totalCents: 4000 },
            { kind: "discount", totalCents: -4400 },
          ],
        },
      }),
      [],
      [],
    );
    expect(stay.pricedNights.map((row) => row.cents)).toEqual([
      9000, 9000, 9000, 9000,
    ]);
    const report = buildReport(
      {
        stays: [stay],
        payments: [],
        refunds: [],
        blocks: [],
        today: "2026-11-07",
      },
      { year: 2019, month: 3 },
    );
    expect(report.nights.averageNightCents).toBe(9000);
  });

  it("keeps the nights adding up when the discount does not divide evenly", () => {
    const stay = stayFromBooking(
      booking({
        id: "q",
        check_in: "2019-03-01",
        check_out: "2019-03-04",
        total_cents: 29999,
        price_breakdown: {
          ...nightly("2019-03-01", "2019-03-04", 10000),
          lines: [
            { kind: "accommodation", totalCents: 30000 },
            { kind: "discount", totalCents: -1 },
          ],
        },
      }),
      [],
      [],
    );
    expect(stay.pricedNights.reduce((total, row) => total + row.cents, 0)).toBe(
      29999,
    );
  });
});

describe("the year menu", () => {
  it("has a year with nothing but a refund", () => {
    expect(
      yearsWithData(
        {
          stays: [],
          payments: [],
          refunds: [
            {
              bookingId: "x",
              amountCents: 100,
              status: "succeeded",
              at: "2025-03-01T10:00:00Z",
            },
          ],
          blocks: [],
          today: "2026-11-07",
        },
        2026,
      ),
    ).toEqual([2026, 2025]);
  });
});

describe("dates", () => {
  it("uses the Athens date of a payment, not UTC", () => {
    // 22:30 UTC on 31 July is 01:30 on 1 August on Milos.
    const report = buildReport(
      {
        stays: [],
        payments: [
          {
            bookingId: "x",
            amountCents: 100,
            status: "succeeded",
            at: "2019-07-31T22:30:00Z",
          },
        ],
        refunds: [],
        blocks: [],
        today: "2026-11-07",
      },
      { year: 2019, month: 8 },
    );
    expect(report.money.receivedCents).toBe(100);
  });

  it("runs December into January", () => {
    expect(periodRange({ year: 2026, month: 12 })).toEqual({
      from: "2026-12-01",
      to: "2027-01-01",
    });
  });
});
