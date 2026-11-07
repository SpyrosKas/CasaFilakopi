import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { alternatesFor, indexable, PUBLIC_PATHS, siteOrigin } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!indexable()) return [];
  return routing.locales.flatMap((locale) =>
    PUBLIC_PATHS.map((path) => ({
      url: `${siteOrigin()}/${locale}${path}`,
      alternates: { languages: alternatesFor(path, locale).languages },
    })),
  );
}
