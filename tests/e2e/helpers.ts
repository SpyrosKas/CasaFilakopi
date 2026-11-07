import type { Page } from "@playwright/test";
import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
  type StoredConsent,
} from "../../content/consent";

export const locales = ["en", "el"] as const;

export const publicPaths = [
  "",
  "/host",
  "/directions",
  "/gallery",
  "/contact",
  "/faq",
  "/house-rules",
  "/privacy",
  "/terms",
  "/cancellation",
  "/cookies",
  "/book",
  "/this-page-does-not-exist",
];

/** Pretends the visitor already chose, so the banner stays out of the way. */
export async function skipCookieBanner(page: Page) {
  const stored: StoredConsent = {
    choice: "declined",
    id: "00000000-0000-4000-8000-000000000000",
    version: COOKIE_POLICY_VERSION,
    at: Date.now(),
  };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [CONSENT_STORAGE_KEY, JSON.stringify(stored)],
  );
}

/** Scrolls top to bottom so lazy photos load and every reveal fires. */
export async function scrollThroughPage(page: Page) {
  await page.evaluate(async () => {
    const pause = () => new Promise((done) => setTimeout(done, 40));
    const step = Math.round(window.innerHeight * 0.7);
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await pause();
    }
    window.scrollTo(0, 0);
  });
}

export async function waitForPhotos(page: Page) {
  await page.evaluate(async () => {
    const pending = [...document.images]
      .filter((image) => image.offsetParent !== null)
      .map((image) => {
        image.loading = "eager";
        return image.decode().catch(() => {});
      });
    await Promise.all(pending);
  });
}
