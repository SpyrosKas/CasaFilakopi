import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  CONSENT_STORAGE_KEY,
  COOKIE_POLICY_VERSION,
} from "../../content/consent";
import {
  locales,
  publicPaths,
  scrollThroughPage,
  skipCookieBanner,
} from "./helpers";

// Runs against a production build: see playwright.prod.config.ts.

const INDEXABLE = process.env.PROD_INDEXABLE === "true";
const realPages = publicPaths.filter((path) => !path.includes("does-not"));

/** Remembers every policy violation the browser reports on this page. */
async function watchPolicy(page: Page): Promise<() => Promise<string[]>> {
  const seen: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      seen.push(message.text());
    }
  });
  await page.addInitScript(() => {
    (window as unknown as { csp: string[] }).csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { csp: string[] }).csp.push(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return async () => [
    ...seen,
    ...(await page.evaluate(
      () => (window as unknown as { csp: string[] }).csp,
    )),
  ];
}

async function chooseConsent(page: Page, choice: "accepted" | "declined") {
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [
      CONSENT_STORAGE_KEY,
      JSON.stringify({
        choice,
        id: "00000000-0000-4000-8000-000000000000",
        version: COOKIE_POLICY_VERSION,
        at: Date.now(),
      }),
    ],
  );
}

