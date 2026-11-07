import { defineConfig } from "@playwright/test";

// The checks that need a production build: static pages, revalidation and a
// real outage. `next dev` caches nothing, so it cannot prove any of them.
// Run with `pnpm test:static`, on a machine with local Supabase running.

const port = process.env.STATIC_PORT ?? "3007";

process.env.CMS_STATIC_CHECK = "1";
process.env.PORT = port;

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: "cms-static.spec.ts",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: `http://localhost:${port}` },
  webServer: [
    {
      command: "node tests/e2e/supabase-proxy.mjs",
      port: 54399,
      reuseExistingServer: false,
    },
    {
      command: `pnpm build && pnpm exec next start -p ${port}`,
      url: `http://localhost:${port}/en`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        CMS_TEST_PAGE: "1",
        CRON_SECRET: "cms-e2e-cron",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54399",
      },
    },
  ],
});
