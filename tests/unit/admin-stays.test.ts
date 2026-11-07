import { describe, expect, it } from "vitest";
import {
  buildMonth,
  leadingBlanks,
  monthDates,
  shiftMonth,
} from "@/lib/admin/calendar";
import { mailHref, telHref, whatsappHref } from "@/lib/admin/contact";
import { centsToBox, formatEuro, parseEuros } from "@/lib/admin/format";
import { messageTemplates } from "@/lib/admin/message-templates";
import {
  bulkRatesSchema,
  feeSchema,
  promoSchema,
  restrictionSchema,
} from "@/lib/admin/ops-schemas";
import {
  buildGuests,
  cancellationOutcome,
  dayPlan,
  filterStays,
  moneyState,
  planRefund,
  stayFromBooking,
  stayFromExternal,
  summariseMoney,
  tabOf,
  type BookingInput,
  type Stay,
} from "@/lib/admin/stays";

const TODAY = "2027-06-15";

const BASE_BOOKING: BookingInput = {
  id: "b",
  reference: "CF-2027-00001",
  status: "confirmed",
  source: "direct",
  check_in: "2027-06-20",
  check_out: "2027-06-22",
  adults: 2,
  children: 0,
  guest_id: "g",
  guest_name: "Maria",
  guest_email: "maria@example.test",
  guest_phone: null,
  guest_country: null,
  locale: "en",
  special_requests: null,
  total_cents: 10000,
  price_breakdown: { nights: [] },
  rules_snapshot: {},
  created_at: "2027-01-01T10:00:00Z",
  confirmed_at: "2027-01-01T10:00:00Z",
  cancelled_at: null,
};

function bookingStay(fields: Partial<BookingInput>): Stay {
  return stayFromBooking(
    { ...BASE_BOOKING, id: fields.id ?? "b", ...fields },
    [],
    [],
  );
}

const importedStay = (start: string, end: string, name?: string) =>
  stayFromExternal({
    id: `e-${start}`,
    start_date: start,
    end_date: end,
    summary: "Reserved",
    guest_name: name ?? null,
    guest_email: null,
    guest_phone: null,
    guest_notes: null,
    amount_cents: null,
    created_at: "2027-01-01T10:00:00Z",
    channel: "airbnb",
    is_conflicted: false,
  });

describe("which tab a stay is in", () => {
  it.each([
    ["confirmed", "2027-06-20", "2027-06-22", "upcoming"],
    ["confirmed", TODAY, "2027-06-18", "upcoming"],
    ["confirmed", "2027-06-10", TODAY, "staying"],
    ["confirmed", "2027-06-01", "2027-06-05", "past"],
    ["checked_in", "2027-06-10", "2027-06-20", "staying"],
    ["completed", "2027-06-01", "2027-06-05", "past"],
    ["cancelled", "2027-06-20", "2027-06-22", "cancelled"],
    ["refunded", "2027-06-20", "2027-06-22", "cancelled"],
    ["no_show", "2027-06-20", "2027-06-22", "cancelled"],
    ["expired", "2027-06-20", "2027-06-22", null],
  ] as const)("%s from %s to %s is %s", (status, check_in, check_out, tab) => {
    expect(tabOf(bookingStay({ status, check_in, check_out }), TODAY)).toBe(
      tab,
    );
  });

  it("puts imports in by their dates", () => {
    expect(tabOf(importedStay("2027-06-20", "2027-06-22"), TODAY)).toBe(
      "upcoming",
    );
    expect(tabOf(importedStay("2027-06-10", "2027-06-20"), TODAY)).toBe(
      "staying",
    );
    expect(tabOf(importedStay("2027-06-01", "2027-06-05"), TODAY)).toBe("past");
  });
});

