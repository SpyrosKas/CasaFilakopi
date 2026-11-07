import { strToU8, zipSync, type Zippable } from "fflate";

// A small .xlsx writer, on the ZIP library already in use. An .xlsx is a ZIP of
// XML files, and this writes only what the accountant's file needs: text,
// numbers, dates, one table with a totals row, and a frozen header.
//
// Text is always a stored string with Excel's Text format. It is never parsed,
// so a guest called "=1+1" stays exactly that, and there is no locale for a
// number or date to be misread in. The table parts follow what XlsxWriter
// writes, whose output is tested against files from real Excel.

export const STYLE = {
  text: 1,
  date: 2,
  euro: 3,
  count: 4,
  header: 5,
  boldEuro: 6,
  boldCount: 7,
  warning: 8,
  title: 9,
  bold: 10,
} as const;

export type StyleName = keyof typeof STYLE;

export type Cell =
  | { kind: "text"; value: string; style?: StyleName }
  | { kind: "euro"; cents: number; style?: StyleName }
  | { kind: "count"; value: number; style?: StyleName }
  /** A calendar date, YYYY-MM-DD. */
  | { kind: "date"; value: string }
  /** A sum Excel works out, with the answer stored for readers that do not. */
  | { kind: "sum"; formula: string; cents: number }
  | { kind: "empty" };

export interface TableSpec {
  name: string;
  /** Column titles. They must match the first row of the sheet exactly. */
  columns: string[];
  /** The rows between the header and the totals row. At least one. */
  dataRows: number;
  /** The label in the first column of the totals row. */
  totalsLabel: string;
  /** Column indexes that show a sum in the totals row. */
  totalColumns: number[];
}

export interface Sheet {
  name: string;
  /** Column widths, in characters. */
  widths: number[];
  rows: Cell[][];
  /** Keeps the first row in view while scrolling. */
  freezeHeader?: boolean;
  /** Height of the first row, in points. */
  headerHeight?: number;
  table?: TableSpec;
}

const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const RELATIONSHIPS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_RELATIONSHIPS =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_TYPES =
  "http://schemas.openxmlformats.org/package/2006/content-types";
const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n`;

/** The most a single Excel cell can hold. */
const MAX_CELL_LENGTH = 32767;

/** 1 January 1970 as an Excel date number. */
const EXCEL_UNIX_EPOCH = 25569;
const MS_PER_DAY = 86_400_000;

/** A control character is not legal in XML, and would corrupt the whole file. */
function isLegalInXml(code: number): boolean {
  if (code === 0x9 || code === 0xa || code === 0xd) return true;
  if (code < 0x20) return false;
  if (code >= 0xd800 && code <= 0xdfff) return false;
  return code !== 0xfffe && code !== 0xffff;
}

export function xmlText(value: string): string {
  let clean = "";
  for (const char of value) {
    if (isLegalInXml(char.codePointAt(0)!)) clean += char;
  }
  return clean
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A, B ... Z, AA, AB. */
export function columnName(index: number): string {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

export function excelDate(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`) / MS_PER_DAY + EXCEL_UNIX_EPOCH;
}

/** Whole cents as euros, written exactly rather than through a float. */
export function euros(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const whole = Math.floor(Math.abs(cents) / 100);
  return `${sign}${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

/** Each text once, by number, the way Excel itself stores text. */
class SharedStrings {
  private readonly indexes = new Map<string, number>();
  private uses = 0;

  add(value: string): number {
    this.uses += 1;
    const known = this.indexes.get(value);
    if (known !== undefined) return known;
    const index = this.indexes.size;
    this.indexes.set(value, index);
    return index;
  }

  xml(): string {
    const items = [...this.indexes.keys()]
      .map((text) => `<si><t xml:space="preserve">${text}</t></si>`)
      .join("");
    return `${XML_HEAD}<sst xmlns="${MAIN}" count="${this.uses}" uniqueCount="${this.indexes.size}">${items}</sst>`;
  }
}

function cellXml(cell: Cell, ref: string, strings: SharedStrings): string {
  switch (cell.kind) {
    case "empty":
      return "";
    case "text": {
      const style = STYLE[cell.style ?? "text"];
      const text = xmlText(cell.value.slice(0, MAX_CELL_LENGTH));
      return `<c r="${ref}" s="${style}" t="s"><v>${strings.add(text)}</v></c>`;
    }
    case "euro":
      return `<c r="${ref}" s="${STYLE[cell.style ?? "euro"]}"><v>${euros(cell.cents)}</v></c>`;
    case "count":
      return `<c r="${ref}" s="${STYLE[cell.style ?? "count"]}"><v>${cell.value}</v></c>`;
    case "date":
      return `<c r="${ref}" s="${STYLE.date}"><v>${excelDate(cell.value)}</v></c>`;
    case "sum":
      return `<c r="${ref}" s="${STYLE.boldEuro}"><f>${xmlText(cell.formula)}</f><v>${euros(cell.cents)}</v></c>`;
  }
}

function sheetXml(sheet: Sheet, strings: SharedStrings): string {
  const view = sheet.freezeHeader
    ? `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>`
    : "";
  const cols = sheet.widths
    .map(
      (width, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`,
    )
    .join("");
  const rows = sheet.rows
    .map((cells, rowIndex) => {
      const number = rowIndex + 1;
      const cellsXml = cells
        .map((cell, column) =>
          cellXml(cell, `${columnName(column)}${number}`, strings),
        )
        .join("");
      const height =
        rowIndex === 0 && sheet.headerHeight
          ? ` ht="${sheet.headerHeight}" customHeight="1"`
          : "";
      return `<row r="${number}"${height}>${cellsXml}</row>`;
    })
    .join("");
  const table = sheet.table
    ? `<tableParts count="1"><tablePart r:id="rId1"/></tableParts>`
    : "";
  return `${XML_HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheetViews><sheetView workbookViewId="0">${view}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${rows}</sheetData><pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup orientation="landscape"/>${table}</worksheet>`;
}

