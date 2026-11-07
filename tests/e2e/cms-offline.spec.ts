import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { skipCookieBanner } from "./helpers";

// A real database failure: a second server whose Supabase address has nothing
// listening on it. Every read fails at the network, as in an outage.

const PORT = 3096;
const BASE = `http://localhost:${PORT}`;
const OFFLINE_DIST = ".next-offline";
const SHARED_ENV_FILE = "next-env.d.ts";

let server: ChildProcess;
let envFile: string | null = null;

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  try {
    envFile = readFileSync(SHARED_ENV_FILE, "utf8");
  } catch {
    envFile = null;
  }
  server = spawn("pnpm", ["exec", "next", "dev", "-p", String(PORT)], {
    env: {
      ...process.env,
      CMS_OFFLINE_DIST: OFFLINE_DIST,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9",
    },
    stdio: "ignore",
    detached: true,
  });
  await expect
    .poll(
      () =>
        fetch(`${BASE}/en`).then(
          (response) => response.status,
          () => 0,
        ),
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(200);
});

test.afterAll(async () => {
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  if (server.pid) process.kill(-server.pid);
  await stopped;
  // The server's children finish their last writes after it exits.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  rmSync(OFFLINE_DIST, { recursive: true, force: true, maxRetries: 5 });
  if (envFile !== null) writeFileSync(SHARED_ENV_FILE, envFile);
});

for (const [path, text] of [
  ["/en", "Master Bedroom"],
  ["/el", "Κύρια κρεβατοκάμαρα"],
  ["/en/host", "Dear friend"],
  ["/en/directions", "Grigoris Cafe"],
  ["/en/gallery", "Kitchen"],
  ["/en/contact", "gkavourakis@yahoo.com"],
  ["/en/terms", "must be provided"],
  ["/en/faq", "must be provided"],
] as const) {
  test(`${path} still shows its text`, async ({ page }) => {
    test.setTimeout(120_000);
    await skipCookieBanner(page);
    const response = await page.goto(`${BASE}${path}`);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("body")).toContainText(text);
    await expect(page.locator(".footer-section")).toBeVisible();
  });
}
