import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatDate, formatEuro, formatPercent, issuedOn } from "./format";
import {
  FONT_BOLD,
  FONT_REGULAR,
  fontFile,
  plainOnly,
  printable,
} from "./fonts";
import { needsAccountantCheck, vatBreakdown } from "./lines";
import type {
  Customer,
  DocType,
  DocumentLine,
  Issuer,
  PaymentMethod,
} from "./types";

// Makes the PDF for one document, from stored data only. Nothing here reads
// the clock, the settings or chance, so the same document always gives the
// same bytes, and a lost PDF can be made again exactly (see tests).

export const PROVISIONAL_EL = "ΠΡΟΣΩΡΙΝΟ, ΟΧΙ ΦΟΡΟΛΟΓΙΚΟ ΠΑΡΑΣΤΑΤΙΚΟ";
export const PROVISIONAL_EN = "PROVISIONAL, NOT A TAX DOCUMENT";

const TITLES: Record<DocType, string> = {
  receipt: "ΑΠΟΔΕΙΞΗ / RECEIPT",
  invoice: "ΤΙΜΟΛΟΓΙΟ / INVOICE",
  credit_note: "ΠΙΣΤΩΤΙΚΟ / CREDIT NOTE",
};

const METHODS: Record<PaymentMethod, string> = {
  card: "Κάρτα / Card",
  cash: "Μετρητά / Cash",
  bank_transfer: "Τραπεζική μεταφορά / Bank transfer",
  pos: "POS",
};

export interface PdfInput {
  documentNumber: string;
  docType: DocType;
  issuedAt: string;
  isProvisional: boolean;
  issuer: Issuer;
  customer: Customer;
  lines: DocumentLine[];
  netCents: number;
  vatCents: number;
  feeCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod | null;
  bookingReference: string;
  /** For a credit note: the document it corrects. */
  creditsDocumentNumber: string | null;
  reason: string | null;
}

const WIDTH = 595.28;
const HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT = WIDTH - MARGIN * 2;
const BANNER_HEIGHT = 44;

const INK = rgb(0.12, 0.16, 0.2);
const MUTED = rgb(0.32, 0.38, 0.43);
const LINE = rgb(0.8, 0.82, 0.85);
const BRAND = rgb(0.09, 0.31, 0.42);
const WARNING = rgb(0.72, 0.07, 0.07);
const WHITE = rgb(1, 1, 1);

/** One line of drawing, moving down the page. */
class Sheet {
  page!: PDFPage;
  y = 0;
  readonly pages: PDFPage[] = [];

  constructor(
    private readonly doc: PDFDocument,
    readonly regular: PDFFont,
    readonly bold: PDFFont,
    private readonly isProvisional: boolean,
  ) {
    this.addPage();
  }

  addPage() {
    this.page = this.doc.addPage([WIDTH, HEIGHT]);
    this.pages.push(this.page);
    this.y = HEIGHT - MARGIN;
    if (this.isProvisional) {
      drawWatermark(this.page, this.bold);
      drawBanner(this.page, this.bold);
      this.y -= BANNER_HEIGHT + 14;
    }
  }

  /** Starts a new page if this much height will not fit. */
  need(height: number) {
    if (this.y - height < MARGIN + 24) this.addPage();
  }

  text(
    value: string,
    x: number,
    options: {
      size?: number;
      font?: PDFFont;
      color?: typeof INK;
      alignRightAt?: number;
    } = {},
  ) {
    const { size = 9.5, font = this.regular, color = INK } = options;
    const left =
      options.alignRightAt === undefined
        ? x
        : options.alignRightAt - font.widthOfTextAtSize(value, size);
    this.page.drawText(value, { x: left, y: this.y, size, font, color });
  }

  rule() {
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: WIDTH - MARGIN, y: this.y },
      thickness: 0.6,
      color: LINE,
    });
  }
}

