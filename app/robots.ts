import type { MetadataRoute } from "next";
import { indexable, siteOrigin } from "@/lib/seo";

// Staging keeps the same rules, not "disallow everything": a crawler has to be
// allowed to fetch a page to read its noindex. It just gets no sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/admin", "/api", "/booking/", "/en/booking/", "/el/booking/"],
    },
    sitemap: indexable() ? `${siteOrigin()}/sitemap.xml` : undefined,
  };
}
