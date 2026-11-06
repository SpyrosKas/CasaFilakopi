import { hasValidDates, MAX_STAY_NIGHTS } from "./availability";
import type {
  PaymentRules,
  PriceBreakdown,
  PriceLine,
  StayRejection,
  StayRequest,
} from "./contracts";
import { athensDate, daysBetween } from "./dates";
import { feeLines, type TaxFeeRow } from "./fees";
import { assertCents } from "./money";
import { splitPayment } from "./payments";
import {
  LINE_LABELS,
  linesTotal,
  nightlyPrices,
  stayLines,
  type RateOverrideRow,
  type RoomRates,
  type SeasonRow,
} from "./pricing";
import {
  checkPromo,
  promoDiscount,
  PROMO_DISCOUNTS_CLEANING,
  type PromoRow,
} from "./promos";

/** Raised when a stay cannot be priced at all. */
export class QuoteError extends Error {
  constructor(readonly code: StayRejection) {
    super(code);
    this.name = "QuoteError";
  }
}

export interface BreakdownInput {
  stay: StayRequest;
  room: RoomRates;
  seasons: SeasonRow[];
  overrides: RateOverrideRow[];
  fees: TaxFeeRow[];
  weekendDays: number[];
  payment: PaymentRules;
  /** The code the guest typed, if any. */
  promoCode?: string;
  /** The row matching promoCode, or null if there is none. */
  promo: PromoRow | null;
  now: Date;
}

function discountLines(discountCents: number): PriceLine[] {
  if (discountCents === 0) return [];
  return [
    {
      kind: "discount",
      label: LINE_LABELS.discount,
      quantity: 1,
      unitCents: -discountCents,
      totalCents: -discountCents,
    },
  ];
}

/**
 * Pure. Assumes checkStay already passed: this prices a stay, it does not say
 * whether the stay may be sold. The total is always the sum of the lines.
 */
export function buildPriceBreakdown(input: BreakdownInput): PriceBreakdown {
  const { stay, room, fees, payment, now } = input;
  if (!hasValidDates(stay)) throw new QuoteError("invalid_dates");

  if (daysBetween(stay.checkIn, stay.checkOut) > MAX_STAY_NIGHTS) {
    throw new QuoteError("above_max_stay");
  }
  assertCents(stay.adults, "adults");
  assertCents(stay.children, "children");

  const nights = nightlyPrices(input);
  const today = athensDate(now);
  const houseLines = stayLines(room, stay, nights);

  const promoCheck = input.promoCode?.trim()
    ? checkPromo(input.promo, stay.roomId, today)
    : null;
  const promo = promoCheck?.ok ? promoCheck.promo : null;
  const discountable = houseLines.filter(
    (line) => PROMO_DISCOUNTS_CLEANING || line.kind !== "cleaning",
  );
  const discountCents = promo
    ? promoDiscount(promo, linesTotal(discountable))
    : 0;

  const lines = [
    ...houseLines,
    ...discountLines(discountCents),
    ...feeLines({
      fees,
      nights: nights.map(({ night }) => night),
      guests: stay.adults + stay.children,
      percentBaseCents: linesTotal(houseLines) - discountCents,
    }),
  ];
  const totalCents = linesTotal(lines);

  return {
    currency: "EUR",
    nights,
    lines,
    totalCents,
    ...splitPayment({
      totalCents,
      rules: payment,
      checkIn: stay.checkIn,
      today,
    }),
    promoCode: promo?.code ?? null,
    ...(promoCheck && !promoCheck.ok
      ? { promoRejection: promoCheck.reason }
      : {}),
  };
}
