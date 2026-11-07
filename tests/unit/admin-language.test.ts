import { describe, expect, it } from "vitest";
import { emailEn } from "@/lib/admin/email-strings";
import { formatters, parseEuros } from "@/lib/admin/format";
import { fromZodError } from "@/lib/admin/form-state";
import {
  ADMIN_LANGUAGES,
  DEFAULT_ADMIN_LANGUAGE,
  i18nFor,
  parseAdminLanguage,
} from "@/lib/admin/i18n";
import { invoiceEn } from "@/lib/admin/invoice-strings";
import { later } from "@/lib/admin/later";
import { messageTemplates } from "@/lib/admin/message-templates";
import { describeRules, rulesSchema } from "@/lib/admin/rules";
import { loginSchema } from "@/lib/admin/schemas";
import { adminEn } from "@/lib/admin/strings";
import { adminEl } from "@/lib/admin/strings.el";
import { channelsEn } from "@/lib/channels/strings";
import { channelsEl } from "@/lib/channels/strings.el";
import { allPages, collectionName, findPage } from "@/lib/cms/registry";
import { cmsEn } from "@/lib/cms/strings";
import { cmsEl } from "@/lib/cms/strings.el";
import { emailEl } from "@/lib/admin/email-strings.el";
import { invoiceEl } from "@/lib/admin/invoice-strings.el";

const CATALOGS: [string, unknown, unknown][] = [
  ["admin", adminEn, adminEl],
  ["email", emailEn, emailEl],
  ["invoices", invoiceEn, invoiceEl],
  ["channels", channelsEn, channelsEl],
  ["cms", cmsEn, cmsEl],
];

/** Every leaf, by path, with what kind of thing sits there. */
function shape(value: unknown, path = ""): Record<string, string> {
  if (typeof value === "function") {
    return { [path]: `function/${value.length}` };
  }
  if (Array.isArray(value)) return { [path]: `list/${value.length}` };
  if (value === null || typeof value !== "object") {
    return { [path]: typeof value };
  }
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, inner]) =>
      shape(inner, path ? `${path}.${key}` : key),
    ),
  );
}

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    // The words of a function, whether it takes numbers or names.
    const sample = (first: unknown, rest: unknown) =>
      Array.from({ length: value.length }, (_, i) => (i ? rest : first));
    try {
      return [String(value(...sample(2, 3)))];
    } catch {
      return [String(value(...sample("Όνομα", "Όνομα")))];
    }
  }
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value === null || typeof value !== "object") return [];
  return Object.values(value).flatMap(strings);
}

describe("the Greek catalogs", () => {
  it.each(CATALOGS)("%s has exactly the keys of the English", (_, en, el) => {
    expect(shape(el)).toEqual(shape(en));
  });

  it.each(CATALOGS)("%s has no empty text", (_, __, el) => {
    expect(strings(el).filter((text) => !text.trim() && text !== "")).toEqual(
      [],
    );
  });

  it("is written in Greek, apart from names that stay as they are", () => {
    // Words that are the same on the Greek screen.
    const KEEP =
      /^(casa filakopi|email|whatsapp|airbnb|booking\.com|b\.com|myDATA|wi-fi|pos|\d: \d|\d\d:\d\d|[\d, /€%.]*)$/i;
    const left = strings(adminEl)
      .concat(strings(cmsEl), strings(channelsEl))
      .filter((text) => text && !/[α-ωΑ-Ω]/.test(text) && !KEEP.test(text));
    expect(left).toEqual([]);
  });
});

describe("choosing a language", () => {
  it("is Greek unless the cookie says otherwise", () => {
    expect(DEFAULT_ADMIN_LANGUAGE).toBe("el");
    expect(parseAdminLanguage(undefined)).toBe("el");
    expect(parseAdminLanguage("fr")).toBe("el");
    expect(parseAdminLanguage("")).toBe("el");
    expect(parseAdminLanguage("en")).toBe("en");
    expect(parseAdminLanguage("el")).toBe("el");
  });

  it("gives each language its own words, and never mixes them", () => {
    const seen = ADMIN_LANGUAGES.map((lang) => i18nFor(lang).t.nav.bookings);
    expect(seen).toEqual(["Κρατήσεις", "Bookings"]);
    // The first call must not freeze the second.
    expect(i18nFor("el").t.nav.home).toBe("Αρχική");
    expect(i18nFor("en").t.nav.home).toBe("Home");
    expect(i18nFor("el").t.nav.home).toBe("Αρχική");
  });
});

