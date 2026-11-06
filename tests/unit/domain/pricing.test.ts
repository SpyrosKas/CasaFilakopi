import { describe, expect, it } from "vitest";
import {
  buildPriceBreakdown,
  checkPromo,
  findPromo,
  linesTotal,
  QuoteError,
} from "@/lib/domain";
import {
  breakdownInput,
  fee,
  NOW,
  promo,
  ROOM,
  ROOM_ID,
  stay,
} from "./fixtures";

const season = {
  start_date: "2027-07-01",
  end_date: "2027-08-31",
  nightly_cents: 22000,
  weekend_cents: 24000,
};

// 1 July 2027 is a Thursday, so the nights run Thu, Fri, Sat, Sun.
const julyStay = stay({ checkIn: "2027-07-01", checkOut: "2027-07-05" });

const nightly = (input: Parameters<typeof breakdownInput>[0]) =>
  buildPriceBreakdown(breakdownInput(input)).nights.map((n) => n.cents);

describe("nightly price", () => {
  it("falls back to the room's base price", () => {
    expect(nightly({ stay: stay() })).toEqual([12000, 12000, 12000]);
  });

  it("charges nights, not the check-out date", () => {
    const { nights } = buildPriceBreakdown(breakdownInput());
    expect(nights.map((n) => n.night)).toEqual([
      "2027-06-14",
      "2027-06-15",
      "2027-06-16",
    ]);
  });

  it("uses a season's weekend rate on Friday and Saturday nights", () => {
    expect(nightly({ stay: julyStay, seasons: [season] })).toEqual([
      22000, 24000, 24000, 22000,
    ]);
  });

  it("takes the weekend definition from the setting", () => {
    expect(
      nightly({ stay: julyStay, seasons: [season], weekendDays: [0] }),
    ).toEqual([22000, 22000, 22000, 24000]);
    expect(
      nightly({ stay: julyStay, seasons: [season], weekendDays: [] }),
    ).toEqual([22000, 22000, 22000, 22000]);
  });

  it("uses the nightly rate on weekends when a season has no weekend rate", () => {
    expect(
      nightly({
        stay: julyStay,
        seasons: [{ ...season, weekend_cents: null }],
      }),
    ).toEqual([22000, 22000, 22000, 22000]);
  });

  it("honours a weekend rate of zero", () => {
    expect(
      nightly({ stay: julyStay, seasons: [{ ...season, weekend_cents: 0 }] }),
    ).toEqual([22000, 0, 0, 22000]);
  });

  it("prefers an override to the season, even at zero", () => {
    expect(
      nightly({
        stay: julyStay,
        seasons: [season],
        overrides: [
          { night: "2027-07-02", nightly_cents: 30000 },
          { night: "2027-07-03", nightly_cents: 0 },
        ],
      }),
    ).toEqual([22000, 30000, 0, 22000]);
  });

  it("treats both season dates as inclusive", () => {
    expect(
      nightly({
        stay: stay({ checkIn: "2027-06-30", checkOut: "2027-07-02" }),
        seasons: [season],
      }),
    ).toEqual([12000, 22000]);
    expect(
      nightly({
        stay: stay({ checkIn: "2027-08-31", checkOut: "2027-09-02" }),
        seasons: [season],
      }),
    ).toEqual([22000, 12000]);
  });

  it("walks a stay across a year boundary and a leap day", () => {
    expect(
      nightly({
        stay: stay({ checkIn: "2027-12-31", checkOut: "2028-01-02" }),
        overrides: [{ night: "2028-01-01", nightly_cents: 9000 }],
      }),
    ).toEqual([12000, 9000]);
    expect(
      nightly({
        stay: stay({ checkIn: "2028-02-28", checkOut: "2028-03-01" }),
        overrides: [{ night: "2028-02-29", nightly_cents: 9000 }],
      }),
    ).toEqual([12000, 9000]);
  });

  it("counts every night across both DST changes", () => {
    expect(
      nightly({
        stay: stay({ checkIn: "2027-03-27", checkOut: "2027-03-29" }),
      }),
    ).toHaveLength(2);
    expect(
      nightly({
        stay: stay({ checkIn: "2027-10-30", checkOut: "2027-11-01" }),
      }),
    ).toHaveLength(2);
  });
});

