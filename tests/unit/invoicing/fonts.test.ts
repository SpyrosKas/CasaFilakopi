import fontkit from "@pdf-lib/fontkit";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  cannotPrint,
  fontFile,
  FONT_REGULAR,
  plainOnly,
  printable,
  REPLACEMENT,
} from "@/lib/invoicing/fonts";
import {
  PROVISIONAL_EL,
  PROVISIONAL_EN,
  renderInvoicePdf,
} from "@/lib/invoicing/pdf";
import { parseCustomer, parseIssuer } from "@/lib/invoicing/types";
import { pdfText } from "../../pdf-text";

// Names as a guest would really type them, one per script. "prints" says
// whether the font holds that script, so its letters must survive.
const SCRIPTS: { script: string; name: string; prints: boolean }[] = [
  { script: "Latin", name: "François Müller", prints: true },
  { script: "Greek", name: "Γιώργος Καβουράκης", prints: true },
  { script: "Cyrillic", name: "Анна Петрова", prints: true },
  { script: "Armenian", name: "Արամ Խաչատրյան", prints: false },
  { script: "Hebrew", name: "דוד כהן", prints: false },
  { script: "Arabic", name: "محمد علي", prints: false },
  { script: "Syriac", name: "ܐܦܪܝܡ", prints: false },
  { script: "Devanagari", name: "अनिता शर्मा", prints: false },
  { script: "Bengali", name: "রবীন্দ্রনাথ ঠাকুর", prints: false },
  { script: "Gurmukhi", name: "ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ", prints: false },
  { script: "Gujarati", name: "મહાત્મા ગાંધી", prints: false },
  { script: "Oriya", name: "ସୁଭାଷ ଚନ୍ଦ୍ର", prints: false },
  { script: "Tamil", name: "சுப்பிரமணிய பாரதி", prints: false },
  { script: "Telugu", name: "శ్రీనివాస రావు", prints: false },
  { script: "Kannada", name: "ಕುವೆಂಪು", prints: false },
  { script: "Malayalam", name: "മോഹൻലാൽ", prints: false },
  { script: "Sinhala", name: "කුමාර සංගක්කාර", prints: false },
  { script: "Thai", name: "สมชาย ใจดี", prints: false },
  { script: "Lao", name: "ສົມພອນ", prints: false },
  { script: "Tibetan", name: "བསྟན་འཛིན", prints: false },
  { script: "Myanmar", name: "အောင်ဆန်း", prints: false },
  { script: "Georgian", name: "გიორგი", prints: false },
  { script: "Hangul", name: "김민수", prints: false },
  { script: "Ethiopic", name: "አበበ በቀለ", prints: false },
  { script: "Khmer", name: "សុខ សាន", prints: false },
  { script: "Mongolian", name: "ᠮᠣᠩᠭᠣᠯ", prints: false },
  { script: "Hiragana and Han", name: "山田 はなこ", prints: false },
];

const squeezed = (text: string) => text.replace(/\s+/g, "");

const render = (name: string) =>
  renderInvoicePdf({
    documentNumber: "TEST-R-000001",
    docType: "receipt",
    issuedAt: "2026-11-07T10:00:00Z",
    isProvisional: true,
    issuer: parseIssuer({ legalName: "DUMMY Business Name" }),
    customer: parseCustomer({ name, email: "guest@example.test" }),
    lines: [
      {
        description: `Διαμονή ${name}`,
        quantity: 1,
        unitCents: 1000,
        totalCents: 1000,
        vatCents: 0,
        vatBasisPoints: 0,
        kind: "accommodation",
      },
    ],
    netCents: 1000,
    vatCents: 0,
    feeCents: 0,
    totalCents: 1000,
    paymentMethod: "card",
    bookingReference: name,
    creditsDocumentNumber: null,
    reason: name,
  });

describe("the bug this guards against", () => {
  it("Devanagari really does crash the font library when sent raw", async () => {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontFile(FONT_REGULAR), { subset: false });
    expect(() => font.widthOfTextAtSize("अनिता", 10)).toThrow();
  });
});

describe("names in every script", () => {
  it("covers at least 25 scripts", () => {
    expect(SCRIPTS.length).toBeGreaterThanOrEqual(25);
  });

  for (const { script, name, prints } of SCRIPTS) {
    it(`${script}: makes a readable PDF, and reports what it cannot show`, async () => {
      const text = await pdfText(await render(name));
      const flat = squeezed(text);

      // The document around the name is intact.
      expect(flat).toContain(squeezed(PROVISIONAL_EN));
      expect(flat).toContain(squeezed(PROVISIONAL_EL));
      expect(flat).toContain("TEST-R-000001");
      expect(flat).toContain("guest@example.test");
      expect(flat).toContain("10,00€");

      if (prints) {
        expect(cannotPrint(name)).toEqual([]);
        expect(flat).toContain(squeezed(name));
      } else {
        expect(cannotPrint(name).length).toBeGreaterThan(0);
        expect(flat).toContain(REPLACEMENT);
      }
    });
  }
});

describe("making text safe", () => {
  it("leaves what the font has alone", () => {
    expect(printable("Μαρία Müller Анна €5")).toBe("Μαρία Müller Анна €5");
  });

  it("replaces what it lacks, one for one", () => {
    expect(printable("Anita अ")).toBe(`Anita ${REPLACEMENT}`);
  });

  it("joins decomposed accents, so Greek typed that way still prints", () => {
    const decomposed = "Μαρία".normalize("NFD");
    expect(cannotPrint(decomposed)).toEqual([]);
    expect(printable(decomposed)).toBe("Μαρία");
  });

  it("drops invisible joiners and turns control characters into spaces", () => {
    const joiner = String.fromCodePoint(0x200d);
    expect(printable(`a${joiner}b`)).toBe("ab");
    expect(printable("a\r\nb\tc")).toBe("a  b c");
  });

  it("lists each missing character once", () => {
    expect(cannotPrint("अअअ")).toEqual(["अ"]);
    expect(cannotPrint("")).toEqual([]);
  });

  it("does not split an emoji into two question marks", () => {
    expect(printable("😀")).toBe(REPLACEMENT);
  });

  it("cuts absurdly long text instead of filling pages", () => {
    expect(printable("x".repeat(100_000)).length).toBeLessThanOrEqual(2000);
  });

  it("has a last resort that keeps only plain scripts", () => {
    expect(plainOnly("Ab Γδ Жз €1 अ")).toBe(`Ab Γδ Жз €1 ${REPLACEMENT}`);
  });
});
