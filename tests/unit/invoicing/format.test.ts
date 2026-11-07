import { describe, expect, it } from "vitest";
import {
  csvAmount,
  documentNumber,
  formatDate,
  formatEuro,
  formatPercent,
  issuedOn,
  parseEuros,
  pdfFileName,
  pdfStoragePath,
  previousMonth,
} from "@/lib/invoicing/format";
import { reviewRows } from "@/lib/invoicing/review";
import { isDummyIssuer } from "@/lib/invoicing/settings";
import { seedRefusal, setupRefusal } from "@/lib/invoicing/seed-guard";
import { parseCustomer, parseIssuer } from "@/lib/invoicing/types";

describe("money", () => {
  it("prints euros the Greek way", () => {
    expect(formatEuro(0)).toBe("0,00 €");
    expect(formatEuro(5)).toBe("0,05 €");
    expect(formatEuro(123456)).toBe("1.234,56 €");
    expect(formatEuro(123456789)).toBe("1.234.567,89 €");
    expect(formatEuro(-3390)).toBe("-33,90 €");
  });

  it("keeps export amounts plain", () => {
    expect(csvAmount(123456)).toBe("1234,56");
    expect(csvAmount(-5)).toBe("-0,05");
  });

  it("reads what is typed, with a comma or a point", () => {
    expect(parseEuros("12")).toBe(1200);
    expect(parseEuros("12,5")).toBe(1250);
    expect(parseEuros("12.50")).toBe(1250);
    expect(parseEuros(" 0,05 ")).toBe(5);
  });

  it("refuses anything else", () => {
    for (const text of ["", "abc", "-5", "1,234", "1.234,56", "1e3", "12,"]) {
      expect(parseEuros(text), text).toBeNull();
    }
  });
});

describe("dates and numbers", () => {
  it("prints the date", () => {
    expect(formatDate("2026-11-07")).toBe("07/11/2026");
  });

  it("uses the date on Milos, not the server's", () => {
    expect(issuedOn("2026-11-30T22:30:00Z")).toBe("2026-12-01");
    expect(issuedOn("2026-07-31T21:30:00Z")).toBe("2026-08-01");
  });

  it("finds the month before", () => {
    expect(previousMonth(new Date("2026-11-07T10:00:00Z"))).toBe("2026-10");
    expect(previousMonth(new Date("2027-01-15T10:00:00Z"))).toBe("2026-12");
  });

  it("numbers documents like the database does", () => {
    expect(documentNumber("TEST-R", 12)).toBe("TEST-R-000012");
  });

  it("prints a rate", () => {
    expect(formatPercent(1300)).toBe("13%");
    expect(formatPercent(650)).toBe("6,5%");
    expect(formatPercent(1234)).toBe("12,34%");
  });
});

describe("the storage path", () => {
  it("is year, month and number, by the date on Milos", () => {
    expect(pdfStoragePath("TEST-R-000012", "2026-11-30T22:30:00Z")).toBe(
      "2026/12/TEST-R-000012.pdf",
    );
  });

  it("cannot be walked out of, whatever the prefix says", () => {
    const name = pdfFileName("../../etc/Ψ-000001");
    expect(name).not.toContain("/");
    expect(name).toBe(".._.._etc__-000001.pdf");
  });
});

describe("reading stored documents", () => {
  it("never fails on an old or odd document", () => {
    expect(parseCustomer({ name: "Test Guest" }).companyName).toBe("");
    expect(parseCustomer(null).name).toBe("");
    expect(parseIssuer({ legalName: 7 }).legalName).toBe("");
  });
});

describe("dummy details", () => {
  const real = {
    legalName: "Real Ltd",
    vatNumber: "123456789",
    taxOffice: "Milos",
    address: "1 Road",
    phone: "",
    email: "",
  };

  it("spots the seed's placeholders", () => {
    expect(isDummyIssuer({ ...real, legalName: "DUMMY Business Name" })).toBe(
      true,
    );
    expect(isDummyIssuer({ ...real, vatNumber: "000000000" })).toBe(true);
    expect(isDummyIssuer({ ...real, address: "" })).toBe(true);
  });

  it("accepts real ones", () => {
    expect(isDummyIssuer(real)).toBe(false);
  });
});

describe("reviewing a selection", () => {
  const row = (change: object) => ({
    id: "a",
    documentNumber: "TEST-R-000001",
    docType: "receipt" as const,
    issuedOn: "2026-11-07",
    hasPdf: true,
    isSent: false,
    sentOn: null,
    bookingReference: "",
    guestNames: [],
    paymentMethod: null,
    transactionIds: [],
    creditsInvoiceId: null,
    totalCents: 1000,
    netCents: 1000,
    vatCents: 0,
    feeCents: 0,
    ...change,
  });

  it("names missing PDFs and sent documents, and adds up", () => {
    const review = reviewRows([
      row({}),
      row({ id: "b", documentNumber: "B", hasPdf: false }),
      row({ id: "c", documentNumber: "C", isSent: true, sentOn: "2026-11-01" }),
      row({ id: "d", docType: "credit_note", totalCents: 400 }),
    ]);
    expect(review.count).toBe(4);
    expect(review.totalCents).toBe(2600);
    expect(review.missingPdf).toEqual([{ id: "b", documentNumber: "B" }]);
    expect(review.alreadySent).toEqual([
      { id: "c", documentNumber: "C", sentOn: "2026-11-01" },
    ]);
  });
});

describe("the demo data guard", () => {
  const local = "http://127.0.0.1:54321";

  it("runs locally", () => {
    expect(
      seedRefusal({ supabaseUrl: local, names: [], stagingFlag: false }),
    ).toBeNull();
  });

  it("refuses anything named production", () => {
    for (const target of [
      { supabaseUrl: "https://casa-prod.supabase.co", names: [] },
      { supabaseUrl: local, names: ["production"] },
      { supabaseUrl: local, names: [undefined, "PRODUCTION"] },
      { supabaseUrl: "https://abc.supabase.co", names: ["Prod-EU"] },
    ]) {
      expect(seedRefusal({ ...target, stagingFlag: true })).toMatch(
        /production/,
      );
    }
  });

  it("needs --staging for anything not local", () => {
    const remote = { supabaseUrl: "https://abc.supabase.co", names: [] };
    expect(seedRefusal({ ...remote, stagingFlag: false })).toMatch(/--staging/);
    expect(seedRefusal({ ...remote, stagingFlag: true })).toBeNull();
  });

  it("a hostname cannot pretend to be local", () => {
    expect(
      seedRefusal({
        supabaseUrl: "http://127.0.0.1.evil.test",
        names: [],
        stagingFlag: false,
      }),
    ).toMatch(/--staging/);
  });

  it("stops if the database is not a dummy, provisional setup", () => {
    const good = { isStored: true, isProvisional: true, isDummy: true };
    expect(setupRefusal(good)).toBeNull();
    expect(setupRefusal({ ...good, isStored: false })).toMatch(/missing/);
    expect(setupRefusal({ ...good, isProvisional: false })).toMatch(
      /provisional/,
    );
    expect(setupRefusal({ ...good, isDummy: false })).toMatch(/real/);
  });
});