describe("the list of stays", () => {
  const filters = {
    tab: "upcoming" as const,
    search: "",
    from: null,
    to: null,
    status: null,
    source: null,
    money: null,
  };
  const stays = [
    bookingStay({ id: "maria" }),
    bookingStay({
      id: "nikos",
      guest_name: "Nikos",
      guest_email: "nikos@example.test",
      reference: "CF-2027-00002",
      source: "manual",
      check_in: "2027-07-01",
      check_out: "2027-07-03",
    }),
    importedStay("2027-08-01", "2027-08-03"),
  ];

  it("searches name, email and reference", () => {
    const ids = (search: string) =>
      filterStays(stays, { ...filters, search }, TODAY).map((row) => row.id);
    expect(ids("MARIA")).toEqual(["maria"]);
    expect(ids("nikos@")).toEqual(["nikos"]);
    expect(ids("00002")).toEqual(["nikos"]);
    expect(ids("%")).toEqual([]);
  });

  it("filters by source, including imports", () => {
    const rows = filterStays(stays, { ...filters, source: "airbnb" }, TODAY);
    expect(rows.map((row) => row.kind)).toEqual(["external"]);
  });

  it("filters by dates that overlap the stay", () => {
    const rows = filterStays(
      stays,
      { ...filters, from: "2027-07-02", to: "2027-07-10" },
      TODAY,
    );
    expect(rows.map((row) => row.id)).toEqual(["nikos"]);
  });

  it("filters by payment state", () => {
    const rows = filterStays(stays, { ...filters, money: "dates_only" }, TODAY);
    expect(rows).toHaveLength(1);
  });

  it("shows abandoned checkouts only when asked for", () => {
    const expired = bookingStay({ id: "gone", status: "expired" });
    expect(filterStays([expired], filters, TODAY)).toEqual([]);
    expect(
      filterStays([expired], { ...filters, status: "expired" }, TODAY),
    ).toHaveLength(1);
  });
});

describe("money on a booking", () => {
  it("does not count a failed refund or a failed payment", () => {
    const money = summariseMoney(
      [
        { status: "succeeded", amount_cents: 500 },
        { status: "failed", amount_cents: 900 },
      ],
      [
        { status: "failed", amount_cents: 100 },
        { status: "pending", amount_cents: 50 },
      ],
    );
    expect(money).toEqual({
      receivedCents: 500,
      refundedCents: 50,
      paidCents: 450,
      disputedCents: 0,
    });
  });

  it.each([
    [0, 0, 0, "unpaid"],
    [300, 0, 0, "part_paid"],
    [1000, 0, 0, "paid"],
    [1000, 1000, 0, "refunded"],
    [1000, 0, 50, "disputed"],
  ])("received %i refunded %i is %s", (received, refunded, disputed, state) => {
    expect(
      moneyState(
        {
          receivedCents: received,
          refundedCents: refunded,
          paidCents: received - refunded,
          disputedCents: disputed,
        },
        1000,
      ),
    ).toBe(state);
  });
});

describe("cancelling", () => {
  const snapshot = {
    cancellation: {
      isNonRefundable: false,
      tiers: [
        { daysBefore: 30, refundPercent: 100 },
        { daysBefore: 7, refundPercent: 50 },
        { daysBefore: 0, refundPercent: 0 },
      ],
    },
  };
  const outcome = (cancelledOn: string, paidCents: number) =>
    cancellationOutcome({
      snapshot,
      checkIn: "2027-07-31",
      cancelledOn,
      totalCents: 100000,
      paidCents,
    });

  it("reads the tiers saved on the booking", () => {
    expect(outcome("2027-06-30", 100000)?.refundCents).toBe(100000);
    expect(outcome("2027-07-20", 100000)?.refundCents).toBe(50000);
    expect(outcome("2027-07-30", 100000)?.refundCents).toBe(0);
  });

  it("keeps a deposit and shows no debt on the stay", () => {
    const result = outcome("2027-07-20", 20000);
    expect(result?.refundCents).toBe(0);
    expect(result?.retainedCents).toBe(20000);

    const stay = stayFromBooking(
      {
        ...BASE_BOOKING,
        status: "cancelled",
        check_in: "2027-07-31",
        check_out: "2027-08-02",
        total_cents: 100000,
        rules_snapshot: snapshot,
        cancelled_at: "2027-07-20T10:00:00Z",
      },
      [{ status: "succeeded", amount_cents: 20000 }],
      [],
    );
    expect(stay.balanceCents).toBe(0);
    expect(stay.toRefundCents).toBe(0);
    expect(stay).not.toHaveProperty("stillOwedCents");
  });

  it("refuses to guess when the saved rules cannot be read", () => {
    expect(
      cancellationOutcome({
        snapshot: { cancellation: { tiers: "nonsense" } },
        checkIn: "2027-07-31",
        cancelledOn: "2027-06-30",
        totalCents: 100,
        paidCents: 100,
      }),
    ).toBeNull();
  });

  it("takes a refund from manual payments first, and leaves the card part", () => {
    const plan = planRefund(
      70000,
      [
        {
          id: "card",
          method: "card",
          status: "succeeded",
          amount_cents: 50000,
          created_at: "2027-01-01",
        },
        {
          id: "cash",
          method: "cash",
          status: "succeeded",
          amount_cents: 50000,
          created_at: "2027-02-01",
        },
      ],
      [
        {
          payment_id: "cash",
          status: "succeeded",
          amount_cents: 10000,
        },
      ],
    );
    expect(plan).toEqual({
      manual: [{ paymentId: "cash", amountCents: 40000 }],
      cardCents: 30000,
    });
  });
});

