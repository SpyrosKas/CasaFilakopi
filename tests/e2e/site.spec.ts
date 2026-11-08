import { expect, test } from "@playwright/test";
import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
} from "../../content/consent";
import { skipCookieBanner } from "./helpers";

test.describe("menu", () => {
  // From 1024 px the menu is in the header bar, with nothing to open.
  test.use({ viewport: { width: 375, height: 800 } });

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

  test("Tab stays inside the open menu, both ways", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en/host");
    await page.getByRole("button", { name: "Open menu" }).click();
    const inMenu = () =>
      page.evaluate(() => {
        // The header stays usable above the menu: language and close.
        return document.activeElement?.closest(".site-header") !== null;
      });

    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Tab");
      expect(await inMenu(), `Tab ${i}`).toBe(true);
    }
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press("Shift+Tab");
      expect(await inMenu(), `Shift+Tab ${i}`).toBe(true);
    }
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

test.describe("dialogs", () => {
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
    .getByRole("navigation", { name: "Language" })
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

  for (const path of [
    "/foo/bar.html",
    "/img/nope.jpg",
    "/apiary",
    "/administrator",
    "/adminfoo",
    "/_nextfoo",
    "/a/b/c/d",
  ]) {
    test(`${path} gets the styled 404`, async ({ page }) => {
      await skipCookieBanner(page);
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { name: "Page not found" }),
      ).toBeVisible();
      await expect(page).toHaveTitle("Page not found | Casa Filakopi");
      await expect(page.locator(".footer-section")).toBeVisible();
    });
  }

  test("the tab title is translated", async ({ page }) => {
    await page.goto("/el/no-such-page");
    await expect(page).toHaveTitle("Η σελίδα δεν βρέθηκε | Casa Filakopi");
  });

  test("real files and routes are not caught by the 404 rewrite", async ({
    request,
  }) => {
    for (const path of [
      "/img/casa-icon-1.png",
      "/fonts/commissioner-greek-wght-normal.woff2",
      "/favicon.ico",
      "/api/health",
      "/admin",
      "/en/host",
    ]) {
      expect((await request.get(path)).status(), path).toBe(200);
    }
  });
});

test.describe("cookie consent", () => {
  test("only this site is contacted before consent", async ({
    page,
    baseURL,
  }) => {
    const elsewhere: string[] = [];
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol === "data:" || url.protocol === "blob:") return;
      if (url.origin !== baseURL) elsewhere.push(request.url());
    });

    await page.setViewportSize({ width: 375, height: 800 });
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
    expect(elsewhere).toEqual([]);
  });

  test.describe("before any script runs", () => {
    test.use({ javaScriptEnabled: false });

    test("a first visit gets the banner with the page itself", async ({
      page,
    }) => {
      await page.goto("/en");
      await expect(
        page.getByRole("region", { name: "Cookie choices" }),
      ).toBeVisible();
    });
  });

  test("a returning visitor never sees the banner flash", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en", { waitUntil: "commit" });
    await page.waitForSelector("html[data-consent='decided']", {
      state: "attached",
    });
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeHidden();
    // Reopening works once the page's script is running.
    await page.waitForLoadState("networkidle");
    await page.getByRole("button", { name: "Cookie settings" }).click();
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeVisible();
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

  test.describe("consent API", () => {
    const data = {
      granted: false,
      policyVersion: COOKIE_POLICY_VERSION,
      subject: "00000000-0000-4000-8000-000000000000",
    };

    test("refuses other origins and bad input", async ({
      request,
      baseURL,
    }) => {
      const crossSite = await request.post("/api/consent", {
        data,
        headers: { origin: "https://example.com" },
      });
      expect(crossSite.status()).toBe(403);

      const badBody = await request.post("/api/consent", {
        data: { ...data, granted: "yes" },
        headers: { origin: baseURL! },
      });
      expect(badBody.status()).toBe(400);
    });

    test("refuses a body over 1 KB", async ({ request, baseURL }) => {
      const response = await request.post("/api/consent", {
        data: { ...data, padding: "x".repeat(5000) },
        headers: { origin: baseURL! },
      });
      expect(response.status()).toBe(413);
    });

    test("stores a valid choice", async ({ request, baseURL }) => {
      const response = await request.post("/api/consent", {
        data,
        headers: {
          origin: baseURL!,
          "x-forwarded-for": `198.51.100.${Date.now() % 250}`,
        },
      });
      // CI's check job has no database; tests/unit covers both answers there.
      test.skip(response.status() === 503, "no database here");
      expect(response.status()).toBe(204);
    });
  });
});
