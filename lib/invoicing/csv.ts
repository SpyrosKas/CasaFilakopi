import { csvAmount, formatDate } from "./format";

// The accountant's monthly file.
//
// Semicolons, not commas: Excel set to Greek uses the comma as the decimal
// mark and the semicolon as the list separator, so a comma file opens with
// everything in one column. Amounts keep a decimal comma and no thousands mark
// so Excel reads them as numbers. The UTF-8 BOM is what makes Excel read Greek
// correctly. A `sep=;` first line is deliberately left out: it stops Excel
// honouring the BOM.

export const CSV_SEPARATOR = ";";
export const CSV_BOM = "\uFEFF";
const NEWLINE = "\r\n";

// A cell starting like this runs as a formula in Excel, and guests type their
// own names. Includes the full-width forms, and spaces in front, which Excel
// skips. Tabs and returns count too.
const FORMULA_START = /^[\s\u00A0]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]|^[\t\r\n]/;

/** Commas too: the file may be opened where the comma is the separator. */
function quote(text: string): string {
  return /[;,"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Text from anywhere. The apostrophe makes Excel treat it as plain text. */
export function textCell(value: string | null | undefined): string {
  const text = value ?? "";
  return quote(FORMULA_START.test(text) ? `'${text}` : text);
}

export interface CsvRow {
  documentNumber: string;
  docType: string;
  /** The issue date, YYYY-MM-DD. */
  issuedOn: string;
  isProvisional: boolean;
  customerName: string;
  companyName: string;
  vatNumber: string;
  taxOffice: string;
  address: string;
  bookingReference: string;
  paymentMethod: string;
  transaction: string;
  /** Positive as stored. Credit notes come out negative. */
  netCents: number;
  vatCents: number;
  feeCents: number;
  totalCents: number;
  vatRates: string;
  creditsDocument: string;
  reason: string;
  note: string;
  isSent: boolean;
  pdfFile: string;
}

export const CSV_HEADERS = [
  "Αριθμός / Number",
  "Τύπος / Type",
  "Ημερομηνία / Date",
  "Προσωρινό / Provisional",
  "Πελάτης / Customer",
  "Εταιρεία / Company",
  "ΑΦΜ / VAT number",
  "ΔΟΥ / Tax office",
  "Διεύθυνση / Address",
  "Κράτηση / Booking",
  "Τρόπος πληρωμής / Payment method",
  "Συναλλαγή / Transaction",
  "Καθαρό / Net",
  "ΦΠΑ / VAT",
  "Τέλη εκτός ΦΠΑ / Fees outside VAT",
  "Σύνολο / Total",
  "Συντελεστές ΦΠΑ / VAT rates",
  "Πιστώνει / Credits",
  "Αιτία / Reason",
  "Σημείωση / Note",
  "Στάλθηκε / Sent",
  "PDF",
];

const yesNo = (value: boolean) => (value ? "Ναι / Yes" : "Όχι / No");

function rowCells(row: CsvRow): string[] {
  // Signed, so adding up a column in Excel gives the month's real figure.
  const sign = row.docType === "credit_note" ? -1 : 1;
  return [
    textCell(row.documentNumber),
    textCell(row.docType),
    textCell(formatDate(row.issuedOn)),
    textCell(yesNo(row.isProvisional)),
    textCell(row.customerName),
    textCell(row.companyName),
    textCell(row.vatNumber),
    textCell(row.taxOffice),
    textCell(row.address),
    textCell(row.bookingReference),
    textCell(row.paymentMethod),
    textCell(row.transaction),
    // Formatted here from whole numbers, so a minus sign is safe.
    quote(csvAmount(sign * row.netCents)),
    quote(csvAmount(sign * row.vatCents)),
    quote(csvAmount(sign * row.feeCents)),
    quote(csvAmount(sign * row.totalCents)),
    textCell(row.vatRates),
    textCell(row.creditsDocument),
    textCell(row.reason),
    textCell(row.note),
    textCell(yesNo(row.isSent)),
    textCell(row.pdfFile),
  ];
}

export function buildCsv(rows: CsvRow[]): string {
  const lines = [
    CSV_HEADERS.map(textCell).join(CSV_SEPARATOR),
    ...rows.map((row) => rowCells(row).join(CSV_SEPARATOR)),
  ];
  return `${CSV_BOM}${lines.join(NEWLINE)}${NEWLINE}`;
}
