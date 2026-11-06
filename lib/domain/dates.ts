import type { IsoDate } from "./contracts";

// Calendar dates are plain YYYY-MM-DD strings. Arithmetic goes through UTC
// midnights, which have no DST, so the server's time zone never matters.
// Only `athensDate` and `athensHour` turn an instant into local time.

export const PROPERTY_TIME_ZONE = "Europe/Athens";

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcMs(date: IsoDate): number {
  if (!isValidIsoDate(date)) {
    throw new RangeError(`Invalid date: ${date}`);
  }
  return Date.parse(`${date}T00:00:00Z`);
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

/** True only for a real calendar date, so 2027-02-29 is rejected. */
export function isValidIsoDate(date: unknown): date is IsoDate {
  if (typeof date !== "string" || !ISO_DATE.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return !Number.isNaN(ms) && fromUtcMs(ms) === date;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * MS_PER_DAY);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return (toUtcMs(to) - toUtcMs(from)) / MS_PER_DAY;
}

/** Keeps the day of month, clamped: 31 August plus 18 months is 29 February. */
export function addMonths(date: IsoDate, months: number): IsoDate {
  const start = new Date(toUtcMs(date));
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return fromUtcMs(
    Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay)),
  );
}

/** 0 is Sunday, matching restrictions.allowed_check_in_days. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** The nights of a stay, [checkIn, checkOut). The check-out date is excluded. */
export function eachNight(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const count = Math.max(daysBetween(checkIn, checkOut), 0);
  return Array.from({ length: count }, (_, i) => addDays(checkIn, i));
}

const athensFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: PROPERTY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

function athensParts(now: Date): Record<string, string> {
  return Object.fromEntries(
    athensFormat.formatToParts(now).map((part) => [part.type, part.value]),
  );
}

/** The calendar date on Milos at this instant. */
export function athensDate(now: Date): IsoDate {
  const { year, month, day } = athensParts(now);
  return `${year}-${month}-${day}`;
}

/** The hour on the clock on Milos at this instant, 0 to 23. */
export function athensHour(now: Date): number {
  return Number(athensParts(now).hour);
}
