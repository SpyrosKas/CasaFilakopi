import { describe, expect, it } from "vitest";
import {
  plainAmount,
  formatDate,
  formatEuro,
  formatPercent,
  issuedOn,
  parseEuros,
  pdfFileName,
  pdfStoragePath,
  previousMonth,
  zipEntryName,
} from "@/lib/invoicing/format";
import { reviewRows } from "@/lib/invoicing/review";
import { isDummyIssuer } from "@/lib/invoicing/settings";
import {
  seedRefusal,
  setupRefusal,
  STAGING_PROJECT_REF,
  stagingRefFrom,
} from "@/lib/invoicing/seed-guard";
import { parseCustomer, parseIssuer } from "@/lib/invoicing/types";

describe("money", () => {
  it("prints euros the Greek way", () => {
    expect(formatEuro(0)).toBe("0,00 €");
    expect(formatEuro(5)).toBe("0,05 €");
    expect(formatEuro(123456)).toBe("1.234,56 €");
    expect(formatEuro(123456789)).toBe("1.234.567,89 €");
    expect(formatEuro(-3390)).toBe("-33,90 €");
  });

  it("keeps an amount plain for a form box", () => {
    expect(plainAmount(123456)).toBe("1234,56");
    expect(plainAmount(-5)).toBe("-0,05");
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

  it("prints a rate", () => {
    expect(formatPercent(1300)).toBe("13%");
    expect(formatPercent(650)).toBe("6,5%");
    expect(formatPercent(1234)).toBe("12,34%");
  });
});

describe("the storage path", () => {
  const id = "11111111-2222-4333-8444-555555555555";

  it("is year, month and document id, by the date on Milos", () => {
    expect(pdfStoragePath(id, "2026-11-30T22:30:00Z")).toBe(
      `2026/12/${id}.pdf`,
    );
  });

  it("is plain ASCII, as storage keys must be", () => {
    expect(pdfStoragePath(id, "2026-11-30T22:30:00Z")).toMatch(
      /^[a-z0-9/.-]+$/,
    );
  });
});

describe("file names", () => {
  const a = "aaaaaaaa-2222-4333-8444-555555555555";
  const b = "bbbbbbbb-2222-4333-8444-555555555555";

  it("keep Greek readable", () => {
    expect(pdfFileName("ΑΠΥ-000001")).toBe("ΑΠΥ-000001.pdf");
  });

  it("cannot be walked out of, whatever the prefix says", () => {
    for (const number of ["../../etc/Ψ-000001", "..\\x", "/etc/passwd"]) {
      const name = pdfFileName(number);
      expect(name).not.toMatch(/[/\\]/);
      expect(name.startsWith(".")).toBe(false);
    }
  });

  it("never come out empty", () => {
    expect(pdfFileName("...")).toBe("document.pdf");
  });

  it("are unique in a ZIP, even for numbers that look alike", () => {
    expect(zipEntryName("ΑΠΥ-000001", a)).toBe("ΑΠΥ-000001-aaaaaaaa.pdf");
    expect(zipEntryName("Α/Β-1", a)).not.toBe(zipEntryName("Α:Β-1", b));
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
  const staging = `https://${STAGING_PROJECT_REF}.supabase.co`;
  const other = "https://abcdefghijklmnopqrst.supabase.co";

  it("runs locally", () => {
    expect(
      seedRefusal({ supabaseUrl: local, names: [], stagingRef: undefined }),
    ).toBeNull();
  });

  it("refuses anything named production, even with the right ref", () => {
    for (const target of [
      { supabaseUrl: "https://casa-prod.supabase.co", names: [] },
      { supabaseUrl: local, names: ["production"] },
      { supabaseUrl: local, names: [undefined, "PRODUCTION"] },
      { supabaseUrl: staging, names: ["Prod-EU"] },
    ]) {
      expect(
        seedRefusal({ ...target, stagingRef: STAGING_PROJECT_REF }),
      ).toMatch(/production/);
    }
  });

  it("the staging project runs only with its own ref typed", () => {
    expect(
      seedRefusal({
        supabaseUrl: staging,
        names: [],
        stagingRef: STAGING_PROJECT_REF,
      }),
    ).toBeNull();
  });

  it("refuses every other way of asking for a remote project", () => {
    for (const target of [
      { supabaseUrl: staging, stagingRef: undefined },
      { supabaseUrl: staging, stagingRef: "" },
      { supabaseUrl: staging, stagingRef: "abcdefghijklmnopqrst" },
      { supabaseUrl: other, stagingRef: STAGING_PROJECT_REF },
      { supabaseUrl: other, stagingRef: "abcdefghijklmnopqrst" },
      {
        supabaseUrl: `https://${STAGING_PROJECT_REF}.supabase.co.evil.test`,
        stagingRef: STAGING_PROJECT_REF,
      },
      { supabaseUrl: "http://127.0.0.1.evil.test", stagingRef: undefined },
    ]) {
      expect(seedRefusal({ ...target, names: [] })).toMatch(/not a local/);
    }
  });

  it("reads the ref from the command line", () => {
    const ref = (...args: string[]) => stagingRefFrom(["node", "x", ...args]);
    expect(ref(`--staging=${STAGING_PROJECT_REF}`)).toBe(STAGING_PROJECT_REF);
    expect(ref("--staging")).toBe("");
    expect(ref()).toBeUndefined();
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
