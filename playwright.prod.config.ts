import { defineConfig } from "@playwright/test";

// Checks that mean nothing on `next dev`: the real Content-Security-Policy, the
// real indexing rules, and accessibility of the production pages.
//   pnpm test:prod                         a staging-style build, noindex
//   PROD_INDEXABLE=true pnpm test:prod     a production-style build
// Needs local Supabase. Turnstile runs on Cloudflare's published test keys.

const port = process.env.PROD_PORT ?? "3011";
const indexable = process.env.PROD_INDEXABLE === "true";

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "public-quality.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 90_000,
  workers: 2,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm build && pnpm exec next start -p ${port}`,
    url: `http://localhost:${port}/en`,
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      PORT: port,
      NEXT_PUBLIC_SITE_URL: `http://localhost:${port}`,
      NEXT_PUBLIC_INDEXABLE: indexable ? "true" : "",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    },
  },
});
