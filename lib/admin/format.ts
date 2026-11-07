import { ADMIN_DATE_LOCALE, t } from "@/lib/admin/strings";
import { PROPERTY_TIME_ZONE } from "@/lib/domain/dates";

// How the admin panel writes money and dates. Safe in the browser too.

/** Integer maths only, so a displayed amount can never pick up a rounding slip. */
export function formatEuro(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}€${grouped}.${part}`;
}

/** For a box he can edit: 1250 becomes 12.50. */
export const centsToBox = (cents: number | null | undefined): string =>
  cents === null || cents === undefined
    ? ""
    : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;

const EURO_TEXT = /^(\d{1,7})(?:[.,](\d{1,2}))?$/;

/**
 * Whole cents from what was typed, with no floats. Greek phone keyboards type
 * a comma. Null when the text is not an amount.
 */
export function parseEuros(text: string): number | null {
  const match = EURO_TEXT.exec(text.trim().replace(/^€\s*/, ""));
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

const dateFormat = new Intl.DateTimeFormat(ADMIN_DATE_LOCALE, {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortFormat = new Intl.DateTimeFormat(ADMIN_DATE_LOCALE, {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const monthFormat = new Intl.DateTimeFormat(ADMIN_DATE_LOCALE, {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const stampFormat = new Intl.DateTimeFormat(ADMIN_DATE_LOCALE, {
  timeZone: PROPERTY_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** A stay date, such as Sat 7 Nov 2026. */
export const formatDate = (date: string): string =>
  dateFormat.format(utc(date)).replace(",", "");

export const formatShortDate = (date: string): string =>
  shortFormat.format(utc(date));

export const formatStay = (checkIn: string, checkOut: string): string =>
  t.common.dateRange(
    formatShortDate(checkIn),
    `${formatShortDate(checkOut)} ${checkOut.slice(0, 4)}`,
  );

/** A month given as YYYY-MM. */
export const formatMonth = (month: string): string =>
  monthFormat.format(utc(`${month}-01`));

/** An instant, as the clock on Milos showed it. */
export const formatStamp = (timestamp: string): string =>
  stampFormat.format(new Date(timestamp));

export const nightsWord = (nights: number): string => t.common.nights(nights);

/** 666 tenths reads 66.6. */
export const formatTenths = (tenths: number): string =>
  `${Math.floor(tenths / 10)}.${tenths % 10}`;
