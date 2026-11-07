import { addMonths, athensDate } from "@/lib/domain/dates";

// Money and dates exactly as a Greek accountant reads them, the same on
// screen, on the PDF and in the export.

export function formatEuro(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  const part = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${sign}${String(whole).replace(/\B(?=(\d{3})+$)/g, ".")},${part} €`;
}

/** Plain decimal comma, no thousands mark, so Greek Excel reads a number. */
export function csvAmount(cents: number): string {
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

/** The same shape finish_invoice returns as document_number. */
export function documentNumber(prefix: string, number: number): string {
  return `${prefix}-${String(number).padStart(6, "0")}`;
}

/** The calendar date on Milos at this instant. */
export const issuedOn = (issuedAt: string): string =>
  athensDate(new Date(issuedAt));

export function previousMonth(now: Date): string {
  return addMonths(`${athensDate(now).slice(0, 7)}-01`, -1).slice(0, 7);
}

/** Storage refuses some characters, and a series prefix is free text. */
export function pdfFileName(number: string): string {
  return `${number.replace(/[^A-Za-z0-9._-]/g, "_")}.pdf`;
}

/** {year}/{month}/{documentNumber}.pdf, by the issue date on Milos. */
export function pdfStoragePath(number: string, issuedAt: string): string {
  const [year, month] = issuedOn(issuedAt).split("-");
  return `${year}/${month}/${pdfFileName(number)}`;
}
