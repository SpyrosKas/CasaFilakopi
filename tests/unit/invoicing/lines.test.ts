import { describe, expect, it } from "vitest";
import {
  bilingual,
  buildCreditLines,
  buildPaymentLines,
  derivedRate,
  needsAccountantCheck,
  spreadVat,
  vatBreakdown,
  type PaymentLineInput,
} from "@/lib/invoicing/lines";
import type { DocumentLine } from "@/lib/invoicing/types";

const line = (
  kind: string,
  totalCents: number,
  quantity = 1,
  en = kind,
  el = kind,
) => ({
  kind,
  label: { en, el },
  quantity,
  unitCents: Math.round(totalCents / quantity),
  totalCents,
});

const noVat = {
  totalCents: 50000 + 4000 - 2000 + 1000,
  lines: [
    line("accommodation", 50000, 5, "Accommodation", "Διαμονή"),
    line("cleaning", 4000),
    line("discount", -2000),
    line("fee", 1000, 5, "Climate fee", "Τέλος"),
  ],
};

const withVat = {
  totalCents: 10000 + 3333 + 1733 + 400,
  lines: [
    line("accommodation", 10000),
    line("cleaning", 3333),
    line("vat", 1733),
    line("fee", 400),
  ],
};

/** The owner's worked example: 864,00 + 13% VAT 112,32 + fee 15,00. */
const worked = {
  totalCents: 99132,
  lines: [
    line("accommodation", 90000, 5, "Accommodation", "Διαμονή"),
    line("discount", -3600, 1, "Discount", "Έκπτωση"),
    line("vat", 11232, 1, "VAT", "ΦΠΑ"),
    line("fee", 1500, 5, "Climate resilience fee", "Τέλος ανθεκτικότητας"),
  ],
};

function built(input: PaymentLineInput) {
  const result = buildPaymentLines(input);
  if (!result.ok) throw new Error("The price should have been readable");
  return result;
}

const pay = (
  breakdown: unknown,
  kind: PaymentLineInput["payment"]["kind"],
  amountCents: number,
) => built({ reference: "CF-1", breakdown, payment: { kind, amountCents } });

const full = (breakdown: unknown, amountCents: number) =>
  pay(breakdown, "full", amountCents);

const sum = (lines: DocumentLine[], key: keyof DocumentLine) =>
  lines.reduce((total, l) => total + Number(l[key]), 0);

/** The figures a document's database row works out from its lines. */
function figures(lines: DocumentLine[]) {
  const total = sum(lines, "totalCents");
  const vat = sum(lines, "vatCents");
  const fee = sum(
    lines.filter((l) => l.kind === "fee"),
    "totalCents",
  );
  return { total, vat, fee, net: total - vat - fee };
}

describe("a full payment", () => {
  it("uses the booking's lines, in both languages", () => {
    const { lines, needsConfirmation } = full(noVat, noVat.totalCents);
    expect(needsConfirmation).toBe(false);
    expect(lines.map((l) => l.kind)).toEqual([
      "accommodation",
      "cleaning",
      "discount",
      "fee",
    ]);
    expect(lines[0].description).toBe("Διαμονή / Accommodation");
    expect(lines[0].quantity).toBe(5);
    expect(sum(lines, "totalCents")).toBe(noVat.totalCents);
  });

  it("assumes no VAT rate when the booking has no VAT line", () => {
    const { lines } = full(noVat, noVat.totalCents);
    expect(sum(lines, "vatCents")).toBe(0);
    expect(lines.every((l) => l.vatBasisPoints === 0)).toBe(true);
  });

  it("spreads the booking's VAT exactly, and never onto the fee", () => {
    const { lines } = full(withVat, withVat.totalCents);
    expect(lines.map((l) => l.kind)).toEqual([
      "accommodation",
      "cleaning",
      "fee",
    ]);
    expect(sum(lines, "vatCents")).toBe(1733);
    expect(sum(lines, "totalCents")).toBe(withVat.totalCents);
    expect(lines[2]).toMatchObject({ vatCents: 0, vatBasisPoints: 0 });
    expect(lines[0].vatBasisPoints).toBe(1300);
  });

  it("a discount takes its share of VAT off", () => {
    const breakdown = {
      totalCents: 10000 - 1000 + 900,
      lines: [
        line("accommodation", 10000),
        line("discount", -1000),
        line("vat", 900),
      ],
    };
    const { lines } = full(breakdown, breakdown.totalCents);
    expect(lines.map((l) => l.vatCents)).toEqual([1000, -100]);
    expect(lines.map((l) => l.totalCents)).toEqual([11000, -1100]);
  });

  it("keeps VAT visible if there is nothing to share it across", () => {
    const breakdown = { totalCents: 500, lines: [line("vat", 500)] };
    const { lines } = full(breakdown, 500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "other",
      vatCents: 500,
      totalCents: 500,
    });
  });

  it("that does not match the booking is flagged, never dressed up", () => {
    const { lines, needsConfirmation } = full(noVat, 123);
    expect(needsConfirmation).toBe(true);
    expect(lines[0].kind).toBe("other");
    expect(sum(lines, "totalCents")).toBe(123);
    expect(needsAccountantCheck(lines)).toBe(true);
  });
});