function tableXml(table: TableSpec): string {
  const lastColumn = columnName(table.columns.length - 1);
  const lastData = table.dataRows + 1;
  const columns = table.columns
    .map((name, index) => {
      const totals =
        index === 0
          ? ` totalsRowLabel="${xmlText(table.totalsLabel)}"`
          : table.totalColumns.includes(index)
            ? ` totalsRowFunction="sum"`
            : "";
      return `<tableColumn id="${index + 1}" name="${xmlText(name)}"${totals}/>`;
    })
    .join("");
  return `${XML_HEAD}<table xmlns="${MAIN}" id="1" name="${table.name}" displayName="${table.name}" ref="A1:${lastColumn}${lastData + 1}" totalsRowCount="1"><autoFilter ref="A1:${lastColumn}${lastData}"/><tableColumns count="${table.columns.length}">${columns}</tableColumns><tableStyleInfo name="TableStyleLight15" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`;
}

/** What Excel itself stores in a table's totals row. */
export function tableSumFormula(columnTitle: string): string {
  const name = columnTitle.replace(/['#[\]]/g, (mark) => `'${mark}`);
  return `SUBTOTAL(109,[${name}])`;
}

const EURO_FORMAT = `#,##0.00\\ &quot;€&quot;`;
const DATE_FORMAT = "dd/mm/yyyy";

const STYLES = `${XML_HEAD}<styleSheet xmlns="${MAIN}"><numFmts count="2"><numFmt numFmtId="164" formatCode="${EURO_FORMAT}"/><numFmt numFmtId="165" formatCode="${DATE_FORMAT}"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFB01212"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="11"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="3" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const relationship = (id: string, type: string, target: string) =>
  `<Relationship Id="${id}" Type="${RELATIONSHIPS}/${type}" Target="${target}"/>`;

export function buildXlsx(sheets: Sheet[]): Uint8Array {
  const contentType = (part: string, type: string) =>
    `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`;

  const files: Record<string, string> = {
    "_rels/.rels": `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${relationship("rId1", "officeDocument", "xl/workbook.xml")}</Relationships>`,
    "xl/styles.xml": STYLES,
    "xl/workbook.xml": `${XML_HEAD}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><bookViews><workbookView/></bookViews><sheets>${sheets
      .map(
        (sheet, index) =>
          `<sheet name="${xmlText(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join(
        "",
      )}</sheets><calcPr calcId="124519" fullCalcOnLoad="1"/></workbook>`,
    "xl/_rels/workbook.xml.rels": `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${sheets
      .map((_, index) =>
        relationship(
          `rId${index + 1}`,
          "worksheet",
          `worksheets/sheet${index + 1}.xml`,
        ),
      )
      .join(
        "",
      )}${relationship(`rId${sheets.length + 1}`, "styles", "styles.xml")}${relationship(`rId${sheets.length + 2}`, "sharedStrings", "sharedStrings.xml")}</Relationships>`,
  };

  const strings = new SharedStrings();
  const overrides = [
    contentType("xl/workbook.xml", "sheet.main"),
    contentType("xl/styles.xml", "styles"),
    contentType("xl/sharedStrings.xml", "sharedStrings"),
  ];

  sheets.forEach((sheet, index) => {
    const number = index + 1;
    const part = `xl/worksheets/sheet${number}.xml`;
    files[part] = sheetXml(sheet, strings);
    overrides.push(contentType(part, "worksheet"));
    if (sheet.table) {
      const tablePart = `xl/tables/table${number}.xml`;
      files[tablePart] = tableXml(sheet.table);
      files[`xl/worksheets/_rels/sheet${number}.xml.rels`] =
        `${XML_HEAD}<Relationships xmlns="${PACKAGE_RELATIONSHIPS}">${relationship("rId1", "table", `../tables/table${number}.xml`)}</Relationships>`;
      overrides.push(contentType(tablePart, "table"));
    }
  });

  files["xl/sharedStrings.xml"] = strings.xml();
  files["[Content_Types].xml"] =
    `${XML_HEAD}<Types xmlns="${CONTENT_TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides.join("")}</Types>`;

  const zip: Zippable = {};
  // The first entry, as Excel itself writes it.
  const names = [
    "[Content_Types].xml",
    ...Object.keys(files).filter((name) => name !== "[Content_Types].xml"),
  ];
  for (const name of names) zip[name] = strToU8(files[name]);
  return zipSync(zip, { level: 6, mtime: new Date("2026-01-01T00:00:00Z") });
}
