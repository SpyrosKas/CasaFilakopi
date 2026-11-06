import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/baseline",
  use: { baseURL: "http://localhost:8123" },
  webServer: {
    command: "python3 -m http.server 8123 --directory legacy",
    url: "http://localhost:8123/index.html",
    reuseExistingServer: true,
  },
});
