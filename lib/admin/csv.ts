// A spreadsheet treats a cell starting with = + - @ as a formula. A guest's
// name is typed by the guest, so those cells are made plain text.

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** The byte order mark makes Excel read Greek names correctly. */
export function toCsv(
  header: string[],
  rows: (string | number | null | undefined)[][],
): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/**
 * A plain number for a spreadsheet, such as 1250.50. Returned as a number-like
 * string with no currency sign, so a negative stays a number and not a formula.
 */
export const csvEuro = (cents: number | null): number | null =>
  cents === null ? null : Number((cents / 100).toFixed(2));
