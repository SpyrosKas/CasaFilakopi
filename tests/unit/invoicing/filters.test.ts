import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  applyFilters,
  creditedAmounts,
  filtersToQuery,
  foldText,
  hasFilters,
  parseFilters,
  selectionSchema,
  SELECTION_LIMIT,
  summarise,
  type FilterableRow,
} from "@/lib/invoicing/filters";

const row = (change: Partial<FilterableRow> = {}): FilterableRow => ({
  id: randomUUID(),
  docType: "receipt",
  issuedOn: "2026-11-07",
  hasPdf: true,
  isSent: false,
  bookingReference: "CF-2027-00001",
  guestNames: ["Μαρία Παπαδοπούλου"],
  paymentMethod: "card",
  transactionIds: ["pi_abc"],
  creditsInvoiceId: null,
  totalCents: 10000,
  netCents: 9000,
  vatCents: 500,
  feeCents: 500,
  ...change,
});

const only = (rows: FilterableRow[], params: Record<string, string>) =>
  applyFilters(rows, parseFilters(params));

describe("reading filters from the address", () => {
  it("keeps good values", () => {
    expect(
      parseFilters({
        month: "2026-11",
        from: "2026-11-01",
        type: "invoice",
        status: "pdf_missing",
        sent: "no",
        method: "cash",
        page: "3",
        guest: "  Μαρία ",
      }),
    ).toMatchObject({
      month: "2026-11",
      from: "2026-11-01",
      type: "invoice",
      status: "pdf_missing",
      sent: "no",
      method: "cash",
      page: 3,
      guest: "Μαρία",
    });
  });

  it("drops nonsense and still opens the list", () => {
    const filters = parseFilters({
      month: "2026-13",
      from: "2027-02-29",
      type: "bribe",
      status: "x",
      sent: "maybe",
      method: "gold",
      page: "-4",
      guest: "x".repeat(500),
    });
    expect(hasFilters(filters)).toBe(false);
    expect(filters.page).toBe(1);
  });

  it("uses the first of a repeated value", () => {
    expect(parseFilters({ type: ["invoice", "receipt"] }).type).toBe("invoice");
  });

  it("makes a link that gives the same filters back", () => {
    const filters = parseFilters({ month: "2026-11", guest: "Μαρία & co" });
    const query = filtersToQuery(filters, 2);
    expect(query).toContain("page=2");
    const back = Object.fromEntries(new URLSearchParams(query));
    expect(parseFilters(back)).toMatchObject({
      month: "2026-11",
      guest: "Μαρία & co",
      page: 2,
    });
    expect(filtersToQuery(parseFilters({}))).toBe("");
  });
});

describe("filtering", () => {
  it("by month, using the date on Milos", () => {
    const november = row();
    const october = row({ issuedOn: "2026-10-31" });
    expect(only([november, october], { month: "2026-10" })).toEqual([october]);
  });

  it("by date range, both ends included", () => {
    const rows = ["2026-11-01", "2026-11-02", "2026-11-03"].map((issuedOn) =>
      row({ issuedOn }),
    );
    expect(
      only(rows, { from: "2026-11-02", to: "2026-11-03" }).map(
        (r) => r.issuedOn,
      ),
    ).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("by type, method and sent", () => {
    const receipt = row();
    const invoice = row({
      docType: "invoice",
      paymentMethod: "cash",
      isSent: true,
    });
    expect(only([receipt, invoice], { type: "invoice" })).toEqual([invoice]);
    expect(only([receipt, invoice], { method: "cash" })).toEqual([invoice]);
    expect(only([receipt, invoice], { sent: "yes" })).toEqual([invoice]);
    expect(only([receipt, invoice], { sent: "no" })).toEqual([receipt]);
  });

  it("by guest, ignoring case and Greek accents", () => {
    const rows = [row(), row({ guestNames: ["John Smith"] })];
    for (const guest of ["ΜΑΡΙΑ", "μαρια", "παπαδοπουλου", "Μαρία"]) {
      expect(only(rows, { guest })).toHaveLength(1);
    }
    expect(foldText("ΠΑΠΑΔΟΠΟΥΛΟΣ")).toBe(foldText("παπαδόπουλος"));
  });

  it("by booking reference, in part", () => {
    expect(
      only([row(), row({ bookingReference: "CF-2027-00099" })], {
        booking: "00099",
      }),
    ).toHaveLength(1);
  });

  it("a filter value is plain text, not a pattern", () => {
    expect(only([row()], { guest: "%" })).toEqual([]);
    expect(only([row()], { booking: "_" })).toEqual([]);
  });

  it("by transaction, and a credit note follows its original", () => {
    const original = row({ transactionIds: ["pi_wanted", "ref-7"] });
    const credit = row({
      docType: "credit_note",
      transactionIds: [],
      creditsInvoiceId: original.id,
    });
    const other = row({ transactionIds: ["pi_other"] });
    const rows = [original, credit, other];
    expect(only(rows, { transaction: "pi_wanted" })).toEqual([
      original,
      credit,
    ]);
    expect(only(rows, { transaction: "ref-7" })).toHaveLength(2);
  });

  describe("by status", () => {
    const whole = row();
    const part = row();
    const open = row();
    const noPdf = row({ hasPdf: false });
    const rows = [
      whole,
      part,
      open,
      noPdf,
      row({
        docType: "credit_note",
        creditsInvoiceId: whole.id,
        totalCents: 10000,
      }),
      row({
        docType: "credit_note",
        creditsInvoiceId: part.id,
        totalCents: 1000,
      }),
    ];

    it("finds what is left uncredited", () => {
      expect(only(rows, { status: "open" })).toEqual([open, noPdf]);
    });
    it("finds partly and fully credited", () => {
      expect(only(rows, { status: "part_credited" })).toEqual([part]);
      expect(only(rows, { status: "credited" })).toEqual([whole]);
    });
    it("finds missing PDFs", () => {
      expect(only(rows, { status: "pdf_missing" })).toEqual([noPdf]);
    });
  });
});

describe("totals", () => {
  it("takes credit notes off", () => {
    const original = row();
    const credit = row({
      docType: "credit_note",
      creditsInvoiceId: original.id,
      totalCents: 2500,
      netCents: 2000,
      vatCents: 300,
      feeCents: 200,
    });
    expect(summarise([original, credit])).toEqual({
      count: 2,
      billedCents: 10000,
      creditedCents: 2500,
      totalCents: 7500,
      netCents: 7000,
      vatCents: 200,
      feeCents: 300,
    });
    expect(creditedAmounts([original, credit]).get(original.id)).toBe(2500);
  });
});

describe("a selection from the browser", () => {
  it("accepts ids and removes repeats", () => {
    const id = randomUUID();
    expect(selectionSchema.parse([id, id])).toEqual([id]);
  });

  it("refuses anything that is not a list of ids", () => {
    for (const bad of [
      [],
      ["1"],
      ["' or 1=1 --"],
      [randomUUID(), "nope"],
      "x",
      null,
      [{}],
    ]) {
      expect(selectionSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("refuses more than the limit", () => {
    const ids = Array.from({ length: SELECTION_LIMIT + 1 }, () => randomUUID());
    expect(selectionSchema.safeParse(ids).success).toBe(false);
    expect(selectionSchema.safeParse(ids.slice(1)).success).toBe(true);
  });
});