test.describe("Content-Security-Policy on the production build", () => {
  for (const locale of locales) {
    for (const path of publicPaths) {
      for (const choice of ["declined", "accepted"] as const) {
        test(`/${locale}${path} with cookies ${choice}`, async ({ page }) => {
          const violations = await watchPolicy(page);
          await chooseConsent(page, choice);
          await page.goto(`/${locale}${path}`, { waitUntil: "networkidle" });
          await scrollThroughPage(page);
          await page.waitForLoadState("networkidle");
          expect(await violations()).toEqual([]);
        });
      }
    }
  }

  test("the map frame loads after consent, unblocked", async ({ page }) => {
    const violations = await watchPolicy(page);
    await chooseConsent(page, "accepted");
    const map = page.waitForResponse(/google\.com\/maps\/embed/);
    await page.goto("/en/contact");
    const frame = page.locator("main iframe.map-frame");
    await frame.scrollIntoViewIfNeeded();
    expect((await map).ok()).toBe(true);
    await page.waitForTimeout(2000);
    expect(await violations()).toEqual([]);
  });

  test("Turnstile's script and frame load on the contact page", async ({
    page,
  }) => {
    const violations = await watchPolicy(page);
    await chooseConsent(page, "accepted");
    const script = page.waitForResponse(/challenges\.cloudflare\.com/, {
      timeout: 20_000,
    });
    await page.goto("/en/contact");
    await page.getByRole("textbox").first().focus();
    await page.keyboard.type("a");
    await script;
    // Turnstile's frame keeps talking to Cloudflare, so the network never idles.
    // Its frame sits in a closed shadow root, so it is found as a frame.
    await expect
      .poll(
        () =>
          page
            .frames()
            .some((frame) => frame.url().includes("challenges.cloudflare.com")),
        { timeout: 20_000 },
      )
      .toBe(true);
    await page.waitForTimeout(2000);
    expect(await violations()).toEqual([]);
  });

  /** A form post that the server answers with a redirect, like checkout. */
  async function postThenRedirect(page: Page, target: string) {
    await page.route("**/fake-checkout", (route) =>
      route.fulfill({ status: 303, headers: { location: target } }),
    );
    await page.route(`${new URL(target).origin}/**`, (route) =>
      route.fulfill({ status: 200, body: "stand-in" }),
    );
    await page.goto("/en/book");
    await page.evaluate(() => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = "/fake-checkout";
      document.body.append(form);
      form.submit();
    });
  }

  test("a form may redirect to Stripe Checkout", async ({ page }) => {
    await postThenRedirect(page, "https://checkout.stripe.com/c/pay/test");
    await page.waitForURL(/checkout\.stripe\.com/);
  });

  test("a form may not redirect anywhere else", async ({ page }) => {
    await postThenRedirect(page, "https://evil.example/steal");
    await page.waitForTimeout(1500);
    expect(page.url()).not.toContain("evil.example");
  });

  test("the policy and its companions are on every public response", async ({
    request,
  }) => {
    const response = await request.get("/en");
    const headers = response.headers();
    expect(headers["content-security-policy"]).toContain(
      "form-action 'self' https://checkout.stripe.com",
    );
    expect(headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  test("the admin keeps its own, stricter policy", async ({ request }) => {
    const response = await request.get("/admin/login");
    const policy = response.headers()["content-security-policy"];
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("stripe");
    expect(policy).not.toContain("cloudflare");
  });
});

test.describe("search engines", () => {
  test("robots.txt keeps private areas out", async ({ request }) => {
    const text = await (await request.get("/robots.txt")).text();
    for (const path of ["/admin", "/api", "/booking/", "/el/booking/"]) {
      expect(text).toContain(`Disallow: ${path}`);
    }
    expect(text.includes("Sitemap:")).toBe(INDEXABLE);
  });

  test("every page has its own canonical and both languages", async ({
    page,
  }) => {
    for (const locale of locales) {
      for (const path of realPages) {
        await page.goto(`/${locale}${path}`);
        const href = (name: string) =>
          page.locator(`link[rel="${name}"]`).first().getAttribute("href");
        expect(await href("canonical")).toMatch(
          new RegExp(`/${locale}${path}$`),
        );
        for (const lang of ["en", "el", "x-default"]) {
          await expect(
            page.locator(`link[rel="alternate"][hreflang="${lang}"]`),
          ).toHaveCount(1);
        }
        expect(await page.title()).not.toBe("");
        await expect(page.locator('meta[name="description"]')).toHaveAttribute(
          "content",
          /\S/,
        );
        await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
          "content",
          /\S/,
        );
      }
    }
  });

  test("home describes the business, as valid JSON", async ({ page }) => {
    await page.goto("/en");
    const json = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    const data = JSON.parse(json!);
    expect(data["@type"]).toBe("LodgingBusiness");
    expect(data.name).toBeTruthy();
    expect(data.address.addressCountry).toBe("GR");
  });

  if (INDEXABLE) {
    test("production is indexable and has a sitemap", async ({
      page,
      request,
    }) => {
      const response = await page.goto("/en");
      expect(response?.headers()["x-robots-tag"]).toBeUndefined();
      await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

      const sitemap = await (await request.get("/sitemap.xml")).text();
      for (const locale of locales) {
        for (const path of realPages) {
          expect(sitemap).toContain(`/${locale}${path}</loc>`);
        }
      }
      expect(sitemap).toContain('hreflang="el"');
      expect(sitemap).not.toContain("/admin");
    });
  } else {
    test("staging is noindex everywhere, with no sitemap entries", async ({
      page,
      request,
    }) => {
      for (const path of ["/en", "/el/host", "/en/book"]) {
        const response = await page.goto(path);
        expect(response?.headers()["x-robots-tag"]).toContain("noindex");
        await expect(
          page.locator('meta[name="robots"]').first(),
        ).toHaveAttribute("content", /noindex/);
      }
      const sitemap = await (await request.get("/sitemap.xml")).text();
      expect(sitemap).not.toContain("<loc>");
    });
  }
});

test.describe("accessibility (WCAG 2.1 AA)", () => {
  for (const locale of locales) {
    for (const path of publicPaths) {
      test(`/${locale}${path}`, async ({ page }) => {
        // Measures the settled page, not a button halfway through fading in.
        await page.emulateMedia({ reducedMotion: "reduce" });
        await skipCookieBanner(page);
        await page.goto(`/${locale}${path}`);
        await scrollThroughPage(page);
        await page.waitForTimeout(800);
        const { violations } = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          violations.map((issue) => ({
            rule: issue.id,
            impact: issue.impact,
            where: issue.nodes.slice(0, 3).map((node) => node.target),
          })),
        ).toEqual([]);
      });
    }

    test(`/${locale} with the cookie banner open`, async ({ page }) => {
      await page.goto(`/${locale}`);
      await expect(page.getByRole("button").first()).toBeVisible();
      const { violations } = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      expect(violations.map((issue) => issue.id)).toEqual([]);
    });
  }
});
