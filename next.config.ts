import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Keeps the app portable to any Docker host (T1.12).
  output: "standalone",
  // proxy.ts skips URLs with a dot, so /old-page.html reaches [locale] with a
  // bogus locale and a blank 404. Real files win before this; the rest get the
  // styled 404 through the catch-all route.
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        {
          source: "/:first([^/]*\\.[^/]*)/:rest*",
          destination: "/en/:first/:rest*",
        },
      ],
      fallback: [],
    };
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
