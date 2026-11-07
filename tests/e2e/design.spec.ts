import { expect, test, type Page } from "@playwright/test";
import { locales, publicPaths, skipCookieBanner } from "./helpers";

// The redesign (D18): the owner's language selector, the header, the in-page
// galleries and the contrast rule.

const phone = { width: 375, height: 800 };
const desktop = { width: 1440, height: 900 };

const languageLink = (page: Page, name: string) =>
  page.locator(".lang").getByRole("link", { name, exact: true });

test.describe("language selector", () => {
  for (const [name, size] of [
    ["phone", phone],
    ["desktop", desktop],
  ] as const) {
    for (const path of publicPaths) {
      test(`on ${path || "/"} on a ${name}, top right`, async ({ page }) => {
        await page.setViewportSize(size);
        await skipCookieBanner(page);
        await page.goto(`/el${path}`);

        const greek = languageLink(page, "Ελληνικά");
        const english = languageLink(page, "English");
        await expect(greek).toBeVisible();
        await expect(english).toBeVisible();
        await expect(greek).toHaveAttribute("aria-current", "true");
        await expect(greek).toContainText("EL");
        await expect(english).toContainText("EN");
        await expect(greek.locator("svg")).toBeVisible();
        await expect(english.locator("svg")).toBeVisible();

        const box = (await english.boundingBox())!;
        expect(box.y).toBeLessThan(40);
        expect(box.x).toBeGreaterThan(size.width / 2);
        expect(box.height).toBeGreaterThanOrEqual(44);

        await english.click();
        await expect(page).toHaveURL(new RegExp(`/en${path}$`));
        await expect(page.locator("html")).toHaveAttribute("lang", "en");
      });
    }
  }

  test("fits beside the wordmark in Greek at 320 px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await skipCookieBanner(page);
    await page.goto("/el/directions");
    const logo = (await page.locator(".site-logo").boundingBox())!;
    const lang = (await page.locator(".lang").boundingBox())!;
    const toggle = (await page.locator(".site-menu-toggle").boundingBox())!;
    expect(logo.x + logo.width).toBeLessThanOrEqual(lang.x);
    expect(lang.x + lang.width).toBeLessThanOrEqual(toggle.x);
  });

  test("works with the keyboard", async ({ page }) => {
    await page.setViewportSize(phone);
    await skipCookieBanner(page);
    await page.goto("/en/host");
    await languageLink(page, "Ελληνικά").focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/el\/host$/);
  });

  test("stays usable while the menu is open", async ({ page }) => {
    await page.setViewportSize(phone);
    await skipCookieBanner(page);
    await page.goto("/en/gallery");
    await page.getByRole("button", { name: "Open menu" }).click();
    await languageLink(page, "Ελληνικά").click();
    await expect(page).toHaveURL(/\/el\/gallery$/);
    await expect(page.locator("body")).not.toHaveClass(/menu-open/);
  });

  test("the 404 keeps its address outside the locales", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/no-such-file.html");
    await languageLink(page, "Ελληνικά").click();
    await expect(
      page.getByRole("heading", { name: "Η σελίδα δεν βρέθηκε" }),
    ).toBeVisible();
  });
});

test.describe("header", () => {
  test("is see-through over the hero and solid after it", async ({ page }) => {
    await page.setViewportSize(desktop);
    await skipCookieBanner(page);
    await page.goto("/en");
    const header = page.locator(".site-header");
    await expect(header).toHaveAttribute("data-live", "");
    await expect(header).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");

    await page.evaluate(() => window.scrollTo(0, 700));
    await expect(header).toHaveCSS("background-color", "rgb(251, 250, 246)");
    await expect(header).toHaveCSS("color", "rgb(31, 42, 51)");
  });

  test("desktop shows the menu and Book, no menu button", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await skipCookieBanner(page);
    await page.goto("/el");
    const nav = page.locator(".site-nav");
    for (const name of ["Ο Οικοδεσπότης", "Οδηγίες", "Επικοινωνία"]) {
      await expect(nav.getByRole("link", { name })).toBeVisible();
    }
    await expect(page.locator(".site-header__book")).toBeVisible();
    await expect(page.locator(".site-menu-toggle")).toBeHidden();
    const bar = page.locator(".site-header__bar");
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
  });

  test("the phone keeps Book at hand once the hero is gone", async ({
    page,
  }) => {
    await page.setViewportSize(phone);
    await skipCookieBanner(page);
    await page.goto("/en");
    const book = page.locator(".book-bar .btn");
    await expect(book).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect(book).toBeVisible();

    // The closing call to action and the footer take over at the end.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(book).toBeHidden();

    await page.evaluate(() => window.scrollTo(0, 1500));
    await book.click();
    await expect(page).toHaveURL(/\/en\/book$/);
  });

  test("Book never competes with the cookie banner", async ({ page }) => {
    await page.setViewportSize(phone);
    await page.goto("/en");
    await expect(page.locator(".cookie-banner")).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await page.waitForTimeout(300);
    await expect(page.locator(".book-bar .btn")).toBeHidden();
  });

  test("in landscape, Book is in the header", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await skipCookieBanner(page);
    await page.goto("/el");
    await expect(page.locator(".site-header__book")).toBeInViewport();
    await expect(page.locator(".book-bar .btn")).toBeHidden();
  });
});