describe("lines", () => {
  it("groups nights by rate", () => {
    const { lines } = buildPriceBreakdown(
      breakdownInput({
        stay: julyStay,
        seasons: [season],
        room: { ...ROOM, cleaning_fee_cents: 0 },
      }),
    );
    expect(
      lines.map(({ kind, quantity, unitCents, totalCents }) => ({
        kind,
        quantity,
        unitCents,
        totalCents,
      })),
    ).toEqual([
      {
        kind: "accommodation",
        quantity: 2,
        unitCents: 22000,
        totalCents: 44000,
      },
      {
        kind: "accommodation",
        quantity: 2,
        unitCents: 24000,
        totalCents: 48000,
      },
    ]);
  });

  it("adds one cleaning fee per stay", () => {
    const { lines, totalCents } = buildPriceBreakdown(breakdownInput());
    expect(lines.filter((l) => l.kind === "cleaning")).toHaveLength(1);
    expect(totalCents).toBe(36000 + 4000);
  });

  it("charges extra guests above base occupancy per night, counting children", () => {
    const { lines } = buildPriceBreakdown(
      breakdownInput({
        stay: stay({ adults: 3, children: 1 }),
        room: { ...ROOM, extra_guest_fee_cents: 1500 },
      }),
    );
    expect(lines.find((l) => l.kind === "extra_guest")).toMatchObject({
      quantity: 6,
      unitCents: 1500,
      totalCents: 9000,
    });
  });

  it("charges nothing extra at base occupancy", () => {
    const { lines } = buildPriceBreakdown(
      breakdownInput({
        stay: stay({ adults: 1, children: 1 }),
        room: { ...ROOM, extra_guest_fee_cents: 1500 },
      }),
    );
    expect(lines.some((l) => l.kind === "extra_guest")).toBe(false);
  });

  it("labels house lines in both languages", () => {
    const { lines } = buildPriceBreakdown(breakdownInput());
    for (const line of lines) {
      expect(Object.keys(line.label).sort()).toEqual(["el", "en"]);
    }
  });
});

