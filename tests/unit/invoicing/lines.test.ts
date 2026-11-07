import { describe, expect, it } from "vitest";
import {
  bilingual,
  buildCreditLines,
  buildPaymentLines,
  derivedRate,
  hasSingleLineAssumption,
  spreadVat,
  vatBreakdown,
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

const full = (breakdown: unknown, amountCents: number) =>
  buildPaymentLines({
    reference: "CF-1",
    breakdown,
    payment: { kind: "full", amountCents },
  });

const sum = (lines: DocumentLine[], key: keyof DocumentLine) =>
  lines.reduce((total, l) => total + Number(l[key]), 0);

describe("payment lines", () => {
  it("a full payment uses the booking's lines, in both languages", () => {
    const { lines, isSingleLine } = full(noVat, noVat.totalCents);
    expect(isSingleLine).toBe(false);
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
    const breakdown = {
      totalCents: 500,
      lines: [line("vat", 500)],
    };
    const { lines } = full(breakdown, 500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "other",
      vatCents: 500,
      totalCents: 500,
    });
  });

  it("a deposit and a balance are one line each, and their VAT adds up", () => {
    const deposit = buildPaymentLines({
      reference: "CF-1",
      breakdown: withVat,
      payment: { kind: "deposit", amountCents: 3333 },
    });
    const balance = buildPaymentLines({
      reference: "CF-1",
      breakdown: withVat,
      payment: {
        kind: "balance",
        amountCents: withVat.totalCents - 3333,
      },
    });
    expect(deposit.isSingleLine).toBe(true);
    expect(deposit.lines).toHaveLength(1);
    expect(deposit.lines[0].kind).toBe("deposit");
    expect(balance.lines[0].kind).toBe("balance");
    expect(deposit.lines[0].description).toContain("CF-1");
    expect(deposit.lines[0].vatCents + balance.lines[0].vatCents).toBe(1733);
    expect(hasSingleLineAssumption(deposit.lines)).toBe(true);
    expect(hasSingleLineAssumption(full(noVat, noVat.totalCents).lines)).toBe(
      false,
    );
  });

  it("falls back to one line when the payment and the booking disagree", () => {
    const { lines, isSingleLine } = full(noVat, 123);
    expect(isSingleLine).toBe(true);
    expect(lines[0]).toMatchObject({ kind: "other", totalCents: 123 });
  });

  it("falls back to one line for a price it cannot read", () => {
    for (const breakdown of [{ nights: [] }, null, "nonsense"]) {
      const { lines, isSingleLine } = full(breakdown, 5000);
      expect(isSingleLine).toBe(true);
      expect(lines[0]).toMatchObject({ totalCents: 5000, vatCents: 0 });
    }
  });

  it("does not trust totals that do not add up", () => {
    const broken = { ...noVat, totalCents: noVat.totalCents + 1 };
    expect(full(broken, broken.totalCents).isSingleLine).toBe(true);
  });
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
  const original = full(withVat, withVat.totalCents).lines;
  const base = {
    documentNumber: "TEST-R-000001",
    totalCents: withVat.totalCents,
    vatCents: 1733,
    lines: original,
    creditedCents: 0,
    creditedVatCents: 0,
  };

  it("crediting everything repeats the lines", () => {
    const lines = buildCreditLines({
      ...base,
      amountCents: withVat.totalCents,
    });
    expect(lines).toEqual(original);
  });

  it("crediting part is one positive line with VAT in proportion", () => {
    const [line] = buildCreditLines({ ...base, amountCents: 1000 });
    expect(line.totalCents).toBe(1000);
    expect(line.description).toContain("TEST-R-000001");
    expect(line.vatCents).toBe(Math.round((1733 * 1000) / base.totalCents));
    expect(line.unitCents + line.vatCents).toBe(1000);
    expect(line.vatBasisPoints).toBe(1300);
  });

  it("the last part credited uses up exactly the VAT left", () => {
    const first = buildCreditLines({ ...base, amountCents: 1000 })[0];
    const last = buildCreditLines({
      ...base,
      creditedCents: 1000,
      creditedVatCents: first.vatCents,
      amountCents: base.totalCents - 1000,
    })[0];
    expect(first.vatCents + last.vatCents).toBe(1733);
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

describe("labels", () => {
  it("shows one word when both languages match", () => {
    expect(bilingual({ en: "POS", el: "POS" })).toBe("POS");
    expect(bilingual({ en: "Only English" })).toBe("Only English");
    expect(bilingual({})).toBe("");
  });
});
