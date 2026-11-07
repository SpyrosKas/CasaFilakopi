import type { IsoDate } from "@/lib/domain/contracts";
import { addDays, dayOfWeek } from "@/lib/domain/dates";

// How the calendar behaves. Pure, and safe in the browser. The server checks
// every rule again, so this is only about showing the right thing.

export interface CalendarRules {
  firstCheckIn: IsoDate;
  lastNight: IsoDate;
  taken: ReadonlySet<IsoDate>;
}

export interface Selection {
  checkIn: IsoDate | null;
  checkOut: IsoDate | null;
}

export const monthKey = (date: IsoDate) => date.slice(0, 7);

export function shiftMonth(month: string, by: number): string {
  const [year, index] = month.split("-").map(Number);
  const moved = new Date(Date.UTC(year, index - 1 + by, 1));
  return moved.toISOString().slice(0, 7);
}

/** A month as weeks from Monday. Null cells pad the first and last week. */
export function monthWeeks(month: string): (IsoDate | null)[][] {
  const first = `${month}-01`;
  const cells: (IsoDate | null)[] = Array.from(
    { length: (dayOfWeek(first) + 6) % 7 },
    () => null,
  );
  for (let date = first; monthKey(date) === month; date = addDays(date, 1)) {
    cells.push(date);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) =>
    cells.slice(week * 7, week * 7 + 7),
  );
}

export const canCheckIn = (date: IsoDate, rules: CalendarRules) =>
  date >= rules.firstCheckIn &&
  date <= rules.lastNight &&
  !rules.taken.has(date);

/**
 * A guest can leave on a taken date, since that night is someone else's. Every
 * night before it must be free.
 */
export function canCheckOut(
  date: IsoDate,
  checkIn: IsoDate,
  rules: CalendarRules,
): boolean {
  if (date <= checkIn || addDays(date, -1) > rules.lastNight) return false;
  for (let night = checkIn; night < date; night = addDays(night, 1)) {
    if (rules.taken.has(night)) return false;
  }
  return true;
}

/** What a tap does: start a stay, finish it, or start again. */
export function pickDate(
  selection: Selection,
  date: IsoDate,
  rules: CalendarRules,
): Selection {
  const { checkIn, checkOut } = selection;
  if (checkIn && !checkOut && canCheckOut(date, checkIn, rules)) {
    return { checkIn, checkOut: date };
  }
  return canCheckIn(date, rules)
    ? { checkIn: date, checkOut: null }
    : selection;
}

export const isDateEnabled = (
  date: IsoDate,
  selection: Selection,
  rules: CalendarRules,
) =>
  canCheckIn(date, rules) ||
  (!!selection.checkIn &&
    !selection.checkOut &&
    canCheckOut(date, selection.checkIn, rules));
