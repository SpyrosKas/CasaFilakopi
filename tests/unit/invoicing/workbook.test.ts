import { strFromU8, unzipSync } from "fflate";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { parseFilters } from "@/lib/invoicing/filters";
import {
  buildWorkbook,
  DOCUMENT_HEADERS,
  DOCUMENTS_SHEET,
  DUMMY_NOTE,
  monthScope,
  PROVISIONAL_NOTE,
  selectionScope,
  SUMMARY_SHEET,
  TO_CONFIRM_NOTE,
  type ExportRow,
} from "@/lib/invoicing/workbook";
import {
  columnName,
  euros,
  excelDate,
  tableSumFormula,
  xmlText,
} from "@/lib/invoicing/xlsx";
import { columnOf, readWorkbook, rowStarting } from "../../read-xlsx";

const { ValueType } = ExcelJS;

const row = (change: Partial<ExportRow> = {}): ExportRow => ({
  documentNumber: "TEST-R-000001",
  docType: "receipt",
  issuedOn: "2026-11-07",
  isProvisional: true,
  hasDummyIssuer: true,
  customerName: "Μαρία Παπαδοπούλου",
  companyName: "",
  vatNumber: "",
  taxOffice: "",
  address: "Οδός 1, Αθήνα",
  bookingReference: "CF-2027-00001",
  paymentMethod: "card",
  transaction: "pi_123",
  netCents: 86400,
  vatCents: 11232,
  feeCents: 1500,
  totalCents: 99132,
  vatRates: "13%",
  creditsDocument: "",
  reason: "",
  note: "",
  isSent: false,
  pdfFile: "TEST-R-000001-aaaaaaaa.pdf",
  ...change,
});

const deposit = row({
  documentNumber: "TEST-I-000002",
  docType: "invoice",
  paymentMethod: "bank_transfer",
  netCents: 25920,
  vatCents: 3370,
  feeCents: 450,
  totalCents: 29740,
  note: TO_CONFIRM_NOTE,
});

const credit = row({
  documentNumber: "TEST-CN-000003",
  docType: "credit_note",
  issuedOn: "2026-11-30",
  netCents: 10000,
  vatCents: 1300,
  feeCents: 200,
  totalCents: 11500,
  creditsDocument: "TEST-R-000001",
  reason: "Ακύρωση",
  pdfFile: "PDF missing / Λείπει το PDF",
});

const NET = "Καθαρό / Net";
const VAT = "ΦΠΑ / VAT";
const FEE = "Τέλη εκτός ΦΠΑ / Fees outside VAT";
const TOTAL = "Σύνολο / Total";

const build = (rows: ExportRow[], scope = monthScope("2026-11", rows.length)) =>
  buildWorkbook({ rows, scope, generatedOn: "2026-11-07" });

async function documents(rows: ExportRow[]) {
  const workbook = await readWorkbook(build(rows));
  return workbook.getWorksheet(DOCUMENTS_SHEET)!;
}

const parts = (bytes: Uint8Array) => {
  const files = unzipSync(bytes);
  return (name: string) => strFromU8(files[name]);
};

