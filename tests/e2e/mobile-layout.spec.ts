import { expect, test, type Page } from "@playwright/test";
import {
  locales,
  publicPaths,
  scrollThroughPage,
  skipCookieBanner,
  waitForPhotos,
} from "./helpers";
import {
  findFirstViewProblems,
  findLayoutProblems,
  findOverflow,
  freezeMotion,
} from "./layout-checks";

// T3.1c. The real complaint behind this test: a round photo sat on the text in
// every house section on phones, and pages scrolled sideways.

const portraitWidths = [320, 375, 414, 768];
const greekWidths = [360, 390, 820, 991];
const shortScreens = [
  { width: 667, height: 375 },
  { width: 844, height: 390 },
  { width: 568, height: 320 },
  { width: 375, height: 553 },
  { width: 375, height: 600 },
  { width: 320, height: 568 },
  { width: 1280, height: 600 },
];
const shortScreenPaths = [
  "",
  "/host",
  "/directions",
  "/contact",
  "/faq",
  "/no-such-page",
];

/** Reveals everything visible, then checks the final layout. */
async function expectCleanLayout(page: Page) {
  await scrollThroughPage(page);
  await waitForPhotos(page);
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            [
              ...document.querySelectorAll(
                "[data-reveal]:not([data-revealed])",
              ),
            ].filter((element) => element.checkVisibility()).length,
        ),
      { message: "every element revealed" },
    )
    .toBe(0);
  await freezeMotion(page);

  expect(await findOverflow(page), "after reveal").toEqual([]);
  expect(await findLayoutProblems(page)).toEqual([]);
}

async function checkPage(
  page: Page,
  url: string,
  size: { width: number; height: number },
) {
  await page.setViewportSize(size);
  await skipCookieBanner(page);
  await page.goto(url);

  // Before anything has been scrolled to. This is what the legacy site got
  // wrong: 475 px wide until each element had been scrolled past.
  await page.waitForLoadState("load");
  expect(await findOverflow(page), "before reveal").toEqual([]);

  // What a visitor sees first, with no scrolling, once the hero has played.
  await page.waitForTimeout(1200);
  expect(await findFirstViewProblems(page), "first view").toEqual([]);
  expect(
    await findLayoutProblems(page, { firstViewOnly: true }),
    "first view layout",
  ).toEqual([]);

  await expectCleanLayout(page);

  if (url.endsWith("/directions")) {
    // The second route is collapsed until asked for.
    await page
      .locator(".accordion .card")
      .nth(1)
      .locator("button")
      .first()
      .click();
    await expectCleanLayout(page);
  }
}

for (const locale of locales) {
  for (const path of publicPaths) {
    for (const width of portraitWidths) {
      test(`/${locale}${path} at ${width}px`, async ({ page }) => {
        await checkPage(page, `/${locale}${path}`, { width, height: 800 });
      });
    }
  }

  for (const path of shortScreenPaths) {
    for (const size of shortScreens) {
      test(`/${locale}${path} at ${size.width}x${size.height}`, async ({
        page,
      }) => {
        await checkPage(page, `/${locale}${path}`, size);
      });
    }
  }

  // The round photo must clear the text at any width, not only on phones.
  for (const width of [992, 1100, 1199, 1200, 1280]) {
    test(`/${locale} at ${width}px`, async ({ page }) => {
      await checkPage(page, `/${locale}`, { width, height: 800 });
    });
  }

  for (const size of [
    { width: 320, height: 800 },
    { width: 768, height: 800 },
    { width: 1280, height: 800 },
    { width: 667, height: 375 },
  ]) {
    const name = `${size.width}x${size.height}`;

    test(`/${locale} menu open at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await skipCookieBanner(page);
      await page.goto(`/${locale}/contact`);
      await page.locator(".site-menu-toggle").click();
      await freezeMotion(page);
      const navbar = page.locator("#site-navbar");
      expect(
        await navbar.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(await findLayoutProblems(page, { root: "#site-navbar" })).toEqual(
        [],
      );
    });

    test(`/${locale} cookie banner at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto(`/${locale}`);
      await expect(page.locator(".cookie-banner")).toBeVisible();
      await page.waitForTimeout(1200);
      expect(await findOverflow(page)).toEqual([]);
      const box = await page.locator(".cookie-banner").boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(size.height);
      expect(box!.height).toBeLessThanOrEqual(size.height * 0.6);
      expect(
        await findLayoutProblems(page, { root: ".cookie-banner" }),
      ).toEqual([]);
      // The banner may sit over the button, but never over the page title.
      await expect(page.locator(".site-hero h1")).toBeInViewport();
    });

    test(`/${locale} every dialog at ${name}`, async ({ page }) => {
      await page.setViewportSize(size);
      await skipCookieBanner(page);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto(`/${locale}`);
      await page.waitForLoadState("load");

      const openers = page.locator(".house-section .btn, .box .btn");
      const total = await openers.count();
      expect(total).toBe(8);

      for (let i = 0; i < total; i++) {
        await openers.nth(i).click();
        const dialog = page.locator("dialog[open]");
        await expect(dialog).toBeVisible();
        await freezeMotion(page);
        await waitForPhotos(page);
        expect(
          await findLayoutProblems(page, { root: "dialog[open]" }),
          `dialog ${i}`,
        ).toEqual([]);

        // Long reviews scroll: Close must stay reachable at the bottom.
        await dialog.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        const close = dialog.locator(".site-dialog__close");
        await expect(close).toBeInViewport();
        await close.click();
        await expect(dialog).toHaveCount(0);
      }
    });
  }
}

for (const path of publicPaths) {
  for (const width of greekWidths) {
    test(`Greek /el${path} at ${width}px`, async ({ page }) => {
      await checkPage(page, `/el${path}`, { width, height: 800 });
    });
  }
}
