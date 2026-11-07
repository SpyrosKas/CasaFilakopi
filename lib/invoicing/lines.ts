import { z } from "zod";
import type { DocumentLine, LineKind, PaymentKind } from "./types";

// Turns a booking's stored price into document lines. No VAT rate is written
// here: VAT comes only from `vat` lines in bookings.price_breakdown, which the
// pricing engine adds on top of the house's charges after discount (see
// lib/domain/fees.ts). The rate on a document is worked out from those lines.

const priceLine = z.object({
  kind: z.string(),
  label: z.record(z.string(), z.string()),
  quantity: z.number(),
  unitCents: z.number().int(),
  totalCents: z.number().int(),
});

const breakdownSchema = z
  .object({
    lines: z.array(priceLine).min(1),
    totalCents: z.number().int().positive(),
  })
  .refine(
    ({ lines, totalCents }) =>
      lines.reduce((sum, line) => sum + line.totalCents, 0) === totalCents,
  );

type PriceLine = z.output<typeof priceLine>;

/** The charges VAT is worked out on (lib/domain/breakdown.ts). */
const VAT_BASE_KINDS = ["accommodation", "extra_guest", "cleaning", "discount"];
const LINE_KINDS: string[] = [...VAT_BASE_KINDS, "fee"];

/** The kinds that rest on an assumption the accountant must confirm. */
const TO_CONFIRM_KINDS: string[] = ["deposit", "balance", "other"];

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

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

interface Split {
  vat: number;
  fee: number;
  base: PriceLine[];
  fees: PriceLine[];
}