describe("taxes and fees", () => {
  const fees = (rows: Parameters<typeof fee>[0][], input = {}) =>
    buildPriceBreakdown(
      breakdownInput({ fees: rows.map(fee), ...input }),
    ).lines.filter((l) => l.kind === "fee" || l.kind === "vat");

  it("charges the climate resilience fee per night", () => {
    expect(fees([{}])[0]).toMatchObject({
      kind: "fee",
      quantity: 3,
      unitCents: 200,
      totalCents: 600,
      label: { en: "Climate resilience fee", el: "Τέλος" },
    });
  });

  it("charges a per stay fee once", () => {
    expect(fees([{ kind: "per_stay", amount_cents: 500 }])[0]).toMatchObject({
      quantity: 1,
      totalCents: 500,
    });
  });

  it("charges a per guest night fee for adults and children", () => {
    const input = { stay: stay({ adults: 2, children: 1 }) };
    expect(
      fees([{ kind: "per_guest_night", amount_cents: 50 }], input)[0],
    ).toMatchObject({ quantity: 9, unitCents: 50, totalCents: 450 });
  });

  it("applies percent to house charges and rounds half up", () => {
    const [line] = fees(
      [{ kind: "percent", amount_cents: null, rate_basis_points: 1250 }],
      {
        stay: stay({ checkOut: "2027-06-15" }),
        room: { ...ROOM, base_price_cents: 10004, cleaning_fee_cents: 0 },
      },
    );
    expect(line).toMatchObject({ quantity: 1, totalCents: 1251 });
  });

  it("marks VAT rows as vat, using only the stored rate", () => {
    const [line] = fees([
      {
        kind: "percent",
        amount_cents: null,
        rate_basis_points: 1300,
        is_vat: true,
      },
    ]);
    expect(line).toMatchObject({ kind: "vat", totalCents: 5200 });
  });

  it("assumes no VAT when there is no VAT row", () => {
    const { lines } = buildPriceBreakdown(breakdownInput({ fees: [fee()] }));
    expect(lines.some((l) => l.kind === "vat")).toBe(false);
  });

  it("does not compound percent rows or tax fixed fees", () => {
    const lines = fees([
      { sort_order: 1 },
      {
        kind: "percent",
        amount_cents: null,
        rate_basis_points: 1000,
        sort_order: 2,
      },
      {
        kind: "percent",
        amount_cents: null,
        rate_basis_points: 1000,
        is_vat: true,
        sort_order: 3,
      },
    ]);
    expect(lines.map((l) => l.totalCents)).toEqual([600, 4000, 4000]);
  });

  it("orders by sort_order", () => {
    const lines = fees([
      { name: { en: "B" }, sort_order: 2 },
      { name: { en: "A" }, sort_order: 1 },
    ]);
    expect(lines.map((l) => l.label.en)).toEqual(["A", "B"]);
  });

  it("skips inactive rows", () => {
    expect(fees([{ is_active: false }])).toEqual([]);
  });

  it("splits a per night fee at a validity boundary", () => {
    const lines = fees(
      [
        { amount_cents: 1000, valid_to: "2027-10-31" },
        { amount_cents: 200, valid_from: "2027-11-01" },
      ],
      { stay: stay({ checkIn: "2027-10-30", checkOut: "2027-11-03" }) },
    );
    expect(lines.map((l) => [l.quantity, l.totalCents])).toEqual([
      [2, 2000],
      [2, 400],
    ]);
  });

  it("counts only in-window nights for a per guest night fee", () => {
    const [line] = fees(
      [
        {
          kind: "per_guest_night",
          amount_cents: 50,
          valid_from: "2027-06-15",
        },
      ],
      { stay: stay({ adults: 2, children: 1 }) },
    );
    expect(line).toMatchObject({ quantity: 6, totalCents: 300 });
  });

  it("treats both validity dates as inclusive", () => {
    const window = { valid_from: "2027-06-15", valid_to: "2027-06-15" };
    expect(fees([window])[0]).toMatchObject({ quantity: 1 });
  });

  it("drops a per night fee entirely outside its window", () => {
    expect(fees([{ valid_to: "2027-06-13" }])).toEqual([]);
    expect(fees([{ valid_from: "2027-06-17" }])).toEqual([]);
  });

  it("decides per stay and percent rows on the check-in date", () => {
    const perStay = { kind: "per_stay" as const, amount_cents: 500 };
    expect(fees([{ ...perStay, valid_from: "2027-06-14" }])).toHaveLength(1);
    expect(fees([{ ...perStay, valid_to: "2027-06-14" }])).toHaveLength(1);
    expect(fees([{ ...perStay, valid_from: "2027-06-15" }])).toEqual([]);
    expect(fees([{ ...perStay, valid_to: "2027-06-13" }])).toEqual([]);
  });
});