describe("guests", () => {
  it("joins stays by email, whatever its case", () => {
    const guests = buildGuests([
      bookingStay({ id: "one", guest_email: "A@example.test" }),
      bookingStay({ id: "two", guest_email: "a@example.test", guest_id: "g2" }),
    ]);
    expect(guests).toHaveLength(1);
    expect(guests[0].stays).toHaveLength(2);
  });

  it("leaves an import out until it has details", () => {
    expect(buildGuests([importedStay("2027-06-01", "2027-06-03")])).toEqual([]);
    expect(
      buildGuests([importedStay("2027-06-01", "2027-06-03", "Eleni")])[0].name,
    ).toBe("Eleni");
  });

  it("leaves out checkouts that were never finished", () => {
    expect(
      buildGuests([
        bookingStay({ status: "expired" }),
        bookingStay({ status: "pending_payment" }),
      ]),
    ).toEqual([]);
  });
});

describe("today", () => {
  it("answers who arrives, leaves and is in the house", () => {
    const plan = dayPlan(
      [
        bookingStay({ id: "in", check_in: TODAY, check_out: "2027-06-20" }),
        bookingStay({
          id: "out",
          status: "checked_in",
          check_in: "2027-06-10",
          check_out: TODAY,
        }),
      ],
      TODAY,
    );
    expect(plan.arrivals.map((row) => row.id)).toEqual(["in"]);
    expect(plan.departures.map((row) => row.id)).toEqual(["out"]);
    expect(plan.inHouse.map((row) => row.id)).toEqual(["out"]);
  });
});

describe("the month grid", () => {
  const words = {
    reasons: { maintenance: "Repairs" },
    noName: "No name",
    hold: "Paying",
  };

  it("starts the week on Monday", () => {
    // 1 June 2027 is a Tuesday.
    expect(leadingBlanks("2027-06")).toBe(1);
    expect(monthDates("2027-02")).toHaveLength(28);
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });

  it("colours nights, not the morning a guest leaves", () => {
    const { nights } = buildMonth(
      "2027-06",
      [bookingStay({ check_in: "2027-06-03", check_out: "2027-06-05" })],
      [],
      words,
    );
    const kindOn = (day: number) => nights[day - 1].kind;
    expect([kindOn(2), kindOn(3), kindOn(4), kindOn(5)]).toEqual([
      "free",
      "direct",
      "direct",
      "free",
    ]);
  });

  it("shows sources apart and flags a clash", () => {
    const { nights } = buildMonth(
      "2027-06",
      [
        bookingStay({ check_in: "2027-06-03", check_out: "2027-06-05" }),
        importedStay("2027-06-04", "2027-06-06"),
      ],
      [
        {
          id: "b1",
          start: "2027-06-10",
          end: "2027-06-11",
          reason: "maintenance",
          note: null,
        },
      ],
      words,
    );
    expect(nights[3].isConflict).toBe(true);
    expect(nights[4].kind).toBe("airbnb");
    expect(nights[9].kind).toBe("block");
    expect(nights[9].blockId).toBe("b1");
  });

  it("leaves a cancelled stay off", () => {
    const { nights, entries } = buildMonth(
      "2027-06",
      [bookingStay({ status: "cancelled", check_in: "2027-06-03" })],
      [],
      words,
    );
    expect(entries).toEqual([]);
    expect(nights.every((night) => night.kind === "free")).toBe(true);
  });
});

