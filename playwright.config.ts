import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  // CI compiles each page on first use, which can outlast the default 5 s.
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    env: { CMS_TEST_PAGE: "1", CRON_SECRET: "cms-e2e-cron" },
    url: `http://localhost:${port}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
