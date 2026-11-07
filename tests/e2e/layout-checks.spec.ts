import { expect, test, type Page } from "@playwright/test";
import { skipCookieBanner } from "./helpers";
import {
  findFirstViewProblems,
  findLayoutProblems,
  findOverflow,
  freezeMotion,
} from "./layout-checks";

// Checks that the checks work. Each case puts a known problem on a page and
// requires it to be reported, so a check that stops detecting anything fails
// here instead of passing silently everywhere else.

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function fixture(page: Page, html: string) {
  await page.setViewportSize({ width: 400, height: 500 });
  await page.setContent(
    `<!doctype html><body style="margin:0;font:16px/1.5 sans-serif">${html}</body>`,
  );
}

const overlay = "position:absolute;left:0;top:0;width:200px;height:100px";

test.describe("fixtures", () => {
  test("clean page reports nothing", async ({ page }) => {
    await fixture(
      page,
      `<p>Plain text</p><img src="${png}" width=50 height=50>`,
    );
    expect(await findLayoutProblems(page)).toEqual([]);
  });

  test("text under an image", async ({ page }) => {
    await fixture(page, `<p>Text</p><img src="${png}" style="${overlay}">`);
    expect((await findLayoutProblems(page)).join()).toContain("is covered by");
  });

  test("text under a figure", async ({ page }) => {
    await fixture(
      page,
      `<p>Text</p><figure style="${overlay};margin:0"></figure>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("figure");
  });

  test("text under an iframe", async ({ page }) => {
    await fixture(page, `<p>Text</p><iframe style="${overlay}"></iframe>`);
    expect((await findLayoutProblems(page)).join()).toContain("iframe");
  });

  test("text under another panel", async ({ page }) => {
    await fixture(
      page,
      `<p>Text</p><div class="box" style="${overlay}"></div>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("div.box");
  });

  test("text over text", async ({ page }) => {
    await fixture(
      page,
      `<p style="position:absolute;top:0;margin:0">First line</p>
       <p style="position:absolute;top:0;margin:0">Other line</p>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("overlaps text");
  });

  test("text hidden behind anything at all", async ({ page }) => {
    await fixture(
      page,
      `<p>Text</p><span style="${overlay};background:#fff"></span>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("hidden behind");
  });

  test("text clipped sideways", async ({ page }) => {
    await fixture(
      page,
      `<div style="width:60px;overflow:hidden;white-space:nowrap">A long line of text</div>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("clipped by");
  });

  test("text clipped from below", async ({ page }) => {
    await fixture(
      page,
      `<div style="height:30px;width:80px;overflow:clip">Many words wrapping on many lines here</div>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("clipped by");
  });

  test("text off the screen", async ({ page }) => {
    await fixture(
      page,
      `<p style="position:absolute;left:380px;white-space:nowrap">Off the edge</p>`,
    );
    expect((await findLayoutProblems(page)).join()).toContain("runs off");
  });

  test("sideways scrolling", async ({ page }) => {
    await fixture(page, `<div style="width:900px;height:10px"></div>`);
    expect((await findOverflow(page)).join()).toContain("900px wide");
  });

  test("hero below the first view", async ({ page }) => {
    await fixture(
      page,
      `<section class="site-hero" style="padding-top:900px"><h1>Title</h1></section>`,
    );
    expect((await findFirstViewProblems(page)).join()).toContain(
      "outside the first view",
    );
  });

  test("hero not yet shown", async ({ page }) => {
    await fixture(
      page,
      `<section class="site-hero" style="opacity:0"><h1>Title</h1></section>`,
    );
    expect((await findFirstViewProblems(page)).join()).toContain("not fully");
  });
});

test.describe("the real site, with each defect put back", () => {
  test("D1: a hero control over the title", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.waitForLoadState("load");
    await freezeMotion(page);
    await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>(".site-hero h1")!;
      const button = document.querySelector<HTMLElement>(".site-hero .btn")!;
      button.style.position = "absolute";
      button.style.top = `${title.offsetTop + title.offsetHeight / 2}px`;
    });
    expect(
      (await findLayoutProblems(page, { firstViewOnly: true })).join(),
    ).toContain("overlaps text");
  });

  test("D3: legacy 700 px hero on a short screen", async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.waitForLoadState("load");
    await page.addStyleTag({
      content: `.site-hero:not(.page-hero), .site-hero:not(.page-hero) .site-hero-inner {
        height: 700px !important; min-height: 700px !important }`,
    });
    await freezeMotion(page);
    expect((await findFirstViewProblems(page)).join()).toContain(
      "outside the first view",
    );
  });

  test("a photo over the room text on phones", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await skipCookieBanner(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/en");
    await page.waitForLoadState("load");
    await page.addStyleTag({
      content: `.room > :first-child { margin-bottom: -160px !important; position: relative; z-index: 1 }`,
    });
    await freezeMotion(page);
    expect((await findLayoutProblems(page)).join()).toContain("is covered by");
  });

  test("Close on the arrows of the full-screen view at 320 px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.waitForLoadState("load");
    await page.locator(".house-pair .gallery__open").first().click();
    await page.addStyleTag({
      content: `.site-dialog__close { position: fixed !important; top: auto !important;
                bottom: 12px !important; right: 20px !important }`,
    });
    await freezeMotion(page);
    expect(
      (await findLayoutProblems(page, { root: "dialog[open]" })).join(),
    ).toContain("overlaps control");
  });

  test("clipped text in the cookie banner", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/en");
    await page.locator(".cookie-banner").waitFor();
    await page.addStyleTag({
      content: `.cookie-banner { height: 40px !important; overflow: hidden !important }`,
    });
    expect(
      (await findLayoutProblems(page, { root: ".cookie-banner" })).join(),
    ).toContain("clipped by");
  });

  test("menu text under the map panel", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await skipCookieBanner(page);
    await page.goto("/en");
    await page.waitForLoadState("load");
    await page.locator(".site-menu-toggle").click();
    await page.addStyleTag({
      content: `#site-navbar .map-placeholder { position: absolute; top: 100px; left: 0; right: 0 }`,
    });
    await freezeMotion(page);
    expect(
      (await findLayoutProblems(page, { root: "#site-navbar" })).join(),
    ).toContain("map-placeholder");
  });
});
