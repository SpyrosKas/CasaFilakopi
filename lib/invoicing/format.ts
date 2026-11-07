import { addMonths, athensDate } from "@/lib/domain/dates";

// Money and dates exactly as a Greek accountant reads them, the same on
// screen, on the PDF and in the export.

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${sign}${String(whole).replace(/\B(?=(\d{3})+$)/g, ".")},${part} €`;
}

/** A plain amount with a decimal comma, for a form box. */
export function plainAmount(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  return `${sign}${whole},${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** Null unless this is a plain amount. Accepts 12, 12.5 and 12,50. */
export function parseEuros(input: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** 2026-11-07 becomes 07/11/2026. */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-");
  return `${day}/${month}/${year}`;
}

export function formatPercent(basisPoints: number): string {
  const whole = Math.floor(basisPoints / 100);
  const part = String(basisPoints % 100)
    .padStart(2, "0")
    .replace(/0$/, "");
  return basisPoints % 100 === 0 ? `${whole}%` : `${whole},${part}%`;
}

/** The calendar date on Milos at this instant. */
export const issuedOn = (issuedAt: string): string =>
  athensDate(new Date(issuedAt));

export function previousMonth(now: Date): string {
  return addMonths(`${athensDate(now).slice(0, 7)}-01`, -1).slice(0, 7);
}

/** A tax document should not sit in a shared cache. The value is seconds. */
export const PDF_CACHE_SECONDS = "0";

/**
 * A name a phone or computer can save. Greek stays readable, because a series
 * prefix may be Greek. Different numbers can come out alike here, so this name
 * is never used to tell two documents apart.
 */
export function readableName(number: string): string {
  const name = number
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}._-]/gu, "_")
    .replace(/^\.+/, "");
  return name || "document";
}

/** The name of one document saved on its own. */
export function pdfFileName(number: string): string {
  return `${readableName(number)}.pdf`;
}

/** Inside a ZIP, where names must be unique: the id settles any clash. */
export function zipEntryName(number: string, invoiceId: string): string {
  return `${readableName(number)}-${invoiceId.slice(0, 8)}.pdf`;
}

/**
 * {year}/{month}/{invoiceId}.pdf, by the issue date on Milos. The id, not the
 * number: storage keys are ASCII, so two Greek numbers could otherwise land on
 * one path and one document could show another's file.
 */
export function pdfStoragePath(invoiceId: string, issuedAt: string): string {
  const [year, month] = issuedOn(issuedAt).split("-");
  return `${year}/${month}/${invoiceId}.pdf`;
}