describe("the file itself", () => {
  const bytes = build([row(), deposit, credit]);
  const files = unzipSync(bytes);
  const part = parts(bytes);

  it("is a ZIP, with the content types first", () => {
    expect(new TextDecoder().decode(bytes.slice(0, 2))).toBe("PK");
    expect(Object.keys(files)[0]).toBe("[Content_Types].xml");
  });

  it("holds every part an .xlsx needs", () => {
    for (const name of [
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/sharedStrings.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/_rels/sheet1.xml.rels",
      "xl/tables/table1.xml",
    ]) {
      expect(Object.keys(files)).toContain(name);
    }
  });

  it("declares a type for every part it has, and has every part it declares", () => {
    const types = part("[Content_Types].xml");
    const declared = [...types.matchAll(/PartName="\/([^"]+)"/g)].map(
      (match) => match[1],
    );
    for (const name of declared) expect(Object.keys(files)).toContain(name);
    for (const name of Object.keys(files)) {
      if (name.endsWith(".rels") || name === "[Content_Types].xml") continue;
      expect(declared).toContain(name);
    }
  });

  it("every relationship points at a real part", () => {
    const resolve = (from: string, target: string) => {
      const parts = from.split("/").slice(0, -1);
      for (const step of target.split("/")) {
        if (step === "..") parts.pop();
        else parts.push(step);
      }
      return parts.join("/");
    };
    const check = (rels: string, base: string) => {
      for (const [, target] of part(rels).matchAll(/Target="([^"]+)"/g)) {
        expect(Object.keys(files)).toContain(resolve(base, target));
      }
    };
    check("_rels/.rels", "x");
    check("xl/_rels/workbook.xml.rels", "xl/workbook.xml");
    check("xl/worksheets/_rels/sheet1.xml.rels", "xl/worksheets/sheet1.xml");
  });

  it("writes the worksheet parts in the order Excel requires", () => {
    const xml = part("xl/worksheets/sheet1.xml");
    const order = [
      "<sheetViews>",
      "<sheetFormatPr",
      "<cols>",
      "<sheetData>",
      "<pageMargins",
      "<pageSetup",
      "<tableParts",
    ].map((tag) => xml.indexOf(tag));
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("has a matching shared string count", () => {
    const xml = part("xl/sharedStrings.xml");
    const unique = Number(/uniqueCount="(\d+)"/.exec(xml)![1]);
    expect(xml.match(/<si>/g)).toHaveLength(unique);
  });

  it("has as many cell styles as it declares, and uses only those", () => {
    const styles = part("xl/styles.xml");
    const count = Number(/<cellXfs count="(\d+)"/.exec(styles)![1]);
    const block = /<cellXfs.*<\/cellXfs>/.exec(styles)![0];
    expect(block.match(/<xf /g)).toHaveLength(count);
    for (const name of [
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
    ]) {
      for (const [, style] of part(name).matchAll(/ s="(\d+)"/g)) {
        expect(Number(style)).toBeLessThan(count);
      }
    }
  });
});

