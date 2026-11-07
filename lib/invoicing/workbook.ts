import type { InvoiceFilters } from "./filters";
import { buildXlsx, tableSumFormula, type Cell, type Sheet } from "./xlsx";

// The accountant's Excel file: every document on one sheet, and the sums by
// type and payment method on another. Real numbers and dates throughout, so it
// opens the same in any language of Excel, on any computer.

export const DOCUMENTS_SHEET = "Documents";
export const SUMMARY_SHEET = "Summary";

export const TO_CONFIRM_NOTE =
  "Προς επιβεβαίωση από τον λογιστή / To be confirmed by the accountant";
export const PROVISIONAL_NOTE =
  "ΠΡΟΣΩΡΙΝΑ, ΟΧΙ ΦΟΡΟΛΟΓΙΚΑ ΠΑΡΑΣΤΑΤΙΚΑ / PROVISIONAL, NOT TAX DOCUMENTS";
export const DUMMY_NOTE =
  "Τα στοιχεία εκδότη είναι δοκιμαστικά / The issuer details are dummy";

const TOTAL_LABEL = "Σύνολο / Total";

const DOC_TYPE_LABELS: Record<string, string> = {
  receipt: "Απόδειξη / Receipt",
  invoice: "Τιμολόγιο / Invoice",
  credit_note: "Πιστωτικό / Credit note",
};

const METHOD_LABELS: Record<string, string> = {
  card: "Κάρτα / Card",
  cash: "Μετρητά / Cash",
  bank_transfer: "Τραπεζική μεταφορά / Bank transfer",
  pos: "POS",
};

const NO_METHOD = "Χωρίς / None";

