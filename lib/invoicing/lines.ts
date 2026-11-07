import { z } from "zod";
import type { DocumentLine, LineKind, PaymentKind } from "./types";

// Turns a booking's stored price into document lines. No VAT rate is written
// here: VAT comes only from `vat` lines in bookings.price_breakdown, which the
// pricing engine adds on top of the house's charges after discount (see
// lib/domain/fees.ts). The rate on a document is worked out from those lines.

const priceLine = z.object({
  kind: z.string(),
  label: z.record(z.string(), z.string()).catch({}),
  quantity: z.number(),
  unitCents: z.number().int(),
  totalCents: z.number().int(),
});

const breakdownSchema = z.object({
  lines: z.array(priceLine).min(1),
  totalCents: z.number().int(),
});

type PriceLine = z.output<typeof priceLine>;

/** The charges VAT is worked out on (lib/domain/breakdown.ts). */
const VAT_BASE_KINDS = ["accommodation", "extra_guest", "cleaning", "discount"];
const LINE_KINDS: string[] = [...VAT_BASE_KINDS, "fee"];

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Exact half cents round up, the rule in lib/domain/money.ts. */
function roundedShare(amount: number, part: number, whole: number): number {
  if (whole === 0) return 0;
  return Math.floor((2 * amount * part + whole) / (2 * whole));
}

/** Both languages, because the document goes to a Greek accountant. */
export function bilingual(label: Record<string, string>): string {
  const { el, en } = label;
  if (el && en && el !== en) return `${el} / ${en}`;
  return el || en || Object.values(label)[0] || "";
}

function vatOf(lines: PriceLine[]): { vat: number; base: PriceLine[] } {
  return {
    vat: sum(lines.filter((l) => l.kind === "vat").map((l) => l.totalCents)),
    base: lines.filter((l) => VAT_BASE_KINDS.includes(l.kind)),
  };
}

/** The rate these amounts come to. Never an assumed rate. */
export function derivedRate(vatCents: number, baseCents: number): number {
  return baseCents > 0 && vatCents > 0
    ? Math.round((vatCents * 10_000) / baseCents)
    : 0;
}

/**
 * Shares VAT across lines in proportion to their amounts, so the document's
 * VAT adds up to exactly what the guest was charged. Cents left by rounding go
 * to the lines that lost the most.
 */
export function spreadVat(amounts: number[], vatCents: number): number[] {
  const base = sum(amounts);
  if (base <= 0) return amounts.map(() => 0);
  const shares = amounts.map((amount) => {
    const scaled = vatCents * amount;
    const share = Math.floor(scaled / base);
    return { share, left: scaled - share * base };
  });
  const order = shares
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.left - a.left || a.index - b.index);
  const extra = vatCents - sum(shares.map((entry) => entry.share));
  for (const { index } of order.slice(0, extra)) shares[index].share += 1;
  return shares.map((entry) => entry.share);
}

function fullLines(lines: PriceLine[]): DocumentLine[] {
  const { vat, base } = vatOf(lines);
  const baseCents = sum(base.map((line) => line.totalCents));
  const shares = spreadVat(
    base.map((line) => line.totalCents),
    vat,
  );
  const rate = derivedRate(vat, baseCents);
  // With nothing to share it across, VAT stays visible as its own line.
  const canSpread = baseCents > 0;

  return lines.flatMap((line): DocumentLine[] => {
    const shared = {
      description: bilingual(line.label),
      quantity: line.quantity,
      unitCents: line.unitCents,
    };
    if (line.kind === "vat") {
      if (canSpread) return [];
      const { totalCents } = line;
      return [
        {
          ...shared,
          totalCents,
          vatCents: totalCents,
          vatBasisPoints: 0,
          kind: "other",
        },
      ];
    }
    const index = base.indexOf(line);
    const vatCents = index >= 0 ? shares[index] : 0;
    return [
      {
        ...shared,
        totalCents: line.totalCents + vatCents,
        vatCents,
        vatBasisPoints: index >= 0 ? rate : 0,
        kind: LINE_KINDS.includes(line.kind)
          ? (line.kind as LineKind)
          : "other",
      },
    ];
  });
}

const SINGLE_LINE: Record<
  PaymentKind,
  { kind: LineKind; el: string; en: string }
> = {
  full: { kind: "other", el: "Πληρωμή κράτησης", en: "Payment for booking" },
  extra: { kind: "other", el: "Πληρωμή κράτησης", en: "Payment for booking" },
  deposit: {
    kind: "deposit",
    el: "Προκαταβολή κράτησης",
    en: "Deposit for booking",
  },
  balance: {
    kind: "balance",
    el: "Υπόλοιπο κράτησης",
    en: "Balance for booking",
  },
};

