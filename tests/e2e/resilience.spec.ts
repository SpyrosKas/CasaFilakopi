import { expect, test, type Page } from "@playwright/test";
import { CONSENT_STORAGE_KEY } from "../../content/consent";
import { skipCookieBanner } from "./helpers";

const hiddenCount = (page: Page) =>
  page.evaluate(
    () =>
      // A collapsed accordion panel is not on the page to begin with.
      [...document.querySelectorAll("[data-reveal], [data-reveal-load]")]
        .filter((element) => element.checkVisibility())
        .filter((element) => Number(getComputedStyle(element).opacity) < 1)
        .length,
  );

test.describe("JavaScript fails to load", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/_next/static/**/*.js", (route) => route.abort());
  });

  for (const path of ["/en", "/el/host", "/en/directions", "/en/gallery"]) {
    test(`${path} still shows all its content`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();

      // The hero plays from CSS, with no failsafe wait.
      await expect(page.locator(".site-hero h1")).toHaveCSS("opacity", "1", {
        timeout: 2000,
      });
      await expect.poll(() => hiddenCount(page), { timeout: 5000 }).toBe(0);
    });
  }

  test("the page below the hero is not left blank", async ({ page }) => {
    await page.goto("/en");
    await page.waitForTimeout(2700);
    await expect(
      page.locator(".house-section [data-reveal]").first(),
    ).toHaveCSS("opacity", "1");
  });
});

test("the header turns solid when the scripts never run", async ({ page }) => {
  await page.route("**/_next/static/**/*.js", (route) => route.abort());
  await page.goto("/en");
  const header = page.locator(".site-header");
  await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(header).toHaveCSS("background-color", "rgb(251, 250, 246)", {
    timeout: 4000,
  });
});

test.describe("normal load", () => {
  test("reveals wait for scrolling, with no flash from the failsafe", async ({
    page,
  }) => {
    await skipCookieBanner(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/en");
    await page.waitForTimeout(3200);

    const lowSection = page.locator(".testimonial-section");
    await expect(lowSection).toHaveCSS("opacity", "0");
    expect(
      await page.evaluate(() =>
        document.documentElement.hasAttribute("data-reveal-active"),
      ),
    ).toBe(true);

    await lowSection.scrollIntoViewIfNeeded();
    await expect(lowSection).toHaveCSS("opacity", "1");
  });

  test("the hero is shown at once on a short screen", async ({ page }) => {
    await skipCookieBanner(page);
    await page.setViewportSize({ width: 375, height: 553 });
    await page.goto("/en");
    const button = page.locator(".site-hero .btn");
    await expect(button).toBeInViewport({ ratio: 1 });
    await expect(button).toHaveCSS("opacity", "1");
  });
});

test.describe("reduced motion", () => {
  test("everything is shown at once, without scrolling", async ({ page }) => {
    await skipCookieBanner(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.waitForLoadState("load");

    expect(await hiddenCount(page)).toBe(0);
    const moved = await page.evaluate(
      () =>
        [...document.querySelectorAll("[data-reveal], [data-reveal-load]")]
          .map((element) => getComputedStyle(element))
          .filter(
            (style) =>
              style.transform !== "none" ||
              style.animationName !== "none" ||
              style.transitionDuration !== "0s",
          ).length,
    );
    expect(moved).toBe(0);
  });
});

test("consent changes reach other open tabs", async ({ context, baseURL }) => {
  const first = await context.newPage();
  const second = await context.newPage();
  await first.route(/google\.com/, (route) =>
    route.fulfill({ status: 200, body: "<html></html>" }),
  );
  await second.route(/google\.com/, (route) =>
    route.fulfill({ status: 200, body: "<html></html>" }),
  );
  await first.goto(`${baseURL}/en/contact`);
  await second.goto(`${baseURL}/en/contact`);
  const banner = (page: Page) =>
    page.getByRole("region", { name: "Cookie choices" });
  await expect(banner(first)).toBeVisible();
  await expect(banner(second)).toBeVisible();

  await banner(first).getByRole("button", { name: "Accept" }).click();
  await expect(banner(second)).toBeHidden();
  await expect(second.locator("#main iframe")).toHaveCount(1);

  await first.getByRole("button", { name: "Cookie settings" }).click();
  await banner(first).getByRole("button", { name: "Decline" }).click();
  await expect(second.locator("#main iframe")).toHaveCount(0);

  const stored = await second.evaluate(
    (key) => window.localStorage.getItem(key),
    CONSENT_STORAGE_KEY,
  );
  expect(stored).toContain("declined");
});

test.describe("tap sizes on a phone", () => {
  test("footer and contact links are at least 44 px tall", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await skipCookieBanner(page);
    await page.goto("/en/contact");
    const small = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".footer-section a, .footer-section button, .contact-list a, .map-placeholder a",
        ),
      ]
        .map((element) => ({
          text: element.textContent || element.getAttribute("aria-label"),
          height: element.getBoundingClientRect().height,
        }))
        .filter(({ height }) => height < 44),
    );
    expect(small).toEqual([]);
  });
});

test.describe("image text", () => {
  test("no photo is described by a number alone", async ({ page }) => {
    await skipCookieBanner(page);
    for (const path of ["/en/directions", "/el/directions", "/en/gallery"]) {
      await page.goto(path);
      const generic = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            "img[alt], .gallery-thumb[aria-label]",
          ),
        ]
          .map(
            (element) =>
              element.getAttribute("alt") ||
              element.getAttribute("aria-label") ||
              "",
          )
          .filter((text) =>
            /^(Pic|Φωτ\.) \d|Photo \d|Φωτογραφία \d/.test(text),
          ),
      );
      expect(generic).toEqual([]);
    }
  });
});

test("the public name is Casa Filakopi", async ({ page }) => {
  await skipCookieBanner(page);
  for (const path of [
    "/en",
    "/el",
    "/en/host",
    "/en/directions",
    "/el/contact",
  ]) {
    await page.goto(path);
    await expect(page).toHaveTitle(/Casa Filakopi/);
    expect(await page.content()).not.toContain("Casa Milos");
  }
});
