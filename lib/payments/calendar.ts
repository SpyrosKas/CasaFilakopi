import type { IsoDate } from "@/lib/domain/contracts";
import { addDays, dayOfWeek } from "@/lib/domain/dates";

// How the calendar behaves. Pure, and safe in the browser. The server checks
// every rule again, so this is only about showing the right thing.

export interface StayLengthRule {
  from: IsoDate;
  to: IsoDate;
  min: number | null;
  max: number | null;
}

export interface CalendarRules {
  firstCheckIn: IsoDate;
  lastNight: IsoDate;
  taken: ReadonlySet<IsoDate>;
  /** Shortest and longest stay. Missing means any length. */
  minNights?: number;
  maxNights?: number;
  stayRules?: readonly StayLengthRule[];
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
 * The same rule as stayLengthLimits on the server: the general setting,
 * narrowed by every stay rule covering the check-in date.
 */
export function nightsAllowed(
  checkIn: IsoDate,
  rules: CalendarRules,
): { min: number; max: number } {
  let min = rules.minNights ?? 1;
  let max = rules.maxNights ?? Number.POSITIVE_INFINITY;
  for (const rule of rules.stayRules ?? []) {
    if (rule.from > checkIn || checkIn > rule.to) continue;
    if (rule.min !== null) min = Math.max(min, rule.min);
    if (rule.max !== null) max = Math.min(max, rule.max);
  }
  return { min, max };
}

/** Every night from check-in up to the date is on sale and free. */
const nightsFree = (checkIn: IsoDate, date: IsoDate, rules: CalendarRules) => {
  if (date <= checkIn || addDays(date, -1) > rules.lastNight) return false;
  for (let night = checkIn; night < date; night = addDays(night, 1)) {
    if (rules.taken.has(night)) return false;
  }
  return true;
};

const nightsBetween = (from: IsoDate, to: IsoDate) =>
  Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );

export type LengthProblem =
  { kind: "short"; nights: number } | { kind: "long"; nights: number };

/**
 * Why a departure the guest tapped cannot end their stay, when the nights are
 * free but the stay is shorter or longer than Yorgos allows.
 */
export function stayLengthProblem(
  date: IsoDate,
  selection: Selection,
  rules: CalendarRules,
): LengthProblem | null {
  const { checkIn, checkOut } = selection;
  if (!checkIn || checkOut || !nightsFree(checkIn, date, rules)) return null;
  const nights = nightsBetween(checkIn, date);
  const { min, max } = nightsAllowed(checkIn, rules);
  if (nights < min) return { kind: "short", nights: min };
  if (nights > max) return { kind: "long", nights: max };
  return null;
}

/**
 * A guest can leave on a taken date, since that night is someone else's. Every
 * night before it must be free.
 */
export function canCheckOut(
  date: IsoDate,
  checkIn: IsoDate,
  rules: CalendarRules,
): boolean {
  if (!nightsFree(checkIn, date, rules)) return false;
  const nights = nightsBetween(checkIn, date);
  const { min, max } = nightsAllowed(checkIn, rules);
  return nights >= min && nights <= max;
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
  // Too short or too long: keep the arrival, and the calendar says why.
  if (stayLengthProblem(date, selection, rules)) return selection;
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
    canCheckOut(date, selection.checkIn, rules)) ||
  stayLengthProblem(date, selection, rules) !== null;
