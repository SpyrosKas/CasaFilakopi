import { describe, expect, it } from "vitest";
import {
  CALLING_CODES,
  codeForStoredName,
  countryOptions,
  phoneForCountry,
  storedCountryName,
} from "@/lib/site-countries";

describe("country list", () => {
  it("knows the usual guests' codes", () => {
    expect(CALLING_CODES.GR).toBe("30");
    expect(CALLING_CODES.GB).toBe("44");
    expect(CALLING_CODES.US).toBe("1");
    expect(CALLING_CODES.DE).toBe("49");
    expect(CALLING_CODES.AC).toBeUndefined();
  });

  it("names countries in the guest's language, sorted", () => {
    const greek = countryOptions("el");
    expect(greek.find((c) => c.code === "GR")?.name).toBe("Ελλάδα");
    const english = countryOptions("en").map((c) => c.name);
    expect(english).toEqual(
      [...english].sort((a, b) => a.localeCompare(b, "en")),
    );
    expect(english.length).toBeGreaterThan(200);
  });

  it("keeps the English name, and finds the code again", () => {
    expect(storedCountryName("GR")).toBe("Greece");
    expect(codeForStoredName("Greece")).toBe("GR");
    expect(codeForStoredName("Atlantis")).toBe("");
    expect(codeForStoredName(undefined)).toBe("");
  });
});

describe("phone code on country change", () => {
  it("fills an empty number", () => {
    expect(phoneForCountry("", undefined, "30")).toBe("+30 ");
    expect(phoneForCountry("  ", "44", "30")).toBe("+30 ");
  });

  it("swaps the code it filled in before", () => {
    expect(phoneForCountry("+30 ", "30", "44")).toBe("+44 ");
    expect(phoneForCountry("+30 690 000 0000", "30", "44")).toBe(
      "+44 690 000 0000",
    );
  });

  it("leaves a number the guest wrote themselves", () => {
    expect(phoneForCountry("+357 99 123456", "30", "44")).toBe(
      "+357 99 123456",
    );
    expect(phoneForCountry("+301234", "30", "44")).toBe("+301234");
    expect(phoneForCountry("6900000000", undefined, "30")).toBe("6900000000");
  });
});
