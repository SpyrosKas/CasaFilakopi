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
  // Any answer will do: with no database, /en is an error page by design.
  await expect
    .poll(
      () =>
        fetch(`${BASE}/en`).then(
          () => true,
          () => false,
        ),
      { timeout: 150_000, intervals: [1000] },
    )
    .toBe(true);
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

// On a running site a failed read throws, so that Next keeps the last good page
// (proved in cms-static.spec.ts). This server has no earlier page to keep, which
// is the worst case: the error screen, inside the normal header and footer.
for (const path of ["/en", "/el", "/en/host", "/en/gallery", "/en/terms"]) {
  test(`${path} is never blank`, async ({ page }) => {
    test.setTimeout(120_000);
    await skipCookieBanner(page);
    await page.goto(`${BASE}${path}`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#main")).not.toBeEmpty();
    await expect(page.locator(".footer-section")).toContainText(
      "Casa Filakopi",
    );
    await expect(page.locator(".site-header")).toBeVisible();
  });
}

test("the error screen offers a way on, in the right language", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await skipCookieBanner(page);
  await page.goto(`${BASE}/en`);
  await expect(page.locator("h1")).toHaveText("Something went wrong");
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

test("a 404 needs no database", async ({ page }) => {
  test.setTimeout(120_000);
  await skipCookieBanner(page);
  const response = await page.goto(`${BASE}/en/no-such-page`);
  expect(response?.status()).toBe(404);
  await expect(page.locator("h1")).toHaveText("Page not found");
  await expect(page.locator(".site-hero img")).toHaveAttribute(
    "src",
    /error-hero/,
  );
});
