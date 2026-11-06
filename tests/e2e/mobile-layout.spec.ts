import { expect, test, type Page } from "@playwright/test";
import {
  locales,
  publicPaths,
  scrollThroughPage,
  skipCookieBanner,
  waitForPhotos,
} from "./helpers";

// T3.1c. The real complaint behind this test: a round photo sat on the text in
// every house section on phones, and pages scrolled sideways.
const widths = [320, 375, 414, 768];

type Problem = string;

/** Sideways scrolling, or anything with text sticking out past the screen. */
async function findOverflow(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      problems.push(
        `page is ${root.scrollWidth}px wide on a ${root.clientWidth}px screen`,
      );
    }
    window.scrollTo(50, 0);
    if (window.scrollX !== 0) problems.push("page scrolled sideways");
    window.scrollTo(0, 0);
    return problems;
  });
}

/**
 * Compares every line of visible text with every visible image. Geometry only:
 * it does not care which one is painted on top, and CSS background photos do
 * not count because the heroes are meant to have text over them.
 */
async function findTextProblems(page: Page): Promise<Problem[]> {
  return page.evaluate(() => {
    const isVisible = (element: Element) => {
      if (element.closest("dialog:not([open])")) return false;
      if (element.closest(".sr-only, .skip-link")) return false;
      for (let e: Element | null = element; e; e = e.parentElement) {
        const style = getComputedStyle(e);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
      }
      return true;
    };

    const images = [...document.querySelectorAll("img")]
      .filter(isVisible)
      .map((image) => ({
        rect: image.getBoundingClientRect(),
        name: image.getAttribute("src") ?? "",
      }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0);

    const problems: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    const screenWidth = document.documentElement.clientWidth;

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest("script, style, noscript")) {
        continue;
      }
      if (!isVisible(parent)) continue;

      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = [...range.getClientRects()].filter(
        (line) => line.width > 0 && line.height > 0,
      );
      const label = text.slice(0, 40);

      for (const line of lines) {
        if (line.left < -1 || line.right > screenWidth + 1) {
          problems.push(`"${label}" runs off the screen`);
        }
        for (const { rect, name } of images) {
          const width =
            Math.min(line.right, rect.right) - Math.max(line.left, rect.left);
          const height =
            Math.min(line.bottom, rect.bottom) - Math.max(line.top, rect.top);
          if (width > 1 && height > 1) {
            problems.push(`"${label}" is covered by ${name}`);
          }
        }
      }
    }
    return [...new Set(problems)];
  });
}

/** Reveals everything visible, then runs both checks on the final layout. */
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
  // Longest transition: 1s plus a 1s delay.
  await page.waitForTimeout(2100);

  expect(await findOverflow(page), "after reveal").toEqual([]);
  expect(await findTextProblems(page)).toEqual([]);
}

for (const locale of locales) {
  for (const path of publicPaths) {
    for (const width of widths) {
      test(`/${locale}${path} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await skipCookieBanner(page);
        await page.goto(`/${locale}${path}`);

        // First with animations still waiting: this is what the legacy site
        // got wrong, 475 px wide until each element had been scrolled past.
        await page.waitForLoadState("load");
        expect(await findOverflow(page), "before reveal").toEqual([]);

        await expectCleanLayout(page);

        if (path === "/directions") {
          // The second route is collapsed until asked for.
          await page
            .locator(".accordion .card")
            .nth(1)
            .locator("button")
            .first()
            .click();
          await expectCleanLayout(page);
        }
      });
    }
  }

  // The round photo must clear the text at any width, not only on phones.
  for (const width of [992, 1100, 1199, 1200, 1280]) {
    test(`/${locale} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await skipCookieBanner(page);
      await page.goto(`/${locale}`);
      await page.waitForLoadState("load");
      await expectCleanLayout(page);
    });
  }

  for (const width of widths) {
    test(`/${locale} menu open at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await skipCookieBanner(page);
      await page.goto(`/${locale}`);
      await page.locator(".site-menu-toggle").click();
      await page.waitForTimeout(500);
      const navbar = page.locator("#site-navbar");
      expect(
        await navbar.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    });

    test(`/${locale} cookie banner at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/${locale}`);
      await expect(page.locator(".cookie-banner")).toBeVisible();
      expect(await findOverflow(page)).toEqual([]);
      const box = await page.locator(".cookie-banner").boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(800);
      expect(box!.height).toBeLessThanOrEqual(800 * 0.6);
    });
  }
}
