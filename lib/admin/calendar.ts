import type { BookingSource, Stay } from "@/lib/admin/stays";
import { addDays, addMonths, dayOfWeek, eachNight } from "@/lib/domain/dates";

// The month view. A square on the calendar stands for that date's night, so a
// guest leaving on the 5th does not colour the 5th. Pure, and safe in the
// browser.

export type NightKind =
  "free" | "direct" | "airbnb" | "booking_com" | "hold" | "block" | "other";

export interface CalendarBlock {
  id: string;
  start: string;
  /** Exclusive, like a check-out. */
  end: string;
  reason: string;
  note: string | null;
}

export interface NightState {
  date: string;
  kind: NightKind;
  /** A second claim on the same night: an import that collided. */
  isConflict: boolean;
  href: string | null;
  blockId: string | null;
  isArrival: boolean;
  isDeparture: boolean;
  label: string | null;
}

export interface MonthEntry {
  key: string;
  kind: NightKind;
  title: string;
  start: string;
  end: string;
  href: string | null;
}

const SOURCE_KIND: Record<BookingSource, NightKind> = {
  direct: "direct",
  manual: "direct",
  airbnb: "airbnb",
  booking_com: "booking_com",
  other: "other",
};

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);
}

export const shiftMonth = (month: string, by: number): string =>
  addMonths(`${month}-01`, by).slice(0, 7);

/** All dates of a month. */
export const monthDates = (month: string): string[] =>
  eachNight(`${month}-01`, `${shiftMonth(month, 1)}-01`);

/** Empty squares before the 1st, on a week starting on Monday. */
export const leadingBlanks = (month: string): number =>
  (dayOfWeek(`${month}-01`) + 6) % 7;

export const dayNumber = (date: string): number => Number(date.slice(8));

const blockTitle = (block: CalendarBlock, reasons: Record<string, string>) =>
  block.note
    ? `${reasons[block.reason]}: ${block.note}`
    : reasons[block.reason];

/** What each night of the month holds, and the list shown under the grid. */
export function buildMonth(
  month: string,
  stays: Stay[],
  blocks: CalendarBlock[],
  words: { reasons: Record<string, string>; noName: string; hold: string },
): { nights: NightState[]; entries: MonthEntry[] } {
  const dates = monthDates(month);
  const first = dates[0];
  const end = addDays(dates[dates.length - 1], 1);
  const nights = new Map<string, NightState>(
    dates.map((date) => [
      date,
      {
        date,
        kind: "free",
        isConflict: false,
        href: null,
        blockId: null,
        isArrival: false,
        isDeparture: false,
        label: null,
      },
    ]),
  );

  const entries: MonthEntry[] = [];
  const claim = (
    start: string,
    stop: string,
    fields: Pick<NightState, "kind" | "href" | "blockId" | "label">,
  ) => {
    for (const date of eachNight(start, stop)) {
      const night = nights.get(date);
      if (!night) continue;
      if (night.kind !== "free") {
        night.isConflict = true;
        continue;
      }
      Object.assign(night, fields);
    }
  };

  const shown = stays.filter(
    (stay) =>
      stay.checkIn < end &&
      stay.checkOut > first &&
      [
        "confirmed",
        "checked_in",
        "completed",
        "imported",
        "pending_payment",
      ].includes(stay.status),
  );

  for (const stay of shown) {
    const kind =
      stay.status === "pending_payment" ? "hold" : SOURCE_KIND[stay.source];
    const title =
      stay.status === "pending_payment"
        ? words.hold
        : (stay.name ?? stay.summary ?? words.noName);
    claim(stay.checkIn, stay.checkOut, {
      kind,
      href: stay.href,
      blockId: null,
      label: title,
    });
    const arrival = nights.get(stay.checkIn);
    if (arrival) arrival.isArrival = true;
    const departure = nights.get(stay.checkOut);
    if (departure) departure.isDeparture = true;
    entries.push({
      key: stay.id,
      kind,
      title,
      start: stay.checkIn,
      end: stay.checkOut,
      href: stay.href,
    });
  }

  for (const block of blocks) {
    if (block.start >= end || block.end <= first) continue;
    const title = blockTitle(block, words.reasons);
    claim(block.start, block.end, {
      kind: "block",
      href: null,
      blockId: block.id,
      label: title,
    });
    entries.push({
      key: block.id,
      kind: "block",
      title,
      start: block.start,
      end: block.end,
      href: null,
    });
  }

  entries.sort((a, b) => a.start.localeCompare(b.start));
  return { nights: dates.map((date) => nights.get(date)!), entries };
}
