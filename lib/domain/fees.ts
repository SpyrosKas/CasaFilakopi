import type { Json, Tables } from "@/lib/db/types";
import type { Cents, IsoDate, PriceLine } from "./contracts";
import { basisPointsOf } from "./money";

// Taxes and fees are data. No rate is written in code, and VAT applies only
// when an active taxes_fees row says so (D4 is still open with the accountant).
//
// Validity (valid_from, valid_to, both inclusive) is tested against the stay,
// never the booking date:
// - per_night and per_guest_night count only the nights inside the window, so
//   a fee whose amount changes at a season boundary is split across the stay.
// - per_stay and percent have no nights to split, so the check-in date decides.
//
// BUSINESS DECISION, flagged for the accountant: percent rows, VAT included,
// apply to the house's charges after discount (accommodation, extra guests,
// cleaning). They do not compound, and fixed fees such as the climate
// resilience fee are outside the base. VAT is added on top of those prices;
// VAT-inclusive prices would need a change here.

export type TaxFeeRow = Pick<
  Tables<"taxes_fees">,
  | "name"
  | "kind"
  | "amount_cents"
  | "rate_basis_points"
  | "is_vat"
  | "valid_from"
  | "valid_to"
  | "is_active"
  | "sort_order"
>;

function labelFrom(name: Json): Record<string, string> {
  return Object.fromEntries(
    Object.entries(name as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const isWithin = (date: IsoDate, row: TaxFeeRow) =>
  (row.valid_from === null || row.valid_from <= date) &&
  (row.valid_to === null || date <= row.valid_to);

export interface FeeInput {
  fees: TaxFeeRow[];
  nights: IsoDate[];
  guests: number;
  /** The house's charges after discount, the base for percent rows. */
  percentBaseCents: Cents;
}

function feeAmount(
  row: TaxFeeRow,
  { nights, guests, percentBaseCents }: FeeInput,
): { quantity: number; unitCents: Cents } {
  const amount = row.amount_cents ?? 0;
  const nightsInWindow = nights.filter((night) => isWithin(night, row)).length;
  const onCheckIn = isWithin(nights[0], row) ? 1 : 0;

  switch (row.kind) {
    case "percent":
      return {
        quantity: onCheckIn,
        unitCents: basisPointsOf(percentBaseCents, row.rate_basis_points ?? 0),
      };
    case "per_stay":
      return { quantity: onCheckIn, unitCents: amount };
    case "per_night":
      return { quantity: nightsInWindow, unitCents: amount };
    case "per_guest_night":
      return { quantity: nightsInWindow * guests, unitCents: amount };
  }
}

/** Rows that come to nothing leave no line, so a guest never sees a zero fee. */
export function feeLines(input: FeeInput): PriceLine[] {
  return input.fees
    .filter((row) => row.is_active)
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap((row): PriceLine[] => {
      const { quantity, unitCents } = feeAmount(row, input);
      const totalCents = quantity * unitCents;
      if (totalCents === 0) return [];
      return [
        {
          kind: row.is_vat ? "vat" : "fee",
          label: labelFrom(row.name),
          quantity,
          unitCents,
          totalCents,
        },
      ];
    });
}
