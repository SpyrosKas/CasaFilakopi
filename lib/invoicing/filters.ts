import { z } from "zod";
import { isValidIsoDate } from "@/lib/domain/dates";
import { DOC_TYPES, PAYMENT_METHODS, type DocType } from "./types";

// The list's filters live in the URL, so a view can be shared. A value that
// makes no sense is dropped, not treated as an error: a mangled link should
// still open the list.

export const PAGE_SIZE = 25;

/** The most documents one selection or one "Select all" can hold. */
export const SELECTION_LIMIT = 500;

/** Document ids from the browser. Nothing here is trusted until re-checked. */
export const selectionSchema = z
  .array(z.uuid())
  .min(1)
  .max(SELECTION_LIMIT)
  .transform((ids) => [...new Set(ids)]);

export const STATUS_FILTERS = [
  "open",
  "part_credited",
  "credited",
  "pdf_missing",
] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

const search = z
  .string()
  .trim()
  .max(100)
  .transform((value) => value || undefined)
  .optional()
  .catch(undefined);

const date = z.string().refine(isValidIsoDate).optional().catch(undefined);

const oneOf = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values).optional().catch(undefined);

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const filtersSchema = z.object({
  month: z.string().regex(MONTH).optional().catch(undefined),
  from: date,
  to: date,
  type: oneOf(DOC_TYPES),
  status: oneOf(STATUS_FILTERS),
  sent: oneOf(["yes", "no"] as const),
  booking: search,
  guest: search,
  method: oneOf(PAYMENT_METHODS),
  transaction: search,
  page: z.coerce.number().int().min(1).max(100_000).catch(1).default(1),
});

export type InvoiceFilters = z.output<typeof filtersSchema>;

/** A repeated parameter arrives as a list: the first one counts. */
export function parseFilters(
  params: Record<string, string | string[] | undefined>,
): InvoiceFilters {
  const single = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  return filtersSchema.parse(single);
}

export function filtersToQuery(
  filters: Partial<InvoiceFilters>,
  page?: number,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (key !== "page" && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  if (page && page > 1) query.set("page", String(page));
  const text = query.toString();
  return text ? `?${text}` : "";
}

export const hasFilters = (filters: InvoiceFilters): boolean =>
  Object.entries(filters).some(
    ([key, value]) => key !== "page" && value !== undefined,
  );

/** What a row must carry to be filtered and added up. */
export interface FilterableRow {
  id: string;
  docType: DocType;
  /** The issue date on Milos. */
  issuedOn: string;
  hasPdf: boolean;
  isSent: boolean;
  bookingReference: string;
  guestNames: string[];
  paymentMethod: string | null;
  transactionIds: string[];
  creditsInvoiceId: string | null;
  totalCents: number;
  netCents: number;
  vatCents: number;
  feeCents: number;
}

/** Ignores case and Greek accents, so Μαρία finds ΜΑΡΙΑ. */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("el")
    .replace(/ς/g, "σ");
}

const includes = (values: string[], search: string) => {
  const wanted = foldText(search);
  return values.some((value) => foldText(value).includes(wanted));
};

/** How much of each document has been credited. */
export function creditedAmounts(rows: FilterableRow[]): Map<string, number> {
  const credited = new Map<string, number>();
  for (const row of rows) {
    if (row.creditsInvoiceId) {
      credited.set(
        row.creditsInvoiceId,
        (credited.get(row.creditsInvoiceId) ?? 0) + row.totalCents,
      );
    }
  }
  return credited;
}

function matchesStatus(
  row: FilterableRow,
  status: StatusFilter,
  credited: Map<string, number>,
): boolean {
  if (status === "pdf_missing") return !row.hasPdf;
  if (row.docType === "credit_note") return false;
  const amount = credited.get(row.id) ?? 0;
  if (status === "open") return amount === 0;
  if (status === "credited") return amount >= row.totalCents;
  return amount > 0 && amount < row.totalCents;
}

/**
 * Filters the whole list here rather than in the database. One house issues a
 * few hundred documents a year, and this keeps every filter, the page count
 * and the totals working from the same rows.
 */
export function applyFilters<T extends FilterableRow>(
  rows: T[],
  filters: InvoiceFilters,
): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const credited = creditedAmounts(rows);

  return rows.filter((row) => {
    if (filters.month && !row.issuedOn.startsWith(filters.month)) return false;
    if (filters.from && row.issuedOn < filters.from) return false;
    if (filters.to && row.issuedOn > filters.to) return false;
    if (filters.type && row.docType !== filters.type) return false;
    if (filters.method && row.paymentMethod !== filters.method) return false;
    if (filters.sent && row.isSent !== (filters.sent === "yes")) return false;
    if (filters.status && !matchesStatus(row, filters.status, credited)) {
      return false;
    }
    if (filters.booking && !includes([row.bookingReference], filters.booking)) {
      return false;
    }
    if (filters.guest && !includes(row.guestNames, filters.guest)) return false;
    if (filters.transaction) {
      // A credit note has no payment of its own: it follows its original.
      const parent = row.creditsInvoiceId
        ? byId.get(row.creditsInvoiceId)
        : undefined;
      const ids = [...row.transactionIds, ...(parent?.transactionIds ?? [])];
      if (!includes(ids, filters.transaction)) return false;
    }
    return true;
  });
}

export interface Totals {
  count: number;
  billedCents: number;
  creditedCents: number;
  /** Billed minus credited. */
  totalCents: number;
  netCents: number;
  vatCents: number;
  feeCents: number;
}

export function summarise(rows: FilterableRow[]): Totals {
  const totals: Totals = {
    count: rows.length,
    billedCents: 0,
    creditedCents: 0,
    totalCents: 0,
    netCents: 0,
    vatCents: 0,
    feeCents: 0,
  };
  for (const row of rows) {
    const sign = row.docType === "credit_note" ? -1 : 1;
    if (sign > 0) totals.billedCents += row.totalCents;
    else totals.creditedCents += row.totalCents;
    totals.totalCents += sign * row.totalCents;
    totals.netCents += sign * row.netCents;
    totals.vatCents += sign * row.vatCents;
    totals.feeCents += sign * row.feeCents;
  }
  return totals;
}
