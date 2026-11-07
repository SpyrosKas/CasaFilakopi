import { describe, expect, it } from "vitest";
import {
  buildCsv,
  CSV_BOM,
  CSV_HEADERS,
  textCell,
  type CsvRow,
} from "@/lib/invoicing/csv";

const row = (change: Partial<CsvRow> = {}): CsvRow => ({
  documentNumber: "TEST-R-000001",
  docType: "receipt",
  issuedOn: "2026-11-07",
  isProvisional: true,
  customerName: "Μαρία Παπαδοπούλου",
  companyName: "",
  vatNumber: "",
  taxOffice: "",
  address: "",
  bookingReference: "CF-2027-00001",
  paymentMethod: "card",
  transaction: "pi_123",
  netCents: 123456,
  vatCents: 0,
  feeCents: 1400,
  totalCents: 124856,
  vatRates: "",
  creditsDocument: "",
  reason: "",
  note: "",
  isSent: false,
  pdfFile: "TEST-R-000001.pdf",
  ...change,
});

/** A small reader that follows the same rules Excel does. */
function parse(csv: string): string[][] {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ";") {
      rows.at(-1)!.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      rows.at(-1)!.push(cell);
      cell = "";
      rows.push([]);
      i += 1;
    } else cell += char;
  }
  rows.pop();
  return rows;
}

describe("the accountant's CSV", () => {
  it("starts with a BOM, so Excel reads Greek", () => {
    expect(buildCsv([row()]).startsWith(CSV_BOM)).toBe(true);
    expect(new TextEncoder().encode(buildCsv([])).slice(0, 3)).toEqual(
      new Uint8Array([0xef, 0xbb, 0xbf]),
    );
  });

  it("keeps Greek as Greek", () => {
    const [, first] = parse(buildCsv([row()]));
    expect(first[CSV_HEADERS.indexOf("Πελάτης / Customer")]).toBe(
      "Μαρία Παπαδοπούλου",
    );
    expect(buildCsv([])).toContain("ΑΦΜ / VAT number");
  });

  it("every row has the same number of columns", () => {
    const rows = parse(
      buildCsv([row(), row({ reason: 'a;b"c', docType: "credit_note" })]),
    );
    expect(new Set(rows.map((cells) => cells.length))).toEqual(
      new Set([CSV_HEADERS.length]),
    );
  });

  it("uses decimal commas with no thousands mark", () => {
    const [, first] = parse(buildCsv([row()]));
    expect(first[CSV_HEADERS.indexOf("Καθαρό / Net")]).toBe("1234,56");
    expect(first[CSV_HEADERS.indexOf("Σύνολο / Total")]).toBe("1248,56");
  });

  it("a comma stays in its cell, and needs no quotes with semicolons", () => {
    const [, first] = parse(buildCsv([row({ address: "Οδός 1, Αθήνα" })]));
    expect(first[CSV_HEADERS.indexOf("Διεύθυνση / Address")]).toBe(
      "Οδός 1, Αθήνα",
    );
  });

  it("quotes separators, quotes and new lines", () => {
    const reason = 'He said "no"; twice\r\nthen left';
    const [, first] = parse(buildCsv([row({ reason })]));
    expect(first[CSV_HEADERS.indexOf("Αιτία / Reason")]).toBe(reason);
  });

  it("shows credit notes as negative, so a column adds up", () => {
    const [, first] = parse(
      buildCsv([row({ docType: "credit_note", totalCents: 5000 })]),
    );
    expect(first[CSV_HEADERS.indexOf("Σύνολο / Total")]).toBe("-50,00");
  });

  it("formats the date for Greece", () => {
    const [, first] = parse(buildCsv([row()]));
    expect(first[CSV_HEADERS.indexOf("Ημερομηνία / Date")]).toBe("07/11/2026");
  });

  it("says when a PDF is not in the file", () => {
    const [, first] = parse(buildCsv([row({ pdfFile: "PDF missing" })]));
    expect(first.at(-1)).toBe("PDF missing");
  });
});

describe("formula injection", () => {
  const attacks = [
    "=1+1",
    "+30 6900000000",
    "-2+3",
    "@SUM(A1)",
    '=HYPERLINK("http://evil.test","x")',
    "\t=1+1",
    "\r=1+1",
    " =1+1",
    "\u00A0=1+1",
    "\uFF1D1+1",
    "\uFF0B1",
    "\uFF0D1",
    "\uFF201",
  ];

  for (const attack of attacks) {
    it(`neutralises ${JSON.stringify(attack)}`, () => {
      const [, first] = parse(buildCsv([row({ customerName: attack })]));
      const cell = first[CSV_HEADERS.indexOf("Πελάτης / Customer")];
      expect(cell.startsWith("'")).toBe(true);
      expect(cell.slice(1)).toBe(attack);
    });
  }

  it("covers every text column a person can type into", () => {
    const hostile = "=cmd()";
    const rows = parse(
      buildCsv([
        row({
          customerName: hostile,
          companyName: hostile,
          vatNumber: hostile,
          taxOffice: hostile,
          address: hostile,
          bookingReference: hostile,
          transaction: hostile,
          reason: hostile,
          note: hostile,
        }),
      ]),
    );
    expect(rows[1].filter((cell) => cell === hostile)).toEqual([]);
    expect(rows[1].filter((cell) => cell === `'${hostile}`)).toHaveLength(9);
  });

  it("leaves ordinary text and real negative amounts alone", () => {
    expect(textCell("Μαρία")).toBe("Μαρία");
    expect(textCell("user@example.test")).toBe("user@example.test");
    expect(textCell(null)).toBe("");
    const [, first] = parse(
      buildCsv([row({ docType: "credit_note", totalCents: 5000 })]),
    );
    expect(first[CSV_HEADERS.indexOf("Σύνολο / Total")]).toBe("-50,00");
  });
});
