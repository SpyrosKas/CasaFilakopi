import type { FilterableRow } from "./filters";

// What the Owner should know before a set of documents leaves the admin.
// Shared by the selection bar and the monthly page.

export interface ReviewedDocument {
  id: string;
  documentNumber: string;
}

export interface SentDocument extends ReviewedDocument {
  sentOn: string;
}

export interface SelectionReview {
  count: number;
  /** Billed minus credited. */
  totalCents: number;
  missingPdf: ReviewedDocument[];
  alreadySent: SentDocument[];
}

interface ReviewableRow extends FilterableRow {
  documentNumber: string;
  sentOn: string | null;
}

export function reviewRows(rows: ReviewableRow[]): SelectionReview {
  return {
    count: rows.length,
    totalCents: rows.reduce(
      (sum, row) =>
        sum + (row.docType === "credit_note" ? -1 : 1) * row.totalCents,
      0,
    ),
    missingPdf: rows
      .filter((row) => !row.hasPdf)
      .map(({ id, documentNumber }) => ({ id, documentNumber })),
    alreadySent: rows
      .filter((row) => row.isSent)
      .map(({ id, documentNumber, sentOn }) => ({
        id,
        documentNumber,
        sentOn: sentOn ?? "",
      })),
  };
}