describe("the Documents sheet", () => {
  it("has the right sheets, nothing hidden", async () => {
    const workbook = await readWorkbook(build([row()]));
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      DOCUMENTS_SHEET,
      SUMMARY_SHEET,
    ]);
    for (const sheet of workbook.worksheets) {
      expect(sheet.state).not.toBe("hidden");
      expect(sheet.columns.some((column) => column.hidden)).toBe(false);
    }
  });

  it("has Greek and English headers", async () => {
    const sheet = await documents([row()]);
    const headers = DOCUMENT_HEADERS.map(
      (_, index) => sheet.getRow(1).getCell(index + 1).value,
    );
    expect(headers).toEqual(DOCUMENT_HEADERS);
    expect(headers).toContain("ΑΦΜ / VAT number");
  });

  it("freezes the header row", async () => {
    const sheet = await documents([row()]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("is a real table with a filter, a totals row and matching titles", () => {
    const part = parts(build([row(), deposit, credit]));
    const xml = part("xl/tables/table1.xml");
    expect(xml).toContain('ref="A1:V5"');
    expect(xml).toContain('totalsRowCount="1"');
    expect(xml).toContain('<autoFilter ref="A1:V4"/>');
    expect(xml).toContain('name="InvoiceDocuments"');
    expect(xml.match(/<tableColumn /g)).toHaveLength(DOCUMENT_HEADERS.length);
    expect(xml).toContain('<tableColumns count="22">');
    for (const title of DOCUMENT_HEADERS) {
      expect(xml).toContain(`name="${title}"`);
    }
    expect(xml.match(/totalsRowFunction="sum"/g)).toHaveLength(4);
  });

  it("gives every column a sensible width", async () => {
    const sheet = await documents([row()]);
    for (const column of sheet.columns) {
      expect(column.width).toBeGreaterThanOrEqual(10);
      expect(column.width).toBeLessThanOrEqual(40);
    }
  });

  it("stores dates as real dates, shown the Greek way", async () => {
    const sheet = await documents([row()]);
    const cell = sheet.getRow(2).getCell(columnOf(sheet, "Ημερομηνία / Date"));
    expect(cell.type).toBe(ValueType.Date);
    expect((cell.value as Date).toISOString().slice(0, 10)).toBe("2026-11-07");
    expect(cell.numFmt).toBe("dd/mm/yyyy");
  });

  it("stores money as numbers with a euro format, never text", async () => {
    const sheet = await documents([row()]);
    for (const [title, value] of [
      [NET, 864],
      [VAT, 112.32],
      [FEE, 15],
      [TOTAL, 991.32],
    ] as const) {
      const cell = sheet.getRow(2).getCell(columnOf(sheet, title));
      expect(cell.type).toBe(ValueType.Number);
      expect(cell.value).toBe(value);
      expect(cell.numFmt).toContain("0.00");
      expect(cell.numFmt).toContain("€");
    }
  });

  it("shows credit notes as negative", async () => {
    const sheet = await documents([credit]);
    const money = (title: string) =>
      sheet.getRow(2).getCell(columnOf(sheet, title)).value;
    expect(money(NET)).toBe(-100);
    expect(money(VAT)).toBe(-13);
    expect(money(FEE)).toBe(-2);
    expect(money(TOTAL)).toBe(-115);
  });

  it("keeps Greek text exactly", async () => {
    const sheet = await documents([row()]);
    const cell = sheet.getRow(2).getCell(columnOf(sheet, "Πελάτης / Customer"));
    expect(cell.type).toBe(ValueType.String);
    expect(cell.value).toBe("Μαρία Παπαδοπούλου");
  });

  it("labels the type and payment method in both languages", async () => {
    const sheet = await documents([deposit]);
    const text = (title: string) =>
      sheet.getRow(2).getCell(columnOf(sheet, title)).value;
    expect(text("Τύπος / Type")).toBe("Τιμολόγιο / Invoice");
    expect(text("Τρόπος πληρωμής / Payment method")).toBe(
      "Τραπεζική μεταφορά / Bank transfer",
    );
  });

  it("keeps the flag for the accountant and the PDF column", async () => {
    const sheet = await documents([deposit, credit]);
    const note = columnOf(sheet, "Σημείωση / Note");
    const pdf = columnOf(sheet, "PDF");
    expect(sheet.getRow(2).getCell(note).value).toBe(TO_CONFIRM_NOTE);
    expect(sheet.getRow(3).getCell(pdf).value).toBe(
      "PDF missing / Λείπει το PDF",
    );
  });

  it("has the columns the file always had", () => {
    expect(DOCUMENT_HEADERS).toHaveLength(22);
    for (const title of [
      "Προσωρινό / Provisional",
      "Συναλλαγή / Transaction",
      "Συντελεστές ΦΠΑ / VAT rates",
      "Πιστώνει / Credits",
      "Αιτία / Reason",
      "Στάλθηκε / Sent",
    ]) {
      expect(DOCUMENT_HEADERS).toContain(title);
    }
  });
});

describe("the totals row", () => {
  it("adds up Net, VAT, Fee and Total, with credit notes taken off", async () => {
    const sheet = await documents([row(), deposit, credit]);
    const totals = rowStarting(sheet, TOTAL);
    expect(totals.number).toBe(5);
    for (const [title, value] of [
      [NET, 1023.2],
      [VAT, 133.02],
      [FEE, 17.5],
      [TOTAL, 1173.72],
    ] as const) {
      const cell = totals.getCell(columnOf(sheet, title));
      expect(cell.type).toBe(ValueType.Formula);
      expect(cell.result).toBe(value);
      expect(cell.formula).toBe(`SUBTOTAL(109,[${title}])`);
    }
  });

  it("leaves the other columns empty", async () => {
    const sheet = await documents([row()]);
    const totals = rowStarting(sheet, TOTAL);
    const customer = columnOf(sheet, "Πελάτης / Customer");
    expect(totals.getCell(customer).value).toBeNull();
  });

  it("adds up exactly, with no float drift", async () => {
    const rows = Array.from({ length: 300 }, (_, index) =>
      row({
        documentNumber: `N-${index}`,
        netCents: 1,
        vatCents: 0,
        feeCents: 0,
        totalCents: 7,
      }),
    );
    const sheet = await documents(rows);
    const totals = rowStarting(sheet, TOTAL);
    expect(totals.getCell(columnOf(sheet, TOTAL)).result).toBe(21);
    expect(totals.getCell(columnOf(sheet, NET)).result).toBe(3);
  });
});

describe("text that looks like something else", () => {
  const hostile = [
    "=1+1",
    "=cmd|'/c calc'!A0",
    "+30 6900000000",
    "-2+3",
    "@SUM(A1)",
    '=HYPERLINK("http://evil.test","x")',
    "000123",
    "1e5",
    "2026-11-07",
    "TRUE",
    "12/11",
    "<b>bold</b> & co",
    '"quoted"',
    "  spaces kept  ",
    "Οδός 1, Αθήνα; 2ος",
  ];

  for (const value of hostile) {
    it(`keeps ${JSON.stringify(value)} as literal text`, async () => {
      const sheet = await documents([
        row({
          customerName: value,
          companyName: value,
          reason: value,
          vatNumber: value,
          address: value,
        }),
      ]);
      for (const title of [
        "Πελάτης / Customer",
        "Εταιρεία / Company",
        "Αιτία / Reason",
        "ΑΦΜ / VAT number",
        "Διεύθυνση / Address",
      ]) {
        const cell = sheet.getRow(2).getCell(columnOf(sheet, title));
        expect(cell.type).toBe(ValueType.String);
        expect(cell.value).toBe(value);
        expect(cell.numFmt).toBe("@");
      }
    });
  }

  it("has no formula anywhere but the four totals", () => {
    const part = parts(
      build([row({ customerName: "=1+1", reason: "=SUM(A1:A9)" }), deposit]),
    );
    const sheet = part("xl/worksheets/sheet1.xml");
    expect(sheet.match(/<f>/g)).toHaveLength(4);
    expect(part("xl/worksheets/sheet2.xml")).not.toContain("<f>");
  });

  it("drops characters XML cannot hold, which would corrupt the file", async () => {
    const bell = String.fromCodePoint(7);
    const lone = String.fromCharCode(0xd800);
    const sheet = await documents([
      row({
        customerName: `Ma${bell}ria${lone}`,
        reason: "line one\nline two",
      }),
    ]);
    const cell = (title: string) =>
      sheet.getRow(2).getCell(columnOf(sheet, title)).value;
    expect(cell("Πελάτης / Customer")).toBe("Maria");
    expect(cell("Αιτία / Reason")).toBe("line one\nline two");
  });

  it("cuts text at Excel's limit for one cell", async () => {
    const sheet = await documents([row({ reason: "x".repeat(40_000) })]);
    const value = sheet.getRow(2).getCell(columnOf(sheet, "Αιτία / Reason"))
      .value as string;
    expect(value).toHaveLength(32767);
  });

  it("copes with a word from another script", async () => {
    const sheet = await documents([row({ customerName: "अनिता 😀" })]);
    expect(
      sheet.getRow(2).getCell(columnOf(sheet, "Πελάτης / Customer")).value,
    ).toBe("अनिता 😀");
  });
});

describe("the Summary sheet", () => {
  async function summary(rows: ExportRow[], scope?: string[]) {
    const workbook = await readWorkbook(build(rows, scope));
    return workbook.getWorksheet(SUMMARY_SHEET)!;
  }

  const texts = (sheet: ExcelJS.Worksheet) => {
    const found: unknown[] = [];
    sheet.eachRow((line) => found.push(line.getCell(1).value));
    return found;
  };

  /** Rows are looked up within their own block, as both end in a total. */
  function block(sheet: ExcelJS.Worksheet, heading: string) {
    const start = rowStarting(sheet, heading).number;
    return (label: string) => {
      for (let number = start + 1; number <= sheet.rowCount; number += 1) {
        const line = sheet.getRow(number);
        if (line.getCell(1).value === label) {
          return [2, 3, 4, 5, 6].map((cell) => line.getCell(cell).value);
        }
      }
      throw new Error(label);
    };
  }

  it("adds up by document type, with real numbers", async () => {
    const sheet = await summary([row(), deposit, credit]);
    const line = block(sheet, "Ανά τύπο / By document type");
    expect(line("Απόδειξη / Receipt")).toEqual([1, 864, 112.32, 15, 991.32]);
    expect(line("Τιμολόγιο / Invoice")).toEqual([1, 259.2, 33.7, 4.5, 297.4]);
    expect(line("Πιστωτικό / Credit note")).toEqual([1, -100, -13, -2, -115]);
    expect(line(TOTAL)).toEqual([3, 1023.2, 133.02, 17.5, 1173.72]);
  });

  it("adds up by payment method", async () => {
    const sheet = await summary([
      row(),
      deposit,
      credit,
      row({ paymentMethod: "" }),
    ]);
    const line = block(sheet, "Ανά τρόπο πληρωμής / By payment method");
    expect(line("Κάρτα / Card")[0]).toBe(2);
    expect(line("Τραπεζική μεταφορά / Bank transfer")[4]).toBe(297.4);
    expect(line("Χωρίς / None")[0]).toBe(1);
  });

  it("stores its amounts as numbers", async () => {
    const sheet = await summary([row()]);
    const start = rowStarting(sheet, "Ανά τύπο / By document type").number;
    const cell = sheet.getRow(start + 1).getCell(6);
    expect(cell.type).toBe(ValueType.Number);
    expect(cell.numFmt).toContain("€");
  });

  it("shows what the file covers and when it was made", async () => {
    const sheet = await summary([row()]);
    expect(texts(sheet)).toContain("Μήνας / Month: 2026-11");
    const generated = rowStarting(sheet, "Δημιουργήθηκε / Generated").getCell(
      2,
    );
    expect(generated.type).toBe(ValueType.Date);
    expect((generated.value as Date).toISOString().slice(0, 10)).toBe(
      "2026-11-07",
    );
  });

  it("warns while documents are provisional and details are dummy", async () => {
    const sheet = await summary([row()]);
    expect(texts(sheet)).toContain(PROVISIONAL_NOTE);
    expect(texts(sheet)).toContain(DUMMY_NOTE);
  });

  it("drops the warnings once they are no longer true", async () => {
    const sheet = await summary([
      row({ isProvisional: false, hasDummyIssuer: false }),
    ]);
    expect(texts(sheet)).not.toContain(PROVISIONAL_NOTE);
    expect(texts(sheet)).not.toContain(DUMMY_NOTE);
  });

  it("describes a selection and the filter it came from", async () => {
    const scope = selectionScope(
      2,
      parseFilters({ month: "2026-11", guest: "Μαρία", page: "3" }),
    );
    const sheet = await summary([row()], scope);
    expect(texts(sheet)).toContain(
      "Επιλεγμένα παραστατικά / Selected documents: 2",
    );
    expect(texts(sheet)).toContain("Φίλτρο / Filter, Μήνας / Month: 2026-11");
    expect(texts(sheet)).toContain("Φίλτρο / Filter, Πελάτης / Guest: Μαρία");
    expect(scope.join()).not.toContain("3");
  });

  it("says so when a selection had no filter", () => {
    expect(selectionScope(1, parseFilters({})).join()).toContain("none");
  });

  it("does not run a filter typed as a formula", async () => {
    const scope = selectionScope(1, parseFilters({ guest: "=1+1" }));
    const sheet = await summary([row()], scope);
    expect(texts(sheet)).toContain("Φίλτρο / Filter, Πελάτης / Guest: =1+1");
  });
});

describe("an empty month", () => {
  it("still makes a valid file, with no table to corrupt it", async () => {
    const bytes = build([]);
    expect(Object.keys(unzipSync(bytes))).not.toContain("xl/tables/table1.xml");
    const workbook = await readWorkbook(bytes);
    const sheet = workbook.getWorksheet(DOCUMENTS_SHEET)!;
    expect(sheet.getRow(1).getCell(1).value).toBe(DOCUMENT_HEADERS[0]);
    expect(sheet.rowCount).toBe(1);
  });
});

describe("the small pieces", () => {
  it("names columns", () => {
    expect(columnName(0)).toBe("A");
    expect(columnName(25)).toBe("Z");
    expect(columnName(26)).toBe("AA");
    expect(columnName(51)).toBe("AZ");
    expect(columnName(52)).toBe("BA");
  });

  it("writes cents as exact decimals", () => {
    expect(euros(99132)).toBe("991.32");
    expect(euros(5)).toBe("0.05");
    expect(euros(-11500)).toBe("-115.00");
    expect(euros(0)).toBe("0.00");
  });

  it("uses Excel's date numbers", () => {
    expect(excelDate("1970-01-01")).toBe(25569);
    expect(excelDate("2026-11-07")).toBe(46333);
  });

  it("escapes XML", () => {
    expect(xmlText(`a<b>&"c`)).toBe("a&lt;b&gt;&amp;&quot;c");
  });

  it("escapes marks a table column name cannot hold in a formula", () => {
    expect(tableSumFormula("Net [#1]")).toBe(`SUBTOTAL(109,[Net '['#1']])`);
  });
});
