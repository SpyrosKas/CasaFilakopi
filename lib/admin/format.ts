import { PROPERTY_TIME_ZONE } from "@/lib/domain/dates";
import {
  formatEuro as euroInGreek,
  formatPercent as percentInGreek,
} from "@/lib/invoicing/format";

// How the admin panel writes money and dates in each language. Safe in the
// browser too. Greek names are written out here, not taken from Intl, so the
// server and the browser always agree on them.

/** Integer maths only, so a displayed amount can never pick up a rounding slip. */
function euroInEnglish(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, "0");
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}€${grouped}.${part}`;
}

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

const GREEK_WEEKDAYS = ["Κυρ", "Δευ", "Τρί", "Τετ", "Πέμ", "Παρ", "Σάβ"];

const GREEK_MONTHS = [
  "Ιαν",
  "Φεβ",
  "Μαρ",
  "Απρ",
  "Μαΐ",
  "Ιουν",
  "Ιουλ",
  "Αυγ",
  "Σεπ",
  "Οκτ",
  "Νοε",
  "Δεκ",
];

const GREEK_MONTH_NAMES = [
  "Ιανουάριος",
  "Φεβρουάριος",
  "Μάρτιος",
  "Απρίλιος",
  "Μάιος",
  "Ιούνιος",
  "Ιούλιος",
  "Αύγουστος",
  "Σεπτέμβριος",
  "Οκτώβριος",
  "Νοέμβριος",
  "Δεκέμβριος",
];

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const shortFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

const yearFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const monthFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  month: "long",
  year: "numeric",
});

const stampFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** The clock on Milos in numbers, for the Greek wording. */
const milosClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: PROPERTY_TIME_ZONE,
  day: "numeric",
  month: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

function greekDay(date: string): string {
  const day = utc(date);
  return `${day.getUTCDate()} ${GREEK_MONTHS[day.getUTCMonth()]}`;
}

function greekStamp(timestamp: string): string {
  const part = Object.fromEntries(
    milosClock
      .formatToParts(new Date(timestamp))
      .map(({ type, value }) => [type, value]),
  );
  const month = GREEK_MONTHS[Number(part.month) - 1];
  return `${part.day} ${month} ${part.year}, ${part.hour}:${part.minute}`;
}

export interface Formatters {
  /** 1.234,56 € in Greek, €1,234.56 in English. */
  formatEuro: (cents: number) => string;
  /** The same, without cents when there are none. */
  formatRoundEuro: (cents: number) => string;
  /** For a box he can edit: 1250 becomes 12,50 in Greek. */
  centsToBox: (cents: number | null | undefined) => string;
  /** A stay date, such as Σάβ 7 Νοε 2026 or Sat 7 Nov 2026. */
  formatDate: (date: string) => string;
  /** 7 Νοε. */
  formatShortDate: (date: string) => string;
  /** 7 Νοε 2026. */
  formatYearDate: (date: string) => string;
  /** A month given as YYYY-MM. */
  formatMonth: (month: string) => string;
  /** An instant, as the clock on Milos showed it. */
  formatStamp: (timestamp: string) => string;
  /** 666 tenths reads 66,6 in Greek. */
  formatTenths: (tenths: number) => string;
  /** 1250 basis points read 12,5% in Greek. */
  formatPercent: (basisPoints: number) => string;
}

export function formatters(language: "en" | "el"): Formatters {
  const greek = language === "el";
  const decimal = greek ? "," : ".";
  const formatEuro = greek ? euroInGreek : euroInEnglish;

  return {
    formatEuro,
    formatRoundEuro: (cents) => formatEuro(cents).replace(/[.,]00( €)?$/, "$1"),
    centsToBox: (cents) =>
      cents === null || cents === undefined
        ? ""
        : `${Math.floor(cents / 100)}${decimal}${String(cents % 100).padStart(2, "0")}`,
    formatDate: (date) =>
      greek
        ? `${GREEK_WEEKDAYS[utc(date).getUTCDay()]} ${greekDay(date)} ${date.slice(0, 4)}`
        : dateFormat.format(utc(date)).replace(",", ""),
    formatShortDate: (date) =>
      greek ? greekDay(date) : shortFormat.format(utc(date)),
    formatYearDate: (date) =>
      greek
        ? `${greekDay(date)} ${date.slice(0, 4)}`
        : yearFormat.format(utc(date)),
    formatMonth: (month) =>
      greek
        ? `${GREEK_MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`
        : monthFormat.format(utc(`${month}-01`)),
    formatStamp: (timestamp) =>
      greek ? greekStamp(timestamp) : stampFormat.format(new Date(timestamp)),
    formatTenths: (tenths) =>
      `${Math.floor(tenths / 10)}${decimal}${tenths % 10}`,
    formatPercent: (basisPoints) =>
      greek ? percentInGreek(basisPoints) : `${basisPoints / 100}%`,
  };
}
