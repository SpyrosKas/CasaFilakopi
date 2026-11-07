import { defineConfig } from "@playwright/test";

// Serves the old site for comparison. The new site must already be running:
// set NEW_SITE_URL if it is not on port 3000. LEGACY_PORT moves the old site
// if 8123 is taken.
const legacyPort = process.env.LEGACY_PORT ?? "8123";

export default defineConfig({
  testDir: ".",
  testMatch: "compare.spec.ts",
  timeout: 120_000,
  outputDir: "output/test-results",
  use: { baseURL: `http://localhost:${legacyPort}` },
  webServer: {
    command: `python3 -m http.server ${legacyPort} --directory legacy`,
    cwd: "../..",
    url: `http://localhost:${legacyPort}/index.html`,
    reuseExistingServer: true,
  },
});