export interface ExportRow {
  documentNumber: string;
  docType: string;
  /** The issue date, YYYY-MM-DD. */
  issuedOn: string;
  isProvisional: boolean;
  hasDummyIssuer: boolean;
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

export interface WorkbookInput {
  rows: ExportRow[];
  /** What the file covers, in words. */
  scope: string[];
  /** The date on Milos, YYYY-MM-DD. */
  generatedOn: string;
}

const text = (value: string): Cell => ({ kind: "text", value });
const yesNo = (value: boolean) => text(value ? "Ναι / Yes" : "Όχι / No");

/** Credit notes count against the total. */
const signed = (row: ExportRow, cents: number) =>
  row.docType === "credit_note" ? -cents : cents;

/** Same order as the cells in documentCells. */
const COLUMNS: { title: string; width: number }[] = [
  { title: "Αριθμός / Number", width: 22 },
  { title: "Τύπος / Type", width: 22 },
  { title: "Ημερομηνία / Date", width: 13 },
  { title: "Προσωρινό / Provisional", width: 13 },
  { title: "Πελάτης / Customer", width: 28 },
  { title: "Εταιρεία / Company", width: 26 },
  { title: "ΑΦΜ / VAT number", width: 14 },
  { title: "ΔΟΥ / Tax office", width: 18 },
  { title: "Διεύθυνση / Address", width: 30 },
  { title: "Κράτηση / Booking", width: 17 },
  { title: "Τρόπος πληρωμής / Payment method", width: 22 },
  { title: "Συναλλαγή / Transaction", width: 30 },
  { title: "Καθαρό / Net", width: 13 },
  { title: "ΦΠΑ / VAT", width: 12 },
  { title: "Τέλη εκτός ΦΠΑ / Fees outside VAT", width: 13 },
  { title: "Σύνολο / Total", width: 13 },
  { title: "Συντελεστές ΦΠΑ / VAT rates", width: 13 },
  { title: "Πιστώνει / Credits", width: 22 },
  { title: "Αιτία / Reason", width: 30 },
  { title: "Σημείωση / Note", width: 34 },
  { title: "Στάλθηκε / Sent", width: 11 },
  { title: "PDF", width: 34 },
];

export const DOCUMENT_HEADERS = COLUMNS.map((column) => column.title);

const firstMoneyColumn = DOCUMENT_HEADERS.indexOf("Καθαρό / Net");
const MONEY_COLUMNS = [0, 1, 2, 3].map((offset) => firstMoneyColumn + offset);

function documentCells(row: ExportRow): Cell[] {
  return [
    text(row.documentNumber),
    text(DOC_TYPE_LABELS[row.docType] ?? row.docType),
    { kind: "date", value: row.issuedOn },
    yesNo(row.isProvisional),
    text(row.customerName),
    text(row.companyName),
    text(row.vatNumber),
    text(row.taxOffice),
    text(row.address),
    text(row.bookingReference),
    text(METHOD_LABELS[row.paymentMethod] ?? (row.paymentMethod || NO_METHOD)),
    text(row.transaction),
    { kind: "euro", cents: signed(row, row.netCents) },
    { kind: "euro", cents: signed(row, row.vatCents) },
    { kind: "euro", cents: signed(row, row.feeCents) },
    { kind: "euro", cents: signed(row, row.totalCents) },
    text(row.vatRates),
    text(row.creditsDocument),
    text(row.reason),
    text(row.note),
    yesNo(row.isSent),
    text(row.pdfFile),
  ];
}

interface Sums {
  count: number;
  netCents: number;
  vatCents: number;
  feeCents: number;
  totalCents: number;
}

function sumOf(rows: ExportRow[]): Sums {
  const sum = (pick: (row: ExportRow) => number) =>
    rows.reduce((total, row) => total + signed(row, pick(row)), 0);
  return {
    count: rows.length,
    netCents: sum((row) => row.netCents),
    vatCents: sum((row) => row.vatCents),
    feeCents: sum((row) => row.feeCents),
    totalCents: sum((row) => row.totalCents),
  };
}

function totalsRow(rows: ExportRow[]): Cell[] {
  const sums = sumOf(rows);
  const amounts = [
    sums.netCents,
    sums.vatCents,
    sums.feeCents,
    sums.totalCents,
  ];
  return COLUMNS.map((column, index): Cell => {
    if (index === 0) return { kind: "text", value: TOTAL_LABEL, style: "bold" };
    const money = MONEY_COLUMNS.indexOf(index);
    return money < 0
      ? { kind: "empty" }
      : {
          kind: "sum",
          formula: tableSumFormula(column.title),
          cents: amounts[money],
        };
  });
}

function documentsSheet(rows: ExportRow[]): Sheet {
  const header = COLUMNS.map((column): Cell => ({
    kind: "text",
    value: column.title,
    style: "header",
  }));
  const sheet: Sheet = {
    name: DOCUMENTS_SHEET,
    widths: COLUMNS.map((column) => column.width),
    freezeHeader: true,
    headerHeight: 48,
    rows: [header, ...rows.map(documentCells)],
  };
  // Excel treats a table with no rows as damaged, so an empty file has none.
  if (rows.length === 0) return sheet;
  sheet.rows.push(totalsRow(rows));
  sheet.table = {
    name: "InvoiceDocuments",
    columns: DOCUMENT_HEADERS,
    dataRows: rows.length,
    totalsLabel: TOTAL_LABEL,
    totalColumns: MONEY_COLUMNS,
  };
  return sheet;
}

const SUMMARY_HEADERS = [
  "Πλήθος / Count",
  "Καθαρό / Net",
  "ΦΠΑ / VAT",
  "Τέλη εκτός ΦΠΑ / Fees outside VAT",
  "Σύνολο / Total",
];

function summaryRow(label: string, sums: Sums, bold = false): Cell[] {
  const euro = (cents: number): Cell => ({
    kind: "euro",
    cents,
    style: bold ? "boldEuro" : "euro",
  });
  return [
    { kind: "text", value: label, style: bold ? "bold" : "text" },
    { kind: "count", value: sums.count, style: bold ? "boldCount" : "count" },
    euro(sums.netCents),
    euro(sums.vatCents),
    euro(sums.feeCents),
    euro(sums.totalCents),
  ];
}

function group(
  heading: string,
  rows: ExportRow[],
  keyOf: (row: ExportRow) => string,
): Cell[][] {
  const keys = [...new Set(rows.map(keyOf))].sort();
  return [
    [
      { kind: "text", value: heading, style: "bold" },
      ...SUMMARY_HEADERS.map((title): Cell => ({
        kind: "text",
        value: title,
        style: "bold",
      })),
    ],
    ...keys.map((key) =>
      summaryRow(key, sumOf(rows.filter((row) => keyOf(row) === key))),
    ),
    summaryRow(TOTAL_LABEL, sumOf(rows), true),
  ];
}

function summarySheet(input: WorkbookInput): Sheet {
  const { rows, scope, generatedOn } = input;
  const notes = [
    rows.some((row) => row.isProvisional) ? PROVISIONAL_NOTE : "",
    rows.some((row) => row.hasDummyIssuer) ? DUMMY_NOTE : "",
  ].filter(Boolean);

  const blank: Cell[] = [];
  return {
    name: SUMMARY_SHEET,
    widths: [46, 12, 15, 15, 15, 15],
    rows: [
      [
        {
          kind: "text",
          value: "Casa Filakopi: Παραστατικά / Documents",
          style: "title",
        },
      ],
      ...notes.map((value): Cell[] => [
        { kind: "text", value, style: "warning" },
      ]),
      blank,
      [{ kind: "text", value: "Περιέχει / Covers", style: "bold" }],
      ...scope.map((line): Cell[] => [text(line)]),
      blank,
      [
        { kind: "text", value: "Δημιουργήθηκε / Generated", style: "bold" },
        { kind: "date", value: generatedOn },
      ],
      blank,
      ...group(
        "Ανά τύπο / By document type",
        rows,
        (row) => DOC_TYPE_LABELS[row.docType] ?? row.docType,
      ),
      blank,
      ...group(
        "Ανά τρόπο πληρωμής / By payment method",
        rows,
        (row) =>
          METHOD_LABELS[row.paymentMethod] ?? (row.paymentMethod || NO_METHOD),
      ),
    ],
  };
}

export function buildWorkbook(input: WorkbookInput): Uint8Array {
  return buildXlsx([documentsSheet(input.rows), summarySheet(input)]);
}

/** The words for a month's pack. */
export function monthScope(month: string, count: number): string[] {
  return [`Μήνας / Month: ${month}`, `Παραστατικά / Documents: ${count}`];
}

const FILTER_LABELS: Partial<Record<keyof InvoiceFilters, string>> = {
  month: "Μήνας / Month",
  from: "Από / From",
  to: "Έως / To",
  type: "Τύπος / Type",
  status: "Κατάσταση / Status",
  sent: "Στάλθηκε / Sent",
  booking: "Κράτηση / Booking",
  guest: "Πελάτης / Guest",
  method: "Τρόπος πληρωμής / Payment method",
  transaction: "Συναλλαγή / Transaction",
};

/** The words for a selection, and the list filter it was made under. */
export function selectionScope(
  count: number,
  filters: InvoiceFilters,
): string[] {
  const shown = Object.entries(FILTER_LABELS).flatMap(([key, label]) => {
    const value = filters[key as keyof InvoiceFilters];
    return value === undefined ? [] : [`${label}: ${value}`];
  });
  return [
    `Επιλεγμένα παραστατικά / Selected documents: ${count}`,
    ...(shown.length
      ? shown.map((line) => `Φίλτρο / Filter, ${line}`)
      : ["Φίλτρο / Filter: κανένα / none"]),
  ];
}