describe("promo codes", () => {
  const TODAY = "2027-06-01";

  it("finds a code whatever the case or spacing", () => {
    const rows = [promo({ code: "Summer10" })];
    expect(findPromo(rows, "  sUMMER10 ")?.code).toBe("Summer10");
    expect(findPromo(rows, "summer1")).toBeNull();
  });

  it("does not treat wildcard characters as wildcards", () => {
    const rows = [promo({ code: "SUMMER" })];
    expect(findPromo(rows, "%")).toBeNull();
    expect(findPromo(rows, "*")).toBeNull();
    expect(findPromo(rows, "SUMME_")).toBeNull();
  });

  it.each([
    ["no such code", null, "not_found"],
    ["inactive", promo({ is_active: false }), "inactive"],
    ["starts tomorrow", promo({ valid_from: "2027-06-02" }), "not_yet_valid"],
    ["ended yesterday", promo({ valid_to: "2027-05-31" }), "expired"],
    ["other room", promo({ room_ids: ["other"] }), "room_not_eligible"],
    ["no rooms", promo({ room_ids: [] }), "room_not_eligible"],
    ["used up", promo({ max_uses: 3, used_count: 3 }), "exhausted"],
  ])("refuses a code that is %s", (_, row, reason) => {
    expect(checkPromo(row, ROOM_ID, TODAY)).toEqual({ ok: false, reason });
  });

  it.each([
    ["first valid day", promo({ valid_from: TODAY })],
    ["last valid day", promo({ valid_to: TODAY })],
    ["its own room", promo({ room_ids: [ROOM_ID] })],
    ["one use left", promo({ max_uses: 3, used_count: 2 })],
  ])("accepts a code on its %s", (_, row) => {
    expect(checkPromo(row, ROOM_ID, TODAY).ok).toBe(true);
  });

  const quote = (row = promo()) =>
    buildPriceBreakdown(
      breakdownInput({ promoCode: "summer", promo: row, fees: [fee()] }),
    );

  it("takes a percentage off the house charges, not the fees", () => {
    const { lines, totalCents, promoCode } = quote();
    expect(lines.find((l) => l.kind === "discount")).toMatchObject({
      quantity: 1,
      unitCents: -4000,
      totalCents: -4000,
    });
    expect(totalCents).toBe(40000 - 4000 + 600);
    expect(promoCode).toBe("SUMMER");
  });

  it("takes a fixed amount off", () => {
    expect(quote(promo({ kind: "fixed", value: 2500 })).totalCents).toBe(
      40000 - 2500 + 600,
    );
  });

  it("caps a fixed discount, leaving the fees", () => {
    expect(quote(promo({ kind: "fixed", value: 999999 })).totalCents).toBe(600);
  });

  it("caps a percentage above 100", () => {
    expect(quote(promo({ value: 15000 })).totalCents).toBe(600);
  });

  it("lowers the base for percent fees", () => {
    const { lines } = buildPriceBreakdown(
      breakdownInput({
        promoCode: "summer",
        promo: promo(),
        fees: [
          fee({
            kind: "percent",
            amount_cents: null,
            rate_basis_points: 1000,
          }),
        ],
      }),
    );
    expect(lines.find((l) => l.kind === "fee")?.totalCents).toBe(3600);
  });

  it("charges full price and says why when a code fails", () => {
    const breakdown = quote(promo({ valid_to: "2027-05-31" }));
    expect(breakdown.totalCents).toBe(40600);
    expect(breakdown.promoCode).toBeNull();
    expect(breakdown.promoRejection).toBe("expired");
    expect(breakdown.lines.some((l) => l.kind === "discount")).toBe(false);
  });

  it("reports nothing when no code was typed", () => {
    const breakdown = buildPriceBreakdown(breakdownInput({ promoCode: "   " }));
    expect(breakdown).not.toHaveProperty("promoRejection");
    expect(breakdown.promoCode).toBeNull();
  });

  it("checks validity on the Athens date of the booking, not the stay", () => {
    const row = promo({ valid_to: "2027-06-30" });
    const later = stay({ checkIn: "2027-08-01", checkOut: "2027-08-03" });
    const quoteAt = (now: Date) =>
      buildPriceBreakdown(
        breakdownInput({ stay: later, promoCode: "summer", promo: row, now }),
      ).promoCode;
    expect(quoteAt(new Date("2027-06-30T20:59:59Z"))).toBe("SUMMER");
    expect(quoteAt(new Date("2027-06-30T21:00:00Z"))).toBeNull();
  });
});

describe("guarding the breakdown", () => {
  it("refuses a stay with no nights", () => {
    expect(() =>
      buildPriceBreakdown(
        breakdownInput({ stay: stay({ checkOut: "2027-06-14" }) }),
      ),
    ).toThrow(QuoteError);
  });

  it("refuses an impossible date", () => {
    expect(() =>
      buildPriceBreakdown(
        breakdownInput({ stay: stay({ checkIn: "2027-02-30" }) }),
      ),
    ).toThrow(new QuoteError("invalid_dates"));
  });

  it("refuses a stay too long to price", () => {
    expect(() =>
      buildPriceBreakdown(
        breakdownInput({
          stay: stay({ checkIn: "2027-06-14", checkOut: "2030-06-14" }),
        }),
      ),
    ).toThrow(new QuoteError("above_max_stay"));
  });

  it("refuses a negative guest count", () => {
    expect(() =>
      buildPriceBreakdown(breakdownInput({ stay: stay({ adults: -1 }) })),
    ).toThrow(RangeError);
  });

  it("totals exactly the lines", () => {
    const breakdown = buildPriceBreakdown(
      breakdownInput({ fees: [fee()], now: NOW }),
    );
    expect(linesTotal(breakdown.lines)).toBe(breakdown.totalCents);
  });
});