function splitOf(lines: PriceLine[]): Split {
  const total = (kind: string) =>
    sum(lines.filter((l) => l.kind === kind).map((l) => l.totalCents));
  return {
    vat: total("vat"),
    fee: total("fee"),
    base: lines.filter((l) => VAT_BASE_KINDS.includes(l.kind)),
    fees: lines.filter((l) => l.kind === "fee"),
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
  const { vat, base } = splitOf(lines);
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

const SHARE_LINE: Record<
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

const FEES_LABEL = "Τέλη εκτός ΦΠΑ / Fees outside VAT";

function feeLabel(fees: PriceLine[]): string {
  const label = fees.length === 1 ? bilingual(fees[0].label) : FEES_LABEL;
  return label || FEES_LABEL;
}

/** One line for the taxable part and one for the fee, which VAT never touches. */
function twoLines(input: {
  description: string;
  kind: LineKind;
  amountCents: number;
  feeCents: number;
  vatCents: number;
  vatBasisPoints: number;
  feeDescription: string;
}): DocumentLine[] {
  const { amountCents, feeCents, vatCents } = input;
  const taxable = amountCents - feeCents;
  const lines: DocumentLine[] = [];
  if (taxable > 0) {
    lines.push({
      description: input.description,
      quantity: 1,
      unitCents: taxable - vatCents,
      totalCents: taxable,
      vatCents,
      vatBasisPoints: input.vatBasisPoints,
      kind: input.kind,
    });
  }
  if (feeCents > 0) {
    lines.push({
      description: input.feeDescription,
      quantity: 1,
      unitCents: feeCents,
      totalCents: feeCents,
      vatCents: 0,
      vatBasisPoints: 0,
      kind: "fee",
    });
  }
  return lines;
}

export interface PaymentLineInput {
  reference: string;
  /** bookings.price_breakdown, as stored. */
  breakdown: unknown;
  payment: {
    kind: PaymentKind;
    amountCents: number;
    /** Money kept on a cancelled booking, which is not the booking's price. */
    isRetained?: boolean;
  };
}

export type BuiltLines =
  | {
      ok: true;
      lines: DocumentLine[];
      /** True when the amounts rest on an assumption for the accountant. */
      needsConfirmation: boolean;
    }
  /** The stored price cannot be read, so no honest document can be made. */
  | { ok: false };

/**
 * ASSUMPTION, flagged for the accountant: each payment gets its own document.
 * A full payment lists the booking's lines. Anything else is a share of the
 * booking: one line for the taxable part and one for the climate fee, both in
 * proportion, so the fee stays outside the VAT base. A deposit and its balance
 * always add up to the booking's figures. Question 6 on
 * docs/accountant-questions.md decides this; question 7 decides money kept on
 * a cancelled booking.
 */
export function buildPaymentLines(input: PaymentLineInput): BuiltLines {
  const { reference, payment } = input;
  const parsed = breakdownSchema.safeParse(input.breakdown);
  if (!parsed.success) return { ok: false };
  const breakdown = parsed.data;
  const amount = payment.amountCents;
  const kind = payment.isRetained ? "extra" : payment.kind;

  if (kind === "full" && amount === breakdown.totalCents) {
    return {
      ok: true,
      lines: fullLines(breakdown.lines),
      needsConfirmation: false,
    };
  }

  const { vat, fee, base, fees } = splitOf(breakdown.lines);
  const total = breakdown.totalCents;
  // A balance takes what the deposit left, so the two always add up.
  const shareOf = (value: number) =>
    kind === "balance"
      ? value - roundedShare(value, total - amount, total)
      : roundedShare(value, amount, total);
  const feeCents = clamp(shareOf(fee), 0, amount);
  const vatCents = clamp(shareOf(vat), 0, amount - feeCents);
  const line = SHARE_LINE[kind];

  return {
    ok: true,
    needsConfirmation: true,
    lines: twoLines({
      description: `${line.el} ${reference} / ${line.en} ${reference}`,
      kind: line.kind,
      amountCents: amount,
      feeCents,
      vatCents,
      vatBasisPoints: derivedRate(
        vat,
        sum(base.map((entry) => entry.totalCents)),
      ),
      feeDescription: `${feeLabel(fees)} (αναλογία / share)`,
    }),
  };
}

export interface CreditInput {
  documentNumber: string;
  totalCents: number;
  vatCents: number;
  feeCents: number;
  lines: DocumentLine[];
  /** Earlier credit notes against this document. */
  creditedCents: number;
  creditedVatCents: number;
  creditedFeeCents: number;
  amountCents: number;
}

/**
 * Amounts are positive: the document type makes them a credit. Crediting a
 * whole document repeats its lines. ASSUMPTION, flagged for the accountant:
 * anything less is a share, a taxable line and a fee line in proportion
 * (question 10), and the last part uses up exactly what is left.
 */
export function buildCreditLines(input: CreditInput): DocumentLine[] {
  const { amountCents, totalCents, creditedCents } = input;
  const remaining = totalCents - creditedCents;

  if (creditedCents === 0 && amountCents === totalCents) {
    return input.lines.map((line) => ({ ...line }));
  }

  const leftVat = input.vatCents - input.creditedVatCents;
  const leftFee = input.feeCents - input.creditedFeeCents;
  const isLast = amountCents === remaining;
  const shareOf = (value: number, left: number) =>
    isLast ? left : roundedShare(value, amountCents, totalCents);
  const feeCents = clamp(
    shareOf(input.feeCents, leftFee),
    0,
    Math.min(amountCents, leftFee),
  );
  const vatCents = clamp(
    shareOf(input.vatCents, leftVat),
    0,
    Math.min(amountCents - feeCents, leftVat),
  );
  const number = input.documentNumber;

  return twoLines({
    description: `Πίστωση του ${number} / Credit against ${number}`,
    kind: "other",
    amountCents,
    feeCents,
    vatCents,
    vatBasisPoints:
      input.lines.find((line) => line.vatBasisPoints > 0)?.vatBasisPoints ?? 0,
    feeDescription: `Πίστωση τελών του ${number} / Fees credited on ${number}`,
  });
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

/** A document whose amounts rest on an assumption for the accountant. */
export const needsAccountantCheck = (lines: { kind: string }[]): boolean =>
  lines.some((line) => TO_CONFIRM_KINDS.includes(line.kind));
