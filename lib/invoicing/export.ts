import "server-only";
import type { AdminContext } from "@/lib/admin/session";
import { buildCsv, type CsvRow } from "./csv";
import { loadIndex, loadLinesFor, type IndexRow } from "./data";
import { selectionSchema } from "./filters";
import { formatPercent, issuedOn, pdfFileName } from "./format";
import { hasSingleLineAssumption, vatBreakdown } from "./lines";
import { reviewRows, type SelectionReview } from "./review";
import { readPdf } from "./storage";
import { zipStream, type ZipEntry } from "./zip";

// The one way documents leave as files. A selection, "Select all" and the
// monthly pack all arrive here as a list of rows. Downloading never marks
// anything as sent.

export const PDF_MISSING_CELL = "PDF missing / Λείπει το PDF";
const MISSING_FILE = "PDF-MISSING.txt";

export type Resolved =
  { ok: true; rows: IndexRow[] } | { ok: false; reason: "invalid" | "unknown" };

/**
 * Turns ids from the browser into stored documents. One id that does not exist
 * refuses the whole request: a list that has been tampered with, or gone
 * stale, must not quietly become a different set of documents.
 */
export async function resolveSelection(
  admin: AdminContext,
  input: unknown,
): Promise<Resolved> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const byId = new Map((await loadIndex(admin)).map((row) => [row.id, row]));
  const rows = parsed.data.map((id) => byId.get(id));
  return rows.every((row) => row !== undefined)
    ? { ok: true, rows: rows as IndexRow[] }
    : { ok: false, reason: "unknown" };
}

export function reviewOf(rows: IndexRow[]): SelectionReview {
  return reviewRows(
    rows.map((row) => ({
      ...row,
      sentOn: row.exportedAt ? issuedOn(row.exportedAt) : null,
    })),
  );
}

function attachmentHeaders(fileName: string, type: string): HeadersInit {
  return {
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
  };
}

async function csvRows(
  admin: AdminContext,
  rows: IndexRow[],
  pdfFiles: Map<string, string>,
): Promise<CsvRow[]> {
  const lines = await loadLinesFor(
    admin,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const own = lines.get(row.id) ?? [];
    return {
      documentNumber: row.documentNumber,
      docType: row.docType,
      issuedOn: row.issuedOn,
      isProvisional: row.isProvisional,
      customerName: row.customer.name,
      companyName: row.customer.companyName,
      vatNumber: row.customer.vatNumber,
      taxOffice: row.customer.taxOffice,
      address: row.customer.address,
      bookingReference: row.bookingReference,
      paymentMethod: row.paymentMethod ?? "",
      transaction: row.transactionIds[0] ?? "",
      netCents: row.netCents,
      vatCents: row.vatCents,
      feeCents: row.feeCents,
      totalCents: row.totalCents,
      vatRates: vatBreakdown(own)
        .filter((entry) => entry.basisPoints > 0)
        .map((entry) => formatPercent(entry.basisPoints))
        .join(", "),
      creditsDocument: row.creditsDocumentNumber ?? "",
      reason: row.reason ?? "",
      note: hasSingleLineAssumption(own)
        ? "Μία γραμμή, προς επιβεβαίωση / One line, to be confirmed"
        : "",
      isSent: row.isSent,
      pdfFile: pdfFiles.get(row.id) ?? PDF_MISSING_CELL,
    };
  });
}

/**
 * PDFs first, one at a time and only as the reader asks. The CSV and the list
 * of missing files come last, so they say what actually went into the ZIP, even
 * if a file vanished after the warning was shown.
 */
async function* packEntries(
  admin: AdminContext,
  rows: IndexRow[],
  name: string,
): AsyncGenerator<ZipEntry> {
  const pdfFiles = new Map<string, string>();
  for (const row of rows) {
    const data = row.pdfPath ? await readPdf(admin, row.pdfPath) : null;
    if (!data) continue;
    const fileName = pdfFileName(row.documentNumber);
    pdfFiles.set(row.id, fileName);
    yield { name: fileName, data };
  }

  const missing = rows.filter((row) => !pdfFiles.has(row.id));
  if (missing.length) {
    const text = [
      "Αυτά τα παραστατικά δεν έχουν PDF σε αυτό το αρχείο.",
      "These documents have no PDF in this file.",
      "",
      ...missing.map((row) => row.documentNumber),
      "",
    ].join("\r\n");
    yield { name: MISSING_FILE, data: new TextEncoder().encode(text) };
  }

  const csv = buildCsv(await csvRows(admin, rows, pdfFiles));
  yield { name: `${name}.csv`, data: new TextEncoder().encode(csv) };
}

export function packResponse(
  admin: AdminContext,
  rows: IndexRow[],
  name: string,
): Response {
  return new Response(zipStream(packEntries(admin, rows, name)), {
    headers: attachmentHeaders(`${name}.zip`, "application/zip"),
  });
}

/** One document: the PDF itself, or null if it cannot be read. */
export async function pdfResponse(
  admin: AdminContext,
  row: IndexRow,
): Promise<Response | null> {
  const data = row.pdfPath ? await readPdf(admin, row.pdfPath) : null;
  if (!data) return null;
  return new Response(data.slice().buffer as ArrayBuffer, {
    headers: attachmentHeaders(
      pdfFileName(row.documentNumber),
      "application/pdf",
    ),
  });
}