export interface PaymentLineInput {
  reference: string;
  /** bookings.price_breakdown, as stored. */
  breakdown: unknown;
  payment: { kind: PaymentKind; amountCents: number };
}

export interface BuiltLines {
  lines: DocumentLine[];
  /** True when one line stands for the whole payment. */
  isSingleLine: boolean;
}

/**
 * ASSUMPTION, flagged for the accountant: each payment gets its own document.
 * A full payment lists the booking's lines. A deposit or balance is one line,
 * with VAT in proportion to the booking, so the climate fee is not shown apart
 * on those two documents. A deposit and its balance always add up to the
 * booking's VAT. Question 6 on docs/accountant-questions.md decides this.
 */
export function buildPaymentLines(input: PaymentLineInput): BuiltLines {
  const { reference, payment } = input;
  const parsed = breakdownSchema.safeParse(input.breakdown);
  const breakdown = parsed.success ? parsed.data : null;

  const matchesBooking =
    breakdown !== null &&
    sum(breakdown.lines.map((line) => line.totalCents)) ===
      breakdown.totalCents &&
    payment.amountCents === breakdown.totalCents;

  if (payment.kind === "full" && matchesBooking) {
    return { lines: fullLines(breakdown.lines), isSingleLine: false };
  }

  const amount = payment.amountCents;
  const bookingTotal = breakdown?.totalCents ?? 0;
  const { vat, base } = vatOf(breakdown?.lines ?? []);
  const shareVat =
    payment.kind === "balance"
      ? vat - roundedShare(vat, bookingTotal - amount, bookingTotal)
      : roundedShare(vat, amount, bookingTotal);
  const vatCents = Math.min(Math.max(shareVat, 0), amount);
  const { kind, el, en } = SINGLE_LINE[payment.kind];

  return {
    isSingleLine: true,
    lines: [
      {
        description: `${el} ${reference} / ${en} ${reference}`,
        quantity: 1,
        unitCents: amount - vatCents,
        totalCents: amount,
        vatCents,
        vatBasisPoints: derivedRate(
          vat,
          sum(base.map((line) => line.totalCents)),
        ),
        kind,
      },
    ],
  };
}

export interface CreditInput {
  documentNumber: string;
  totalCents: number;
  vatCents: number;
  lines: DocumentLine[];
  /** Earlier credit notes against this document. */
  creditedCents: number;
  creditedVatCents: number;
  amountCents: number;
}

/**
 * Amounts are positive: the document type makes them a credit. Crediting a
 * whole document repeats its lines. ASSUMPTION, flagged for the accountant:
 * anything less is one line with VAT in proportion, and the climate fee is not
 * split out of it (question 10).
 */
export function buildCreditLines(input: CreditInput): DocumentLine[] {
  const { amountCents, totalCents, creditedCents } = input;
  const remaining = totalCents - creditedCents;

  if (creditedCents === 0 && amountCents === totalCents) {
    return input.lines.map((line) => ({ ...line }));
  }

  const remainingVat = input.vatCents - input.creditedVatCents;
  const shareVat =
    amountCents === remaining
      ? remainingVat
      : roundedShare(input.vatCents, amountCents, totalCents);
  const vatCents = Math.min(Math.max(shareVat, 0), amountCents, remainingVat);
  const rate =
    input.lines.find((line) => line.vatBasisPoints > 0)?.vatBasisPoints ?? 0;

  return [
    {
      description: `Πίστωση του ${input.documentNumber} / Credit against ${input.documentNumber}`,
      quantity: 1,
      unitCents: amountCents - vatCents,
      totalCents: amountCents,
      vatCents,
      vatBasisPoints: rate,
      kind: "other",
    },
  ];
}

export interface VatRow {
  basisPoints: number;
  baseCents: number;
  vatCents: number;
}

/** One row per rate. Fees are outside VAT, so they are not in any row. */
export function vatBreakdown(lines: DocumentLine[]): VatRow[] {
  const rows = new Map<number, VatRow>();
  for (const line of lines) {
    if (line.kind === "fee") continue;
    const row = rows.get(line.vatBasisPoints) ?? {
      basisPoints: line.vatBasisPoints,
      baseCents: 0,
      vatCents: 0,
    };
    row.baseCents += line.totalCents - line.vatCents;
    row.vatCents += line.vatCents;
    rows.set(line.vatBasisPoints, row);
  }
  return [...rows.values()].sort((a, b) => b.basisPoints - a.basisPoints);
}

/** A document whose single line stands in for a deposit or balance. */
export const hasSingleLineAssumption = (lines: { kind: string }[]): boolean =>
  lines.some((line) => line.kind === "deposit" || line.kind === "balance");
