import { expect, test } from "@playwright/test";
import { skipCookieBanner } from "./helpers";

test("root redirects to a locale", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(en|el)$/);
});

test("Greek home page renders in Greek", async ({ page }) => {
  await skipCookieBanner(page);
  await page.goto("/el");
  await expect(page.locator("html")).toHaveAttribute("lang", "el");
  await expect(
    page.getByRole("heading", { name: "Καλώς ήρθατε!" }),
  ).toBeVisible();
});

test("admin is outside locale routing", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin$/);
});

test("health endpoint responds", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
});
