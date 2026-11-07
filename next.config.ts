import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Keeps the app portable to any Docker host (T1.12).
  output: "standalone",
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
