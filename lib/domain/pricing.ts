import type { Tables } from "@/lib/db/types";
import type { Cents, IsoDate, PriceLine, StayRequest } from "./contracts";
import { dayOfWeek, eachNight } from "./dates";
import { assertCents, sumCents } from "./money";

export type RoomRates = Pick<
  Tables<"rooms">,
  | "base_price_cents"
  | "base_occupancy"
  | "extra_guest_fee_cents"
  | "cleaning_fee_cents"
>;

export type SeasonRow = Pick<
  Tables<"seasons">,
  "start_date" | "end_date" | "nightly_cents" | "weekend_cents"
>;

export type RateOverrideRow = Pick<
  Tables<"rate_overrides">,
  "night" | "nightly_cents"
>;

export const LINE_LABELS = {
  accommodation: { en: "Accommodation", el: "Διαμονή" },
  extra_guest: { en: "Extra guests", el: "Επιπλέον επισκέπτες" },
  cleaning: { en: "Cleaning fee", el: "Τέλος καθαρισμού" },
  discount: { en: "Discount", el: "Έκπτωση" },
};

/** A night's weekend status follows the date it starts on. */
function nightRate(
  night: IsoDate,
  room: RoomRates,
  seasons: SeasonRow[],
  overrides: Map<IsoDate, Cents>,
  weekendDays: number[],
): Cents {
  const override = overrides.get(night);
  if (override !== undefined) return override;

  const season = seasons.find(
    (row) => row.start_date <= night && night <= row.end_date,
  );
  if (!season) return room.base_price_cents;

  const isWeekend = weekendDays.includes(dayOfWeek(night));
  return isWeekend
    ? (season.weekend_cents ?? season.nightly_cents)
    : season.nightly_cents;
}

export interface NightlyPricesInput {
  stay: StayRequest;
  room: RoomRates;
  seasons: SeasonRow[];
  overrides: RateOverrideRow[];
  weekendDays: number[];
}

/** Precedence: rate override, then season, then the room's base price. */
export function nightlyPrices({
  stay,
  room,
  seasons,
  overrides,
  weekendDays,
}: NightlyPricesInput): { night: IsoDate; cents: Cents }[] {
  const byNight = new Map(
    overrides.map((row) => [row.night, row.nightly_cents]),
  );
  return eachNight(stay.checkIn, stay.checkOut).map((night) => ({
    night,
    cents: nightRate(night, room, seasons, byNight, weekendDays),
  }));
}

/** One line per distinct rate: "3 nights at 220", "2 nights at 240". */
function accommodationLines(nights: { cents: Cents }[]): PriceLine[] {
  const countByRate = new Map<Cents, number>();
  for (const { cents } of nights) {
    countByRate.set(cents, (countByRate.get(cents) ?? 0) + 1);
  }
  return [...countByRate].map(([unitCents, quantity]) => ({
    kind: "accommodation",
    label: LINE_LABELS.accommodation,
    quantity,
    unitCents,
    totalCents: unitCents * quantity,
  }));
}

/**
 * Charged per extra guest per night. Children count as guests.
 * BUSINESS DECISION, flagged for Yorgos.
 */
function extraGuestLines(
  room: RoomRates,
  stay: StayRequest,
  nights: number,
): PriceLine[] {
  const extraGuests = stay.adults + stay.children - room.base_occupancy;
  const unitCents = room.extra_guest_fee_cents;
  if (extraGuests <= 0 || unitCents === 0) return [];
  const quantity = extraGuests * nights;
  return [
    {
      kind: "extra_guest",
      label: LINE_LABELS.extra_guest,
      quantity,
      unitCents,
      totalCents: unitCents * quantity,
    },
  ];
}

function cleaningLines(room: RoomRates): PriceLine[] {
  const unitCents = room.cleaning_fee_cents;
  if (unitCents === 0) return [];
  return [
    {
      kind: "cleaning",
      label: LINE_LABELS.cleaning,
      quantity: 1,
      unitCents,
      totalCents: unitCents,
    },
  ];
}

/** The lines for what the house itself charges, before discount and fees. */
export function stayLines(
  room: RoomRates,
  stay: StayRequest,
  nights: { cents: Cents }[],
): PriceLine[] {
  const lines = [
    ...accommodationLines(nights),
    ...extraGuestLines(room, stay, nights.length),
    ...cleaningLines(room),
  ];
  lines.forEach((line) => assertCents(line.totalCents, line.kind));
  return lines;
}

export const linesTotal = (lines: PriceLine[]): Cents =>
  sumCents(lines.map((line) => line.totalCents));