describe("the worked example", () => {
  const deposit = pay(worked, "deposit", 29740);
  const balance = pay(worked, "balance", 99132 - 29740);
  const whole = full(worked, 99132);

  it("gives the full payment's figures", () => {
    expect(figures(whole.lines)).toEqual({
      total: 99132,
      vat: 11232,
      fee: 1500,
      net: 86400,
    });
  });

  it("the deposit is a taxable line and a fee line", () => {
    expect(deposit.lines.map((l) => l.kind)).toEqual(["deposit", "fee"]);
    expect(figures(deposit.lines)).toEqual({
      total: 29740,
      vat: 3370,
      fee: 450,
      net: 25920,
    });
    expect(deposit.lines[0]).toMatchObject({
      unitCents: 25920,
      totalCents: 29290,
      vatCents: 3370,
      vatBasisPoints: 1300,
    });
    expect(deposit.lines[1]).toMatchObject({
      totalCents: 450,
      vatCents: 0,
      vatBasisPoints: 0,
    });
  });

  it("the balance takes exactly what the deposit left", () => {
    expect(figures(balance.lines)).toEqual({
      total: 69392,
      vat: 7862,
      fee: 1050,
      net: 60480,
    });
  });

  it("deposit plus balance equals the full payment, column by column", () => {
    const [a, b, c] = [deposit, balance, whole].map((d) => figures(d.lines));
    expect(a.total + b.total).toBe(c.total);
    expect(a.net + b.net).toBe(c.net);
    expect(a.vat + b.vat).toBe(c.vat);
    expect(a.fee + b.fee).toBe(c.fee);
  });

  it("keeps the fee out of the VAT base", () => {
    expect(vatBreakdown(deposit.lines)).toEqual([
      { basisPoints: 1300, baseCents: 25920, vatCents: 3370 },
    ]);
  });

  it("keeps the flag for the accountant", () => {
    expect(deposit.needsConfirmation).toBe(true);
    expect(balance.needsConfirmation).toBe(true);
    expect(needsAccountantCheck(deposit.lines)).toBe(true);
  });

  it("names the booking and the fee", () => {
    expect(deposit.lines[0].description).toContain("CF-1");
    expect(deposit.lines[1].description).toContain("Τέλος ανθεκτικότητας");
  });

  it("adds up at every deposit size", () => {
    for (let deposited = 1; deposited < 99132; deposited += 977) {
      const a = figures(pay(worked, "deposit", deposited).lines);
      const b = figures(pay(worked, "balance", 99132 - deposited).lines);
      expect(a.total + b.total).toBe(99132);
      expect(a.vat + b.vat).toBe(11232);
      expect(a.fee + b.fee).toBe(1500);
      expect(a.net + b.net).toBe(86400);
    }
  });

  it("two fees share one line with a general name", () => {
    const breakdown = {
      totalCents: 10300,
      lines: [line("accommodation", 10000), line("fee", 200), line("fee", 100)],
    };
    const { lines } = pay(breakdown, "deposit", 3090);
    expect(lines[1].totalCents).toBe(90);
    expect(lines[1].description).toContain("Fees outside VAT");
  });
});

describe("a payment with no fee", () => {
  it("is one line", () => {
    const breakdown = {
      totalCents: 1000,
      lines: [line("accommodation", 1000)],
    };
    const { lines } = pay(breakdown, "deposit", 300);
    expect(lines.map((l) => l.kind)).toEqual(["deposit"]);
  });
});

describe("money kept on a cancelled booking", () => {
  it("is a flagged share, even if it was a full payment", () => {
    const { lines, needsConfirmation } = built({
      reference: "CF-1",
      breakdown: worked,
      payment: { kind: "full", amountCents: 99132, isRetained: true },
    });
    expect(needsConfirmation).toBe(true);
    expect(lines[0].kind).toBe("other");
    expect(figures(lines)).toEqual({
      total: 99132,
      vat: 11232,
      fee: 1500,
      net: 86400,
    });
  });
});

