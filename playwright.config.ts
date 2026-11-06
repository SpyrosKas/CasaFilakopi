import { defineConfig } from "@playwright/test";

const port = process.env.PORT ?? "3000";

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev",
    url: `http://localhost:${port}/en`,
    reuseExistingServer: !process.env.CI,
  },
});