describe("messages built before the language is known", () => {
  it("puts a schema message into the language of the request", () => {
    const parsed = loginSchema.safeParse({ email: "nope", password: "" });
    expect(parsed.success).toBe(false);
    const { error } = parsed;
    const greek = fromZodError(error!, i18nFor("el").say);
    const english = fromZodError(error!, i18nFor("en").say);
    expect(greek.fieldErrors).toEqual({
      email: adminEl.validation.email,
      password: adminEl.validation.required,
    });
    expect(greek.message).toBe(adminEl.common.fixErrors);
    expect(english.fieldErrors?.email).toBe(adminEn.validation.email);
  });

  it("keeps arguments, and puts nested markers into words too", () => {
    const marker = later.cms.common.tooLong(later.cms.labels.title);
    expect(i18nFor("el").say(marker)).toBe("τίτλος: είναι πολύ μεγάλο.");
    expect(i18nFor("en").say(marker)).toBe("title is too long.");
    expect(i18nFor("el").say(later.admin.validation.holdMinutes(31))).toContain(
      "31",
    );
  });

  it("leaves ordinary text alone, even with symbols in it", () => {
    expect(i18nFor("el").say("Plain (text)")).toBe("Plain (text)");
  });

  it("uses a general message where a schema has none, not Zod's English", () => {
    const { error } = rulesSchema.safeParse(null);
    const state = fromZodError(error!, i18nFor("el").say);
    expect(JSON.stringify(state)).toMatch(/[α-ω]/);
    expect(JSON.stringify(state)).not.toMatch(/@@|Invalid/);
  });

  it("has words for every page, section and field of the registry", () => {
    const { sayAll } = i18nFor("el");
    const text = JSON.stringify(sayAll(allPages()));
    expect(text).not.toContain("@@");
    expect(sayAll(findPage("home"))?.label).toBe("Αρχική σελίδα");
    expect(i18nFor("en").say(findPage("home")!.label)).toBe("Home page");
    expect(i18nFor("el").say(collectionName("section.kitchen"))).toMatch(
      /[Α-ω]/,
    );
  });
});

describe("Greek formats", () => {
  const el = i18nFor("el");
  const en = i18nFor("en");

  it("writes money the Greek way", () => {
    expect(el.formatEuro(123456)).toBe("1.234,56 €");
    expect(el.formatEuro(-5)).toBe("-0,05 €");
    expect(el.formatEuro(100_000_000)).toBe("1.000.000,00 €");
    expect(el.formatRoundEuro(100_000)).toBe("1.000 €");
    expect(el.formatRoundEuro(33_330)).toBe("333,30 €");
    expect(en.formatEuro(123456)).toBe("€1,234.56");
    expect(en.formatRoundEuro(100_000)).toBe("€1,000");
  });

  it("gives an edit box that reads back to the same amount", () => {
    expect(el.centsToBox(1205)).toBe("12,05");
    expect(el.centsToBox(null)).toBe("");
    expect(parseEuros(el.centsToBox(1205))).toBe(1205);
    expect(parseEuros(en.centsToBox(1205))).toBe(1205);
  });

  it("writes dates in Greek, with the stored date unchanged", () => {
    expect(el.formatDate("2026-11-07")).toBe("Σάβ 7 Νοε 2026");
    expect(el.formatDate("2027-05-01")).toBe("Σάβ 1 Μαΐ 2027");
    expect(el.formatShortDate("2027-08-15")).toBe("15 Αυγ");
    expect(el.formatYearDate("2027-01-31")).toBe("31 Ιαν 2027");
    expect(el.formatMonth("2027-06")).toBe("Ιούνιος 2027");
    expect(el.formatStay("2027-06-29", "2027-07-02")).toBe(
      "29 Ιουν έως 2 Ιουλ 2027",
    );
    expect(en.formatDate("2026-11-07")).toBe("Sat 7 Nov 2026");
  });

  it("shows an instant by the clock on Milos", () => {
    // 22:30 UTC in summer is already the next day in Greece.
    expect(el.formatStamp("2027-07-14T22:30:00Z")).toBe("15 Ιουλ 2027, 01:30");
    expect(el.formatStamp("2027-01-14T22:30:00Z")).toBe("15 Ιαν 2027, 00:30");
  });

  it("uses a decimal comma for tenths and percents", () => {
    expect(el.formatTenths(666)).toBe("66,6");
    expect(en.formatTenths(666)).toBe("66.6");
    expect(el.formatPercent(1250)).toBe("12,5%");
    expect(el.formatPercent(2400)).toBe("24%");
    expect(en.formatPercent(1250)).toBe("12.5%");
  });

  it("has seven weekdays and twelve months, starting on Monday", () => {
    expect(adminEl.calendar.weekdays).toHaveLength(7);
    expect(adminEl.calendar.weekdays[0]).toBe("Δε");
    expect(adminEl.rates.weekdayNames[0]).toBe("Κυρ");
    expect(adminEl.reports.months).toHaveLength(12);
  });

  it("agrees on one and many", () => {
    expect(el.nightsWord(1)).toBe("1 νύχτα");
    expect(el.nightsWord(3)).toBe("3 νύχτες");
    expect(adminEl.detail.guestsCount(1, 0)).toBe("1 ενήλικας");
    expect(adminEl.detail.guestsCount(2, 1)).toBe("2 ενήλικες, 1 παιδί");
  });
});