function drawBanner(page: PDFPage, font: PDFFont) {
  const top = HEIGHT - MARGIN;
  page.drawRectangle({
    x: MARGIN,
    y: top - BANNER_HEIGHT,
    width: CONTENT,
    height: BANNER_HEIGHT,
    color: WARNING,
  });
  const centred = (text: string, y: number, size: number) =>
    page.drawText(text, {
      x: (WIDTH - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color: WHITE,
    });
  centred(PROVISIONAL_EL, top - 19, 13);
  centred(PROVISIONAL_EN, top - 36, 13);
}

function drawWatermark(page: PDFPage, font: PDFFont) {
  const angle = 52;
  const size = 30;
  const radians = (angle * Math.PI) / 180;
  [PROVISIONAL_EL, PROVISIONAL_EN].forEach((text, index) => {
    const half = font.widthOfTextAtSize(text, size) / 2;
    // Two lines side by side, both centred on the middle of the page.
    const offset = (index - 0.5) * 46;
    page.drawText(text, {
      x: WIDTH / 2 - half * Math.cos(radians) + offset * Math.sin(radians),
      y: HEIGHT / 2 - half * Math.sin(radians) - offset * Math.cos(radians),
      size,
      font,
      color: WARNING,
      opacity: 0.13,
      rotate: degrees(angle),
    });
  });
}

/** Breaks text to fit a width, cutting a word only if it alone is too long. */
export function wrapText(
  text: string,
  font: PDFFont,
  size: number,
  width: number,
): string[] {
  const fits = (value: string) => font.widthOfTextAtSize(value, size) <= width;
  const lines: string[] = [];
  let line = "";

  for (const word of text.replace(/\s+/g, " ").trim().split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (fits(next)) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function issuerLines(issuer: Issuer): string[] {
  return [
    issuer.legalName,
    issuer.address,
    issuer.vatNumber && `ΑΦΜ / VAT: ${issuer.vatNumber}`,
    issuer.taxOffice && `ΔΟΥ / Tax office: ${issuer.taxOffice}`,
    issuer.phone,
    issuer.email,
  ].filter(Boolean);
}

function customerLines(customer: Customer): string[] {
  return [
    customer.companyName,
    customer.name,
    customer.address,
    customer.vatNumber && `ΑΦΜ / VAT: ${customer.vatNumber}`,
    customer.taxOffice && `ΔΟΥ / Tax office: ${customer.taxOffice}`,
    customer.email,
    customer.country,
  ].filter(Boolean);
}

function drawParties(sheet: Sheet, input: PdfInput) {
  const columnWidth = (CONTENT - 24) / 2;
  const columns = [
    {
      x: MARGIN,
      heading: "ΕΚΔΟΤΗΣ / ISSUER",
      rows: issuerLines(input.issuer),
    },
    {
      x: MARGIN + columnWidth + 24,
      heading: "ΠΕΛΑΤΗΣ / CUSTOMER",
      rows: customerLines(input.customer),
    },
  ].map((column) => ({
    ...column,
    rows: column.rows.flatMap((row) =>
      wrapText(row, sheet.regular, 9.5, columnWidth),
    ),
  }));

  const top = sheet.y;
  let lowest = top;
  for (const { x, heading, rows } of columns) {
    sheet.y = top;
    sheet.text(heading, x, { font: sheet.bold, size: 8.5, color: MUTED });
    for (const row of rows) {
      sheet.y -= 13;
      sheet.text(row, x);
    }
    lowest = Math.min(lowest, sheet.y);
  }
  sheet.y = lowest - 18;
}

function drawFacts(sheet: Sheet, input: PdfInput) {
  const facts = [
    ["Αριθμός / Number", input.documentNumber],
    ["Ημερομηνία / Date", formatDate(issuedOn(input.issuedAt))],
    ["Κράτηση / Booking", input.bookingReference || "-"],
    [
      "Πληρωμή / Payment",
      input.paymentMethod ? METHODS[input.paymentMethod] : "-",
    ],
  ];
  const columnWidth = CONTENT / facts.length;
  const top = sheet.y;
  facts.forEach(([label, value], index) => {
    const x = MARGIN + index * columnWidth;
    sheet.y = top;
    sheet.text(label, x, { font: sheet.bold, size: 8.5, color: MUTED });
    wrapText(value, sheet.regular, 9.5, columnWidth - 8)
      .slice(0, 2)
      .forEach((row, rowIndex) => {
        sheet.y = top - 13 * (rowIndex + 1);
        sheet.text(row, x);
      });
  });
  sheet.y = top - 13 * 3 - 8;
}

const COLUMNS = {
  description: MARGIN,
  quantityRight: 345,
  unitRight: 420,
  vatRight: 485,
  totalRight: WIDTH - MARGIN,
};
const DESCRIPTION_WIDTH = 265;

function drawTableHead(sheet: Sheet) {
  const options = { font: sheet.bold, size: 8.5, color: MUTED };
  sheet.text("Περιγραφή / Description", COLUMNS.description, options);
  sheet.text("Ποσ. / Qty", 0, {
    ...options,
    alignRightAt: COLUMNS.quantityRight,
  });
  sheet.text("Τιμή / Unit", 0, { ...options, alignRightAt: COLUMNS.unitRight });
  sheet.text("ΦΠΑ / VAT", 0, { ...options, alignRightAt: COLUMNS.vatRight });
  sheet.text("Σύνολο / Total", 0, {
    ...options,
    alignRightAt: COLUMNS.totalRight,
  });
  sheet.y -= 6;
  sheet.rule();
  sheet.y -= 14;
}

function drawLine(sheet: Sheet, line: DocumentLine) {
  const rows = wrapText(
    line.description,
    sheet.regular,
    9.5,
    DESCRIPTION_WIDTH,
  );
  const height = rows.length * 13 + 4;
  if (sheet.y - height < MARGIN + 24) {
    sheet.addPage();
    drawTableHead(sheet);
  }
  const top = sheet.y;
  sheet.text(String(line.quantity), 0, {
    alignRightAt: COLUMNS.quantityRight,
  });
  sheet.text(formatEuro(line.unitCents), 0, {
    alignRightAt: COLUMNS.unitRight,
  });
  sheet.text(formatEuro(line.vatCents), 0, { alignRightAt: COLUMNS.vatRight });
  sheet.text(formatEuro(line.totalCents), 0, {
    alignRightAt: COLUMNS.totalRight,
  });
  rows.forEach((row, index) => {
    sheet.y = top - 13 * index;
    sheet.text(row, COLUMNS.description);
  });
  sheet.y = top - height;
}

function drawLines(sheet: Sheet, input: PdfInput) {
  sheet.need(60);
  drawTableHead(sheet);
  const fees = input.lines.filter((line) => line.kind === "fee");
  for (const line of input.lines.filter((l) => l.kind !== "fee")) {
    drawLine(sheet, line);
  }
  if (fees.length) {
    sheet.need(40);
    sheet.y -= 4;
    sheet.text("Εκτός ΦΠΑ / Outside VAT", COLUMNS.description, {
      font: sheet.bold,
      size: 8.5,
      color: MUTED,
    });
    sheet.y -= 14;
    for (const line of fees) drawLine(sheet, line);
  }
  sheet.rule();
  sheet.y -= 16;
}

function drawVat(sheet: Sheet, input: PdfInput) {
  const rows = vatBreakdown(input.lines);
  sheet.need(rows.length * 13 + 50);
  const options = { font: sheet.bold, size: 8.5, color: MUTED };
  sheet.text("Ανάλυση ΦΠΑ / VAT breakdown", MARGIN, options);
  sheet.y -= 14;
  sheet.text("Συντελεστής / Rate", MARGIN, options);
  sheet.text("Βάση / Base", 0, { ...options, alignRightAt: 230 });
  sheet.text("ΦΠΑ / VAT", 0, { ...options, alignRightAt: 300 });
  sheet.y -= 13;
  for (const row of rows) {
    sheet.text(row.basisPoints ? formatPercent(row.basisPoints) : "-", MARGIN);
    sheet.text(formatEuro(row.baseCents), 0, { alignRightAt: 230 });
    sheet.text(formatEuro(row.vatCents), 0, { alignRightAt: 300 });
    sheet.y -= 13;
  }
  sheet.y -= 8;
}

function drawTotals(sheet: Sheet, input: PdfInput) {
  const rows: [string, number][] = [
    ["Καθαρό / Net", input.netCents],
    ["ΦΠΑ / VAT", input.vatCents],
    ["Τέλη εκτός ΦΠΑ / Fees outside VAT", input.feeCents],
  ];
  sheet.need(rows.length * 14 + 40);
  for (const [label, cents] of rows) {
    sheet.text(label, 0, { alignRightAt: 455 });
    sheet.text(formatEuro(cents), 0, { alignRightAt: COLUMNS.totalRight });
    sheet.y -= 14;
  }
  sheet.y -= 2;
  sheet.text("ΣΥΝΟΛΟ / TOTAL", 0, {
    alignRightAt: 455,
    font: sheet.bold,
    size: 12,
  });
  sheet.text(formatEuro(input.totalCents), 0, {
    alignRightAt: COLUMNS.totalRight,
    font: sheet.bold,
    size: 12,
  });
  sheet.y -= 24;
}

function drawParagraph(sheet: Sheet, heading: string, body: string) {
  const rows = wrapText(body, sheet.regular, 9, CONTENT);
  sheet.need(rows.length * 12 + 18);
  sheet.text(heading, MARGIN, { font: sheet.bold, size: 8.5, color: MUTED });
  for (const row of rows) {
    sheet.y -= 12;
    sheet.text(row, MARGIN, { size: 9 });
  }
  sheet.y -= 16;
}

function drawNotes(sheet: Sheet, input: PdfInput) {
  if (input.creditsDocumentNumber) {
    drawParagraph(
      sheet,
      "Πιστώνει το παραστατικό / Credits document",
      input.creditsDocumentNumber,
    );
  }
  if (input.reason) drawParagraph(sheet, "Αιτία / Reason", input.reason);
  if (needsAccountantCheck(input.lines)) {
    drawParagraph(
      sheet,
      "Προς επιβεβαίωση από τον λογιστή / For the accountant to confirm",
      "Τα ποσά είναι αναλογία της κράτησης ή δεν αντιστοιχούν στην πλήρη τιμή της. / These amounts are a share of the booking, or do not match its full price.",
    );
  }
}

function drawFooters(sheet: Sheet, input: PdfInput) {
  sheet.pages.forEach((page, index) => {
    const text = `${input.documentNumber}   ${index + 1} / ${sheet.pages.length}`;
    const size = 8;
    page.drawText(text, {
      x: WIDTH - MARGIN - sheet.regular.widthOfTextAtSize(text, size),
      y: MARGIN - 8,
      size,
      font: sheet.regular,
      color: MUTED,
    });
  });
}

/**
 * Every stored string is made safe once, here, so no drawing code can meet
 * text the font library might refuse. No guest's name may stop a PDF.
 */
function safeInput(stored: PdfInput, fonts: PDFFont[]): PdfInput {
  const safe = (text: string): string => {
    const clean = printable(text);
    try {
      for (const font of fonts) font.widthOfTextAtSize(clean, 10);
      return clean;
    } catch {
      return plainOnly(clean);
    }
  };
  const safeAll = <T extends object>(record: T): T =>
    Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === "string" ? safe(value) : value,
      ]),
    ) as T;

  return {
    ...stored,
    documentNumber: safe(stored.documentNumber),
    issuer: safeAll(stored.issuer),
    customer: safeAll(stored.customer),
    lines: stored.lines.map((line) => ({
      ...line,
      description: safe(line.description),
    })),
    bookingReference: safe(stored.bookingReference),
    creditsDocumentNumber:
      stored.creditsDocumentNumber && safe(stored.creditsDocumentNumber),
    reason: stored.reason && safe(stored.reason),
  };
}

