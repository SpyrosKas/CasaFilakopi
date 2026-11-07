import { routing } from "@/i18n/routing";
import { isIndexable } from "@/lib/security-headers";

// Addresses for search engines (WEB-09). Pure: the content comes from the CMS.

/** Every public page, as its path after the language. Home is empty. */
export const PUBLIC_PATHS = [
  "",
  "/host",
  "/directions",
  "/gallery",
  "/contact",
  "/book",
  "/faq",
  "/house-rules",
  "/privacy",
  "/terms",
  "/cancellation",
  "/cookies",
] as const;

export const siteOrigin = (): string =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

export const indexable = (): boolean =>
  isIndexable(
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.NEXT_PUBLIC_INDEXABLE,
    process.env.VERCEL_ENV,
  );

export const pathOfSlug = (slug: string): string =>
  slug === "home" ? "" : `/${slug}`;

/** Canonical and hreflang. Absolute, because search engines need them to be. */
export function alternatesFor(
  path: string,
  locale: string,
): { canonical: string; languages: Record<string, string> } {
  const origin = siteOrigin();
  const url = (lang: string) => `${origin}/${lang}${path}`;
  return {
    canonical: url(locale),
    languages: {
      ...Object.fromEntries(routing.locales.map((lang) => [lang, url(lang)])),
      "x-default": url(routing.defaultLocale),
    },
  };
}

/**
 * Text for inside a <script> tag. Only the characters that can end the tag or
 * the script are escaped, so the result is still exact JSON: "</script>" in a
 * CMS field cannot break out.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replaceAll(String.fromCharCode(0x2028), "\\u2028")
    .replaceAll(String.fromCharCode(0x2029), "\\u2029");
}

export interface LodgingData {
  name: string;
  url: string;
  description?: string;
  image?: string;
  telephone?: string;
  email?: string;
  addressLines: string[];
  checkInTime?: string;
  checkOutTime?: string;
  maxOccupancy?: number;
  registrationNumber?: string;
}

const hhmm = (time: string | undefined) => time?.slice(0, 5);

export function lodgingBusiness(data: LodgingData): Record<string, unknown> {
  const address = data.addressLines.filter(Boolean).join(", ");
  const entry: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    name: data.name,
    url: data.url,
    description: data.description,
    image: data.image,
    telephone: data.telephone,
    email: data.email,
    address: address
      ? {
          "@type": "PostalAddress",
          streetAddress: address,
          addressRegion: "Milos",
          addressCountry: "GR",
        }
      : undefined,
    checkinTime: hhmm(data.checkInTime),
    checkoutTime: hhmm(data.checkOutTime),
    occupancy: data.maxOccupancy
      ? { "@type": "QuantitativeValue", maxValue: data.maxOccupancy }
      : undefined,
    identifier: data.registrationNumber,
  };
  return Object.fromEntries(
    Object.entries(entry).filter(
      ([, value]) => value !== undefined && value !== "",
    ),
  );
}