describe("amounts he types", () => {
  it.each([
    ["120", 12000],
    ["120.5", 12050],
    ["120,50", 12050],
    ["0.07", 7],
    ["€ 15", 1500],
  ])("reads %s", (text, cents) => {
    expect(parseEuros(text)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "-5", "1,2,3", "1e3"])("refuses %s", (text) => {
    expect(parseEuros(text)).toBeNull();
  });

  it("writes amounts back", () => {
    expect(formatEuro(123456)).toBe("€1,234.56");
    expect(formatEuro(-5)).toBe("-€0.05");
    expect(centsToBox(1205)).toBe("12.05");
    expect(centsToBox(null)).toBe("");
  });
});

describe("contact links", () => {
  it("makes a phone number tappable", () => {
    expect(telHref("+30 693 470 7765")).toBe("tel:+306934707765");
    expect(telHref("123")).toBeNull();
    expect(telHref(null)).toBeNull();
  });

  it("only offers WhatsApp when the country is known", () => {
    expect(whatsappHref("+44 7700 900123")).toBe("https://wa.me/447700900123");
    expect(whatsappHref("0030 6934707765")).toBe("https://wa.me/306934707765");
    expect(whatsappHref("6934707765")).toBe("https://wa.me/306934707765");
    expect(whatsappHref("2287022222")).toBeNull();
  });

  it("makes a safe email link", () => {
    expect(mailHref("a.b+c@example.test")).toBe("mailto:a.b%2Bc@example.test");
    expect(mailHref("not an email")).toBeNull();
    expect(mailHref("a@b.test?bcc=x")).toBe("mailto:a@b.test%3Fbcc%3Dx");
    expect(mailHref("a@b.test?bcc=x@y.test")).toBeNull();
  });
});

describe("forms", () => {
  it("needs a day of the week for a bulk price", () => {
    expect(
      bulkRatesSchema.safeParse({
        from: "2027-06-01",
        to: "2027-06-30",
        weekdays: [],
        price: "120",
      }).success,
    ).toBe(false);
  });

  it("stores a bulk price in cents", () => {
    expect(
      bulkRatesSchema.parse({
        from: "2027-06-01",
        to: "2027-06-30",
        weekdays: ["5", "6"],
        price: "120,50",
      }),
    ).toMatchObject({ weekdays: [5, 6], price: 12050 });
  });

  it("refuses a range longer than two years", () => {
    expect(
      bulkRatesSchema.safeParse({
        from: "2027-01-01",
        to: "2030-01-01",
        weekdays: ["1"],
        price: "120",
      }).success,
    ).toBe(false);
  });

  it("stores a fee in the shape the database needs", () => {
    const base = {
      nameEn: "City tax",
      nameEl: "Φόρος",
      isActive: "on",
    };
    expect(
      feeSchema.parse({
        ...base,
        kind: "percent",
        percent: "13,5",
        amount: "5",
      }),
    ).toMatchObject({ points: 1350, amount: null, isActive: true });
    expect(
      feeSchema.parse({ ...base, kind: "per_night", amount: "2" }),
    ).toMatchObject({ points: null, amount: 200 });
    expect(
      feeSchema.safeParse({ ...base, kind: "per_night", amount: "" }).success,
    ).toBe(false);
  });

  it("turns a promo into basis points or cents", () => {
    const base = { code: "SUMMER", isActive: "on" };
    expect(
      promoSchema.parse({ ...base, kind: "percent", value: "10" }).amount,
    ).toBe(1000);
    expect(
      promoSchema.parse({ ...base, kind: "fixed", value: "25" }).amount,
    ).toBe(2500);
    expect(
      promoSchema.safeParse({ ...base, kind: "percent", value: "101" }).success,
    ).toBe(false);
  });

  it("wants a rule to actually say something", () => {
    const dates = { from: "2027-06-01", to: "2027-06-30", days: [] };
    expect(restrictionSchema.safeParse(dates).success).toBe(false);
    expect(
      restrictionSchema.safeParse({ ...dates, minStay: "3", maxStay: "2" })
        .success,
    ).toBe(false);
    expect(restrictionSchema.parse({ ...dates, minStay: "3" }).minStay).toBe(3);
  });
});

describe("message templates", () => {
  it("fills in the guest and the booking", () => {
    const [arrival] = messageTemplates({
      name: "Maria Papadaki",
      reference: "CF-2027-00001",
      checkIn: "2027-06-20",
      checkOut: "2027-06-22",
    });
    expect(arrival.body).toContain("Hello Maria,");
    expect(arrival.subject).toContain("CF-2027-00001");
  });
});
