import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { isIndexable, publicSecurityHeaders } from "./lib/security-headers";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** Photos come from the public media bucket, and from nowhere else (T4.20). */
function mediaImagePattern() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return [];
  const { protocol, hostname, port } = new URL(value);
  return [
    {
      protocol: protocol.replace(":", "") as "http" | "https",
      hostname,
      port,
      pathname: "/storage/v1/object/public/media/**",
    },
  ];
}

const usesLocalSupabase = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
);

const nextConfig: NextConfig = {
  // Keeps the app portable to any Docker host (T1.12).
  output: "standalone",
  // A second dev server for the database-failure test needs its own folder.
  ...(process.env.CMS_OFFLINE_DIST
    ? {
        distDir: process.env.CMS_OFFLINE_DIST,
        typescript: { tsconfigPath: "tsconfig.offline.json" },
      }
    : {}),
  // Supabase image transforms need a paid plan, so the Next image optimiser
  // does the resizing. One format and quality keeps the transformations count
  // low, and an uploaded file never changes under its name, so a long cache
  // is safe: a replaced photo gets a new path.
  images: {
    remotePatterns: mediaImagePattern(),
    formats: ["image/webp"],
    qualities: [75],
    minimumCacheTTL: 2678400,
    // The optimiser refuses local addresses, which is where Supabase runs in
    // development. Hosted projects never set this.
    dangerouslyAllowLocalIP: usesLocalSupabase,
  },
  // proxy.ts skips dotted URLs and anything that merely starts with api, admin
  // or _next, so /old.html or /apiary reach [locale] with a bogus locale, whose
  // 404 has no layout and renders blank. This sends them to the styled 404.
  // afterFiles runs after real files and static routes, before dynamic routes;
  // api, admin and _next are excluded so their dynamic routes keep working.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source:
            "/:first((?!(?:en|el|api|admin|_next|_vercel)(?:/|$))[^/]+)/:rest*",
          destination: "/en/:first/:rest*",
        },
      ],
      fallback: [],
    };
  },
  // Admin responses get their own, stricter set in lib/admin/proxy.ts. The
  // private rules come last so they win where both set the same header.
  async headers() {
    const privatePage = [
      { key: "Cache-Control", value: "private, no-store" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ];
    return [
      {
        source: "/((?!admin(?:/|$)).*)",
        headers: publicSecurityHeaders(
          process.env.NODE_ENV === "development",
          isIndexable(
            process.env.NEXT_PUBLIC_SITE_URL,
            process.env.NEXT_PUBLIC_INDEXABLE,
          ),
        ),
      },
      // A guest's private link, and the pages around a payment (SUP-15).
      { source: "/:locale(en|el)/booking/:token*", headers: privatePage },
      { source: "/:locale(en|el)/book/return", headers: privatePage },
      { source: "/:locale(en|el)/book/cancelled", headers: privatePage },
    ];
  },
  // Old static URLs (MIG-06). statusCode, because `permanent` would send 308.
  async redirects() {
    return [
      { source: "/index.html", destination: "/en", statusCode: 301 },
      { source: "/host.html", destination: "/en/host", statusCode: 301 },
      {
        source: "/directions.html",
        destination: "/en/directions",
        statusCode: 301,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