test.describe("house galleries", () => {
  const master = (page: Page) =>
    page.getByRole("group", { name: "Master Bedroom" });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(phone);
    await skipCookieBanner(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.waitForLoadState("load");
  });

  test("every photo is in the page, none behind a button", async ({ page }) => {
    const counts = await page
      .locator(".gallery")
      .evaluateAll((all) =>
        all.map((gallery) => gallery.querySelectorAll("img").length),
      );
    expect(counts).toEqual([1, 7, 4, 9, 1, 4, 8]);
    await expect(page.getByRole("button", { name: "View more" })).toHaveCount(
      0,
    );
  });

  test("swipes with CSS snap and shows the position", async ({ page }) => {
    const gallery = master(page);
    const track = gallery.locator(".gallery__track");
    await expect(track).toHaveCSS("scroll-snap-type", "x mandatory");
    await expect(gallery.getByText("Photo 1 of 7")).toBeAttached();
    await expect(gallery.locator(".position")).toHaveText("1 / 7");

    // What a finger does: scrolls the strip. The arrows are not involved.
    await track.evaluate((el) => {
      const slide = el.children[3] as HTMLElement;
      el.scrollLeft = slide.offsetLeft;
    });
    await expect(gallery.locator(".position")).toHaveText("4 / 7");
    await expect(gallery.getByText("Photo 4 of 7")).toBeAttached();
  });

  test("arrows and keys move it, and wrap round", async ({ page }) => {
    const gallery = master(page);
    await gallery.getByRole("button", { name: "Next" }).click();
    await expect(gallery.locator(".position")).toHaveText("2 / 7");
    await gallery.getByRole("button", { name: "Previous" }).click();
    await gallery.getByRole("button", { name: "Previous" }).click();
    await expect(gallery.locator(".position")).toHaveText("7 / 7");
    await gallery.getByRole("button", { name: "Next" }).click();
    await expect(gallery.locator(".position")).toHaveText("1 / 7");

    await gallery.locator(".gallery__open").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(gallery.locator(".position")).toHaveText("2 / 7");
    await expect(gallery.locator(".gallery__open").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(gallery.locator(".position")).toHaveText("1 / 7");
  });

  test("only the current photo is a Tab stop", async ({ page }) => {
    const tabbable = await master(page)
      .locator(".gallery__open")
      .evaluateAll(
        (all) =>
          all.filter((button) => (button as HTMLElement).tabIndex === 0).length,
      );
    expect(tabbable).toBe(1);
  });

  test("nothing moves by itself", async ({ page }) => {
    const gallery = master(page);
    await page.waitForTimeout(5500);
    await expect(gallery.locator(".position")).toHaveText("1 / 7");
  });

  test("a tap opens that photo full screen, Esc comes back", async ({
    page,
  }) => {
    const gallery = master(page);
    await gallery.getByRole("button", { name: "Next" }).click();
    const opener = gallery.locator(".gallery__open").nth(1);
    await opener.focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("dialog", { name: "Master Bedroom" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".position")).toHaveText("2 / 7");
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBe(phone.width);
    expect(box.height).toBe(phone.height);

    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator(".position")).toHaveText("3 / 7");
    await dialog.getByRole("button", { name: "Previous" }).click();
    await dialog.getByRole("button", { name: "Previous" }).click();
    await expect(dialog.locator(".position")).toHaveText("1 / 7");

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });
});

