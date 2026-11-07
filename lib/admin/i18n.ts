import { formatters, type Formatters } from "@/lib/admin/format";
import { resolveMarker, type Catalogs } from "@/lib/admin/later";
import { adminEn, type AdminStrings } from "@/lib/admin/strings";
import { adminEl } from "@/lib/admin/strings.el";
import { channelsEn, type ChannelStrings } from "@/lib/channels/strings";
import { channelsEl } from "@/lib/channels/strings.el";
import { cmsEn, type CmsStrings } from "@/lib/cms/strings";
import { cmsEl } from "@/lib/cms/strings.el";

// The one way to reach the admin's words. Each request has a language, and
// each piece of code asks for its words while it runs, never at module scope,
// because a module runs once for every visitor:
//
//   server components, actions, routes: await adminI18n() (i18n-server.ts)
//   client components:                  useAdminI18n() (language-provider.tsx)
//   anything else:                      takes them as an argument
//
// Code that must exist at module scope, such as a schema, uses `later`.

export const ADMIN_LANGUAGES = ["el", "en"] as const;

export type AdminLanguage = (typeof ADMIN_LANGUAGES)[number];

/** Yorgos reads Greek first (D25). */
export const DEFAULT_ADMIN_LANGUAGE: AdminLanguage = "el";

export const ADMIN_LANGUAGE_COOKIE = "admin_lang";

export const parseAdminLanguage = (value: unknown): AdminLanguage =>
  ADMIN_LANGUAGES.find((language) => language === value) ??
  DEFAULT_ADMIN_LANGUAGE;

export interface AdminI18n extends Formatters {
  lang: AdminLanguage;
  t: AdminStrings;
  cms: CmsStrings;
  channels: ChannelStrings;
  nightsWord: (nights: number) => string;
  formatStay: (checkIn: string, checkOut: string) => string;
  /** The words for a marker from `later`. Plain text comes back unchanged. */
  say: (text: string) => string;
  /** The same for every string inside a value, such as a registry entry. */
  sayAll: <T>(value: T) => T;
}

function build(lang: AdminLanguage, catalogs: Catalogs): AdminI18n {
  const format = formatters(lang);
  const t = catalogs.admin;
  const say = (text: string) => resolveMarker(catalogs, text);
  const sayAll = <T>(value: T): T => {
    if (typeof value === "string") return say(value) as T;
    if (Array.isArray(value)) return value.map(sayAll) as T;
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key, sayAll(inner)]),
    ) as T;
  };
  return {
    ...format,
    lang,
    t,
    cms: catalogs.cms,
    channels: catalogs.channels,
    nightsWord: t.common.nights,
    formatStay: (checkIn, checkOut) =>
      t.common.dateRange(
        format.formatShortDate(checkIn),
        format.formatYearDate(checkOut),
      ),
    say,
    sayAll,
  };
}

const BUNDLES: Record<AdminLanguage, AdminI18n> = {
  en: build("en", { admin: adminEn, cms: cmsEn, channels: channelsEn }),
  el: build("el", { admin: adminEl, cms: cmsEl, channels: channelsEl }),
};

export const i18nFor = (language: AdminLanguage): AdminI18n =>
  BUNDLES[language];

/** A key that may not be in the map, such as a code from the database. */
export const lookup = (
  map: Readonly<Record<string, string>>,
  key: string,
): string | undefined => map[key];
