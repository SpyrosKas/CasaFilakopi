import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "tests/e2e",
  // Needs a production build: `pnpm test:prod`.
  testIgnore: ["**/public-quality.spec.ts"],
  globalSetup: "./tests/e2e/global-setup.ts",
  timeout: 60_000,
  // CI compiles each page on first use, which can outlast the default 5 s.
  expect: { timeout: process.env.CI ? 20_000 : 5_000 },
  // CI compiles pages on first use. A real failure still fails twice, and a
  // retried test is reported as flaky rather than hidden.
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: `http://localhost:${port}`,
    // Admin is Greek by default (D25). Specs match the English text, so they
    // ask for English. tests/e2e/admin-greek.spec.ts clears this.
    storageState: {
      cookies: [
        {
          name: "admin_lang",
          value: "en",
          domain: "localhost",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax",
        },
      ],
      origins: [],
    },
  },
  webServer: {
    command: "pnpm dev",
    env: { CMS_TEST_PAGE: "1", CRON_SECRET: "cms-e2e-cron" },
    url: `http://localhost:${port}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