test("the Gallery page opens the full-screen view at the chosen photo", async ({
  page,
}) => {
  await skipCookieBanner(page);
  await page.goto("/en/gallery");
  await page.locator(".gallery-group").nth(1).locator("button").nth(2).click();
  const dialog = page.getByRole("dialog", { name: "Master Bedroom" });
  await expect(dialog.locator(".position")).toHaveText("3 / 7");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();
});

test.describe("contrast (WCAG AA, 4.5:1)", () => {
  for (const locale of locales) {
    for (const path of ["", "/directions", "/contact"]) {
      test(`/${locale}${path}: text on a plain colour`, async ({ page }) => {
        await skipCookieBanner(page);
        await page.setViewportSize(desktop);
        await page.goto(`/${locale}${path}`);
        await page.evaluate(() => window.scrollTo(0, 2000));
        await expect(page.locator(".site-header")).toHaveCSS(
          "color",
          "rgb(31, 42, 51)",
        );

        const failures = await page.evaluate(() => {
          const parse = (value: string) => {
            const [r, g, b, a = 1] = value
              .match(/[\d.]+/g)!
              .map(Number) as number[];
            return { rgb: [r!, g!, b!], a };
          };
          const luminance = (rgb: number[]) => {
            const [r, g, b] = rgb.map((c) => {
              const v = c / 255;
              return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
          };
          const ratio = (a: number[], b: number[]) => {
            const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
            return (hi! + 0.05) / (lo! + 0.05);
          };
          const backgroundOf = (element: Element | null) => {
            for (let e = element; e; e = e.parentElement) {
              const { rgb, a } = parse(getComputedStyle(e).backgroundColor);
              if (a === 1) return rgb;
            }
            return [255, 255, 255];
          };

          const found: string[] = [];
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
          );
          for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const parent = n.parentElement;
            if (!n.textContent?.trim() || !parent) continue;
            if (parent.closest("script, style, .sr-only, .skip-link")) continue;
            // Over a photo: tests/e2e/layout-checks cannot read those, and the
            // hero and closing band are checked on the pixels in the report.
            if (parent.closest(".site-hero, .reserve-band")) continue;
            if (!parent.checkVisibility()) continue;
            const { rgb, a } = parse(getComputedStyle(parent).color);
            if (a !== 1) found.push(`translucent text: ${n.textContent}`);
            const value = ratio(rgb, backgroundOf(parent));
            if (value < 4.5) {
              found.push(`${value.toFixed(2)} "${n.textContent.slice(0, 30)}"`);
            }
          }
          return found;
        });
        expect(failures).toEqual([]);
      });
    }
  }

  test("every button colour on its own background", async ({ page }) => {
    await skipCookieBanner(page);
    await page.goto("/en");
    const ratios = await page.evaluate(() => {
      const sample = (className: string) => {
        const button = document.createElement("a");
        button.className = `btn ${className}`;
        document.body.append(button);
        const style = getComputedStyle(button);
        const colors = [style.color, style.backgroundColor];
        button.remove();
        return colors;
      };
      const channels = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const luminance = (rgb: number[]) => {
        const [r, g, b] = rgb.map((c) => {
          const v = c / 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
      };
      return ["btn-primary", "btn-light"].map((name) => {
        const [color, background] = sample(name);
        const [hi, lo] = [
          luminance(channels(color!)),
          luminance(channels(background!)),
        ].sort((x, y) => y - x);
        return (hi! + 0.05) / (lo! + 0.05);
      });
    });
    for (const value of ratios) expect(value).toBeGreaterThanOrEqual(4.5);
  });
});

test.describe("fonts", () => {
  test("Greek renders in the site's own fonts, from this site", async ({
    page,
  }) => {
    const fontUrls: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "font") fontUrls.push(request.url());
    });
    await skipCookieBanner(page);
    await page.goto("/el");
    await page.waitForLoadState("networkidle");
    const loaded = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts]
        .filter((font) => font.status === "loaded")
        .map((font) => `${font.family} ${font.unicodeRange.slice(0, 6)}`);
    });
    expect(loaded.join()).toContain("Noto Serif Display U+370");
    expect(loaded.join()).toContain("Commissioner U+370");
    expect(fontUrls.length).toBeGreaterThan(0);
    for (const url of fontUrls) {
      expect(url.startsWith(new URL(page.url()).origin)).toBe(true);
    }
  });
});
