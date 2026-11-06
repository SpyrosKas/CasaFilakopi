import { expect, test } from "@playwright/test";

test("root redirects to a locale", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/(en|el)$/);
});

test("Greek home page renders in Greek", async ({ page }) => {
  await page.goto("/el");
  await expect(page.locator("html")).toHaveAttribute("lang", "el");
  await expect(page.getByText("Η νέα ιστοσελίδα ετοιμάζεται")).toBeVisible();
});

test("admin is outside locale routing", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("health endpoint responds", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
});
