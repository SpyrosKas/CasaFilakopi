import { describe, expect, it } from "vitest";
import {
  PROVISIONAL_EL,
  PROVISIONAL_EN,
  renderInvoicePdf,
  type PdfInput,
} from "@/lib/invoicing/pdf";
import { parseCustomer, parseIssuer } from "@/lib/invoicing/types";
import { pdfText } from "../../pdf-text";

const input = (change: Partial<PdfInput> = {}): PdfInput => ({
  documentNumber: "TEST-I-000042",
  docType: "invoice",
  issuedAt: "2026-11-07T10:00:00Z",
  isProvisional: true,
  issuer: parseIssuer({
    legalName: "DUMMY Business Name",
    vatNumber: "000000000",
    taxOffice: "DUMMY Tax Office",
    address: "Dummy Street 1, 84800 Milos",
  }),
  customer: parseCustomer({
    name: "Μαρία Παπαδοπούλου",
    companyName: "ΔΟΚΙΜΗ Α.Ε.",
    vatNumber: "123456789",
    address: "Λεωφόρος Αθηνών 12",
    taxOffice: "Α' Αθηνών",
  }),
  lines: [
    {
      description: "Διαμονή / Accommodation",
      quantity: 7,
      unitCents: 22000,
      totalCents: 174020,
      vatCents: 20020,
      vatBasisPoints: 1300,
      kind: "accommodation",
    },
    {
      description:
        "Τέλος ανθεκτικότητας στην κλιματική κρίση / Climate resilience fee",
      quantity: 7,
      unitCents: 200,
      totalCents: 1400,
      vatCents: 0,
      vatBasisPoints: 0,
      kind: "fee",
    },
  ],
  netCents: 154000,
  vatCents: 20020,
  feeCents: 1400,
  totalCents: 175420,
  paymentMethod: "bank_transfer",
  bookingReference: "CF-2027-00012",
  creditsDocumentNumber: null,
  reason: null,
  ...change,
});

// pdf.js may split a line of text, so spaces are ignored when matching.
const squeezed = (text: string) => text.replace(/\s+/g, "");
const has = (text: string, wanted: string) =>
  expect(squeezed(text)).toContain(squeezed(wanted));

describe("the PDF", () => {
  it("is a real PDF", async () => {
    const bytes = await renderInvoicePdf(input());
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("carries the provisional mark in Greek and English", async () => {
    const text = await pdfText(await renderInvoicePdf(input()));
    has(text, "PROVISIONAL, NOT A TAX DOCUMENT");
    has(text, "ΠΡΟΣΩΡΙΝΟ, ΟΧΙ ΦΟΡΟΛΟΓΙΚΟ ΠΑΡΑΣΤΑΤΙΚΟ");
  });

  it("repeats the mark on every page", async () => {
    const lines = Array.from({ length: 90 }, (_, index) => ({
      ...input().lines[0],
      description: `Γραμμή ${index}`,
    }));
    const text = await pdfText(await renderInvoicePdf(input({ lines })));
    const pages = text.split("\n");
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      has(page, PROVISIONAL_EN);
      has(page, PROVISIONAL_EL);
    }
    has(text, "Γραμμή 89");
  });

  it("has no mark once a document is not provisional", async () => {
    const text = await pdfText(
      await renderInvoicePdf(input({ isProvisional: false })),
    );
    expect(squeezed(text)).not.toContain(squeezed(PROVISIONAL_EN));
    expect(squeezed(text)).not.toContain(squeezed(PROVISIONAL_EL));
  });

  it("holds everything INV-02 asks for, with Greek intact", async () => {
    const text = await pdfText(await renderInvoicePdf(input()));
    for (const wanted of [
      "DUMMY Business Name",
      "TEST-I-000042",
      "07/11/2026",
      "Μαρία Παπαδοπούλου",
      "ΔΟΚΙΜΗ Α.Ε.",
      "123456789",
      "Α' Αθηνών",
      "Διαμονή / Accommodation",
      "Τέλος ανθεκτικότητας στην κλιματική κρίση",
      "Εκτός ΦΠΑ / Outside VAT",
      "Ανάλυση ΦΠΑ / VAT breakdown",
      "13%",
      "1.754,20 €",
      "Τραπεζική μεταφορά",
      "CF-2027-00012",
    ]) {
      has(text, wanted);
    }
  });

  it("names the original and the reason on a credit note", async () => {
    const text = await pdfText(
      await renderInvoicePdf(
        input({
          docType: "credit_note",
          creditsDocumentNumber: "TEST-I-000001",
          reason: "Ακύρωση κράτησης",
        }),
      ),
    );
    has(text, "ΠΙΣΤΩΤΙΚΟ / CREDIT NOTE");
    has(text, "TEST-I-000001");
    has(text, "Ακύρωση κράτησης");
  });

  for (const kind of ["deposit", "balance", "other"] as const) {
    it(`flags a line of kind ${kind} for the accountant`, async () => {
      const text = await pdfText(
        await renderInvoicePdf(
          input({ lines: [{ ...input().lines[0], kind }] }),
        ),
      );
      has(text, "For the accountant to confirm");
      has(text, "Προς επιβεβαίωση από τον λογιστή");
    });
  }

  it("has no flag on an ordinary full payment", async () => {
    const text = await pdfText(await renderInvoicePdf(input()));
    expect(squeezed(text)).not.toContain(
      squeezed("For the accountant to confirm"),
    );
  });

  it("prints a Greek document number", async () => {
    const text = await pdfText(
      await renderInvoicePdf(input({ documentNumber: "ΑΠΥ-000001" })),
    );
    has(text, "ΑΠΥ-000001");
  });

  it("gives identical bytes every time, whatever the clock says", async () => {
    const first = await renderInvoicePdf(input());
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await renderInvoicePdf(input());
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("stays readable with characters the font lacks and long text", async () => {
    const text = await pdfText(
      await renderInvoicePdf(
        input({
          customer: parseCustomer({
            name: `😀 Νίκος ${"Χ".repeat(300)}`,
            email: `${"a".repeat(200)}@example.test`,
          }),
          reason: `line one\r\nline two ${"λ".repeat(500)}`,
        }),
      ),
    );
    // Every part survives, wrapped but complete, with the emoji replaced.
    has(text, "? Νίκος");
    has(text, "Χ".repeat(300));
    has(text, `${"a".repeat(200)}@example.test`);
    has(text, `line one line two ${"λ".repeat(500)}`);
    has(text, PROVISIONAL_EL);
    has(text, PROVISIONAL_EN);
    has(text, "1.754,20 €");
  });

  it("gives identical bytes for a name it has to replace", async () => {
    const odd = input({ customer: parseCustomer({ name: "अनिता 😀" }) });
    const first = await renderInvoicePdf(odd);
    const second = await renderInvoicePdf(odd);
    expect(Buffer.compare(first, second)).toBe(0);
  });

  it("copes with a document missing most details", async () => {
    const text = await pdfText(
      await renderInvoicePdf(
        input({
          issuer: parseIssuer({}),
          customer: parseCustomer({}),
          paymentMethod: null,
          bookingReference: "",
        }),
      ),
    );
    has(text, "TEST-I-000042");
  });
});
