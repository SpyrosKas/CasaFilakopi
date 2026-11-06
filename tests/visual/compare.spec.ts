import { mkdirSync } from "node:fs";
import { test, type Page } from "@playwright/test";
import sharp from "sharp";
import {
  publicPaths,
  scrollThroughPage,
  skipCookieBanner,
  waitForPhotos,
} from "../e2e/helpers";

// T3.10 (MIG-05). For each width, writes tests/visual/output/<page>-<width>.jpg:
// the old page on the left and the new one on the right. Pages with no old
// version are written as the new page alone, in both languages.
// Run with `pnpm visual`, then look at the images. It reports nothing by itself.
const output = "tests/visual/output";
const widths = [375, 768, 1280];
const newSite = process.env.NEW_SITE_URL ?? "http://localhost:3000";

const oldPages = [
  { name: "home", legacy: "/index.html", current: "" },
  { name: "host", legacy: "/host.html", current: "/host" },
  { name: "directions", legacy: "/directions.html", current: "/directions" },
];
const newPages = publicPaths.filter(
  (path) => !oldPages.some(({ current }) => current === path),
);

mkdirSync(output, { recursive: true });

async function capture(page: Page) {
  await scrollThroughPage(page);
  await waitForPhotos(page);
  await page.waitForTimeout(2200);
  return page.screenshot({ type: "png", fullPage: true });
}

async function sideBySide(left: Buffer, right: Buffer, file: string) {
  const gap = 24;
  const [a, b] = await Promise.all([
    sharp(left).metadata(),
    sharp(right).metadata(),
  ]);
  await sharp({
    create: {
      width: a.width + gap + b.width,
      height: Math.max(a.height, b.height),
      channels: 3,
      background: "#ff00ff",
    },
  })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: a.width + gap, top: 0 },
    ])
    .jpeg({ quality: 70 })
    .toFile(file);
}

for (const width of widths) {
  for (const { name, legacy, current } of oldPages) {
    test(`old vs new: ${name} at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });

      await page.goto(legacy, { waitUntil: "networkidle" });
      await scrollThroughPage(page);
      // AOS un-animates whatever leaves the screen, so pin its final state.
      await page.addStyleTag({
        content:
          "[data-aos]{opacity:1!important;transform:none!important;transition:none!important}",
      });
      await page.waitForTimeout(300);
      const before = await page.screenshot({ type: "png", fullPage: true });

      await skipCookieBanner(page);
      await page.goto(`${newSite}/en${current}`, { waitUntil: "networkidle" });
      const after = await capture(page);

      await sideBySide(before, after, `${output}/${name}-${width}.jpg`);
    });
  }

  for (const locale of ["en", "el"]) {
    for (const path of newPages) {
      const name = path.slice(1);
      test(`new page: ${locale} ${name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await skipCookieBanner(page);
        await page.goto(`${newSite}/${locale}${path}`, {
          waitUntil: "networkidle",
        });
        await sharp(await capture(page))
          .jpeg({ quality: 70 })
          .toFile(`${output}/new-${name}-${locale}-${width}.jpg`);
      });
    }

    for (const { name, current } of oldPages) {
      if (locale === "en") continue;
      test(`Greek: ${name} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await skipCookieBanner(page);
        await page.goto(`${newSite}/el${current}`, {
          waitUntil: "networkidle",
        });
        await sharp(await capture(page))
          .jpeg({ quality: 70 })
          .toFile(`${output}/el-${name}-${width}.jpg`);
      });
    }
  }
}