describe("the guest rules preview in Greek", () => {
  const payment = {
    mode: "deposit" as const,
    deposit: { kind: "percent" as const, percent: 30 },
    balanceDaysBefore: 14,
  };
  const cancellation = {
    isNonRefundable: false,
    tiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  };

  it("reads as Greek sentences with Greek money", () => {
    const preview = describeRules(payment, cancellation, i18nFor("el"));
    expect(preview.payment[0]).toBe(
      "Πληρώνετε το 30% της τιμής όταν κάνετε την κράτηση.",
    );
    expect(preview.cancellation).toEqual([
      "Αν ακυρώσετε 30 ημέρες ή περισσότερο πριν φτάσετε, σας επιστρέφουμε όλη την τιμή της κράτησης.",
      "Αν ακυρώσετε 7 έως 29 ημέρες πριν φτάσετε, σας επιστρέφουμε το 50% της τιμής της κράτησης.",
      "Αν ακυρώσετε λιγότερο από 7 ημέρες πριν φτάσετε, δεν επιστρέφουμε χρήματα.",
    ]);
    expect(preview.example.heading).toBe("Παράδειγμα: κράτηση 1.000 €");
    expect(preview.example.paidInFull.lines[0]).toBe(
      "30 ημέρες ή περισσότερο πριν φτάσετε: σας επιστρέφουμε 1.000 €.",
    );
    expect(JSON.stringify(preview)).not.toMatch(/\bthe\b|before you/);
  });
});

describe("Write to guest", () => {
  const facts = {
    name: "Νίκος Παππάς",
    reference: "CF-2027-00001",
    checkIn: "2027-06-20",
    checkOut: "2027-06-22",
  };

  it("uses the booking's language, not the admin's", () => {
    const greek = messageTemplates({ ...facts, locale: "el" }, i18nFor("en"));
    expect(greek.map((row) => row.body).join()).toMatch(/Γεια σας Νίκο,/);
    expect(greek.map((row) => row.body).join()).not.toMatch(/Hello|Yorgos/);
    // The list he picks from stays in his language.
    expect(greek[0].label).toBe("Before arrival");

    const english = messageTemplates({ ...facts, locale: "en" }, i18nFor("el"));
    expect(english[0].body).toContain("Hello Νίκος,");
    expect(english[0].body).toContain("Sun 20 Jun 2027");
    expect(english[0].label).toBe("Πριν την άφιξη");
  });

  it("falls back to English for a language it does not have", () => {
    const [row] = messageTemplates({ ...facts, locale: "de" }, i18nFor("el"));
    expect(row.body).toContain("Hello");
  });
});

describe("nothing freezes a language at import", () => {
  it("has no module-level words in the formatter", () => {
    expect(formatters("el").formatEuro(100)).toBe("1,00 €");
    expect(formatters("en").formatEuro(100)).toBe("€1.00");
    expect(formatters("el").formatEuro(100)).toBe("1,00 €");
  });
});