export async function renderInvoicePdf(stored: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(fontFile(FONT_REGULAR), {
    subset: false,
  });
  const bold = await doc.embedFont(fontFile(FONT_BOLD), {
    subset: false,
  });
  const input = safeInput(stored, [regular, bold]);

  // The library stamps the current time unless told otherwise.
  const issued = new Date(input.issuedAt);
  doc.setTitle(`Casa Filakopi ${input.documentNumber}`);
  doc.setAuthor("Casa Filakopi");
  doc.setCreator("Casa Filakopi");
  doc.setProducer("Casa Filakopi");
  doc.setCreationDate(issued);
  doc.setModificationDate(issued);

  const sheet = new Sheet(doc, regular, bold, input.isProvisional);

  sheet.y -= 14;
  sheet.text("Casa Filakopi", MARGIN, { font: bold, size: 20, color: BRAND });
  sheet.text(TITLES[input.docType], 0, {
    font: bold,
    size: 13,
    alignRightAt: WIDTH - MARGIN,
  });
  sheet.y -= 26;

  drawParties(sheet, input);
  drawFacts(sheet, input);
  drawLines(sheet, input);
  drawVat(sheet, input);
  drawTotals(sheet, input);
  drawNotes(sheet, input);
  drawFooters(sheet, input);

  return doc.save({ updateFieldAppearances: false });
}
