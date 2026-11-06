import { expect, test } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../../content/consent";
import { skipCookieBanner } from "./helpers";

test.describe("menu", () => {
  test("opens, traps content behind it, closes with Esc", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en/host");
    const toggle = page.getByRole("button", { name: "Open menu" });
    await toggle.click();

    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link", { name: "Home" })).toBeFocused();
    await expect(page.locator("#main")).toHaveAttribute("inert", "");

    await page.keyboard.press("Escape");
    await expect(page.locator("#main")).not.toHaveAttribute("inert", "");
    await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
    await expect(nav.getByRole("link", { name: "Home" })).toBeHidden();
  });

  test("links navigate and close the menu", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.getByRole("button", { name: "Open menu" }).click();
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: "Directions" })
      .click();
    await expect(page).toHaveURL(/\/en\/directions$/);
    await expect(page.locator("body")).not.toHaveClass(/menu-open/);
  });
});

test.describe("photo modal", () => {
  test("is keyboard usable and gives focus back", async ({ page }) => {
    await skipCookieBanner(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");

    const button = page.getByRole("button", { name: "View more" }).first();
    await button.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Master Bedroom" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Photo 1 of 6")).toBeAttached();

    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByText("Photo 2 of 6")).toBeAttached();
    await dialog.getByRole("button", { name: "Previous" }).click();
    await dialog.getByRole("button", { name: "Previous" }).click();
    await expect(dialog.getByText("Photo 6 of 6")).toBeAttached();
    await dialog.getByRole("button", { name: "Show photo 3" }).click();
    await expect(dialog.getByText("Photo 3 of 6")).toBeAttached();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(button).toBeFocused();
  });

  test("carousel does not auto-advance with reduced motion", async ({
    page,
  }) => {
    await skipCookieBanner(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.getByRole("button", { name: "View more" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Master Bedroom" });
    await expect(dialog.getByRole("button", { name: "Play" })).toBeVisible();
    await page.waitForTimeout(5500);
    await expect(dialog.getByText("Photo 1 of 6")).toBeAttached();
  });

  test("guest review opens in full", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.getByRole("button", { name: "Read more" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Review by Alex" });
    await expect(dialog).toContainText("the most wonderful memories");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toBeHidden();
  });
});

test("directions accordion shows one route at a time", async ({ page }) => {
  await skipCookieBanner(page);
  await page.goto("/en/directions");
  const adamas = page.getByRole("button", {
    name: "Starting from the center of Adamas",
  });
  const airport = page.getByRole("button", {
    name: "Starting from the Airport",
  });
  await expect(adamas).toHaveAttribute("aria-expanded", "true");

  await airport.click();
  await expect(airport).toHaveAttribute("aria-expanded", "true");
  await expect(adamas).toHaveAttribute("aria-expanded", "false");

  await page
    .getByRole("button", { name: "Coming from the center of Adamas." })
    .click();
  await expect(adamas).toHaveAttribute("aria-expanded", "true");
});

test("reservation buttons go to the booking page", async ({ page }) => {
  await skipCookieBanner(page);
  await page.goto("/el/host");
  await page.getByRole("link", { name: "Κράτηση τώρα" }).click();
  await expect(page).toHaveURL(/\/el\/book$/);
});

test("language switcher keeps the page", async ({ page }) => {
  await skipCookieBanner(page);
  await page.goto("/en/directions");
  await page
    .locator("#site-footer")
    .getByRole("link", { name: "Ελληνικά" })
    .click();
  await expect(page).toHaveURL(/\/el\/directions$/);
});

test.describe("legacy URLs", () => {
  for (const [from, to] of [
    ["/index.html", "/en"],
    ["/host.html", "/en/host"],
    ["/directions.html", "/en/directions"],
  ]) {
    test(`${from} is a 301`, async ({ request }) => {
      const response = await request.get(from, { maxRedirects: 0 });
      expect(response.status()).toBe(301);
      expect(response.headers().location).toBe(to);
    });
  }
});

test.describe("not found", () => {
  test("unknown page under a locale is translated", async ({ page }) => {
    await skipCookieBanner(page);
    const response = await page.goto("/el/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Η σελίδα δεν βρέθηκε" }),
    ).toBeVisible();
  });

  test("unknown URL outside the locales is styled", async ({ page }) => {
    const response = await page.goto("/no-such-file.html");
    expect(response?.status()).toBe(404);
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
  });
});

test.describe("cookie consent", () => {
  const google = /google\.|gstatic\.|fontawesome\.com/;

  test("nothing third party loads before consent", async ({ page }) => {
    const thirdParty: string[] = [];
    page.on("request", (request) => {
      if (google.test(new URL(request.url()).host)) {
        thirdParty.push(request.url());
      }
    });

    await page.goto("/en/contact");
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeVisible();
    await expect(page.locator("iframe")).toHaveCount(0);

    await page.getByRole("button", { name: "Open menu" }).click();
    await page.waitForTimeout(300);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Decline" }).click();

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("iframe")).toHaveCount(0);
    expect(thirdParty).toEqual([]);
  });

  test("declining is as easy as accepting", async ({ page }) => {
    await page.goto("/en");
    const decline = page.getByRole("button", { name: "Decline" });
    const accept = page.getByRole("button", { name: "Accept" });
    const [declineBox, acceptBox] = await Promise.all([
      decline.boundingBox(),
      accept.boundingBox(),
    ]);
    expect(declineBox?.height).toBe(acceptBox?.height);
    expect(await decline.getAttribute("class")).toBe(
      await accept.getAttribute("class"),
    );
  });

  test("decline hides the banner and is remembered", async ({ page }) => {
    await page.goto("/en");
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeHidden();
    await page.reload();
    await page.waitForLoadState("load");
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeHidden();
  });

  test("accept loads the map; settings can withdraw it", async ({ page }) => {
    await page.route(/google\.com/, (route) =>
      route.fulfill({ status: 200, body: "<html></html>" }),
    );
    await page.goto("/en/contact");

    const logged = page.waitForRequest("**/api/consent");
    await page
      .getByRole("region", { name: "Cookie choices" })
      .getByRole("button", { name: "Accept" })
      .click();
    const body = (await logged).postDataJSON();
    expect(body.granted).toBe(true);
    await expect(page.locator("#main iframe")).toHaveCount(1);

    await page.getByRole("button", { name: "Cookie settings" }).click();
    await page.getByRole("button", { name: "Decline" }).click();
    await expect(page.locator("#main iframe")).toHaveCount(0);

    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      CONSENT_STORAGE_KEY,
    );
    expect(stored).toContain("declined");
    expect(stored).toContain(body.subject);
  });

  test("consent API refuses other origins and bad input", async ({
    request,
    baseURL,
  }) => {
    const data = {
      granted: true,
      policyVersion: "test",
      subject: "00000000-0000-4000-8000-000000000000",
    };
    const crossSite = await request.post("/api/consent", {
      data,
      headers: { origin: "https://example.com" },
    });
    expect(crossSite.status()).toBe(403);

    const badBody = await request.post("/api/consent", {
      data: { granted: "yes" },
      headers: { origin: baseURL! },
    });
    expect(badBody.status()).toBe(400);
  });
});
