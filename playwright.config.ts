import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}/en`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
