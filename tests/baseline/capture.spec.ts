import { test } from "@playwright/test";

// Records how the old static site looks, for comparison during migration
// (MIG-05). Run with `pnpm baseline`.
const pages = ["index", "host", "directions"];
const widths = [375, 768, 1280];

for (const name of pages) {
  for (const width of widths) {
    test(`${name} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/${name}.html`, { waitUntil: "networkidle" });
      await page.evaluate(() =>
        document
          .querySelectorAll("[data-aos]")
          .forEach((el) => el.classList.add("aos-animate")),
      );
      await page.waitForTimeout(1500);
      await page.screenshot({
        path: `tests/baseline/legacy/${name}-${width}.jpg`,
        type: "jpeg",
        quality: 70,
        fullPage: true,
      });
    });
  }
}