describe("a price that cannot be read", () => {
  const unreadable: [string, unknown][] = [
    ["no lines", { nights: [] }],
    ["nothing at all", null],
    ["text", "nonsense"],
    ["empty lines", { totalCents: 100, lines: [] }],
    ["a line with no amount", { totalCents: 100, lines: [{ kind: "fee" }] }],
    [
      "a missing label",
      { totalCents: 100, lines: [{ ...line("fee", 100), label: null }] },
    ],
    ["amounts as text", { totalCents: "100", lines: [line("fee", 100)] }],
    [
      "lines that do not add up",
      { ...noVat, totalCents: noVat.totalCents + 1 },
    ],
    ["a zero price", { totalCents: 0, lines: [line("accommodation", 0)] }],
  ];

  for (const [name, breakdown] of unreadable) {
    it(`refuses ${name}, and never gives VAT 0`, () => {
      for (const kind of ["full", "deposit", "balance", "extra"] as const) {
        expect(
          buildPaymentLines({
            reference: "CF-1",
            breakdown,
            payment: { kind, amountCents: 100 },
          }),
        ).toEqual({ ok: false });
      }
    });
  }
});

describe("spreading VAT", () => {
  it("always adds up, for awkward amounts", () => {
    for (const vat of [1, 2, 7, 99, 1000]) {
      const shares = spreadVat([3333, 3333, 3334], vat);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(vat);
    }
  });

  it("gives nothing when there is no base", () => {
    expect(spreadVat([0], 100)).toEqual([0]);
  });

  it("works the rate out from the amounts, and never guesses one", () => {
    expect(derivedRate(1300, 10000)).toBe(1300);
    expect(derivedRate(0, 10000)).toBe(0);
    expect(derivedRate(100, 0)).toBe(0);
  });
});

describe("credit lines", () => {
  const original = full(worked, worked.totalCents).lines;
  const base = {
    documentNumber: "TEST-R-000001",
    totalCents: worked.totalCents,
    vatCents: 11232,
    feeCents: 1500,
    lines: original,
    creditedCents: 0,
    creditedVatCents: 0,
    creditedFeeCents: 0,
  };

  it("crediting everything repeats the lines", () => {
    expect(buildCreditLines({ ...base, amountCents: 99132 })).toEqual(original);
  });

  it("crediting part keeps the fee out of the VAT base", () => {
    const lines = buildCreditLines({ ...base, amountCents: 29740 });
    expect(lines.map((l) => l.kind)).toEqual(["other", "fee"]);
    expect(figures(lines)).toEqual({
      total: 29740,
      vat: 3370,
      fee: 450,
      net: 25920,
    });
    expect(lines[0].description).toContain("TEST-R-000001");
    expect(lines[0].vatBasisPoints).toBe(1300);
    expect(needsAccountantCheck(lines)).toBe(true);
  });

  it("the last part uses up exactly what is left", () => {
    const first = figures(buildCreditLines({ ...base, amountCents: 10000 }));
    const last = figures(
      buildCreditLines({
        ...base,
        creditedCents: first.total,
        creditedVatCents: first.vat,
        creditedFeeCents: first.fee,
        amountCents: base.totalCents - first.total,
      }),
    );
    expect(first.vat + last.vat).toBe(11232);
    expect(first.fee + last.fee).toBe(1500);
    expect(first.net + last.net).toBe(86400);
  });

  it("a document with no fee has no fee line", () => {
    const lines = buildCreditLines({
      ...base,
      feeCents: 0,
      amountCents: 1000,
    });
    expect(lines.map((l) => l.kind)).toEqual(["other"]);
  });
});

describe("VAT breakdown", () => {
  it("groups by rate and leaves fees out", () => {
    const rows = vatBreakdown(full(withVat, withVat.totalCents).lines);
    expect(rows).toEqual([
      { basisPoints: 1300, baseCents: 13333, vatCents: 1733 },
    ]);
  });
});

describe("what needs the accountant", () => {
  const flagged = (kind: string) => needsAccountantCheck([{ kind }]);

  it("covers deposits, balances and other", () => {
    expect(flagged("deposit")).toBe(true);
    expect(flagged("balance")).toBe(true);
    expect(flagged("other")).toBe(true);
  });

  it("leaves ordinary lines alone", () => {
    expect(flagged("accommodation")).toBe(false);
    expect(flagged("fee")).toBe(false);
  });
});

describe("labels", () => {
  it("shows one word when both languages match", () => {
    expect(bilingual({ en: "POS", el: "POS" })).toBe("POS");
    expect(bilingual({ en: "Only English" })).toBe("Only English");
    expect(bilingual({})).toBe("");
  });
});
