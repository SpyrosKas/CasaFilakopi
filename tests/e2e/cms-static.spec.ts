import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  newOwnerPage,
  type TestUser,
} from "./admin-helpers";
import {
  baseBlocks,
  cleanTestContent,
  filePayload,
  mediaInSection,
  photoWithGps,
  publicPhotos,
  ROOM_COLLECTION,
  seedTestPage,
  TEST_SLUG,
  uniqueMark,
} from "./cms-helpers";

// WEB-08 needs a production build, because `next dev` caches nothing. Run with:
//   CMS_TEST_PAGE=1 pnpm build
//   CMS_TEST_PAGE=1 pnpm start -p 3006
//   CMS_STATIC_CHECK=1 PORT=3006 pnpm test:e2e tests/e2e/cms-static.spec.ts

test.skip(!process.env.CMS_STATIC_CHECK, "Needs a production server");
test.describe.configure({ mode: "serial" });

const PUBLIC_EN = `/en/${TEST_SLUG}`;
const mark = uniqueMark();

let owner: TestUser;
let page: Page;

async function cacheState(browser: Browser, path: string) {
  const context = await browser.newContext();
  const response = await context.request.get(path);
  const state = {
    cache: response.headers()["x-nextjs-cache"],
    text: await response.text(),
  };
  await context.close();
  return state;
}

async function publish(title: string) {
  await page.goto(`/admin/content/${TEST_SLUG}`);
  await page.getByText("Test room", { exact: true }).click();
  await page.getByLabel("Test room: title (Greek)").fill(title);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Test room: title (English)").fill(title);
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.getByText("Published. The site is updated.")).toBeVisible({
    timeout: 15_000,
  });
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  await cleanTestContent();
  await seedTestPage(baseBlocks(mark));
  owner = await createTestUser("owner");
  page = await newOwnerPage(browser, owner, { width: 375, height: 812 });
  await publish(`First ${mark}`);
});

test.afterAll(async () => {
  await cleanTestContent();
  await deleteCreatedUsers();
});

test("public pages are static, and publishing refreshes only the page changed", async ({
  browser,
}) => {
  await cacheState(browser, PUBLIC_EN);
  await cacheState(browser, "/en/host");
  await cacheState(browser, "/en/host");
  expect((await cacheState(browser, "/en/host")).cache).toBe("HIT");
  expect((await cacheState(browser, PUBLIC_EN)).cache).toBe("HIT");

  // Changed behind the site's back: a static page does not notice.
  await db.query(
    `update public.content_blocks b
     set published = jsonb_set(published, '{en,title}', to_jsonb('Sneaked in'::text))
     from public.pages p
     where p.id = b.page_id and p.slug = $1 and b.key = 'room'`,
    [TEST_SLUG],
  );
  const before = await cacheState(browser, PUBLIC_EN);
  expect(before.text).toContain(`First ${mark}`);
  expect(before.text).not.toContain("Sneaked in");

  await publish(`Second ${mark}`);

  const after = await cacheState(browser, PUBLIC_EN);
  expect(after.text).toContain(`Second ${mark}`);
  expect((await cacheState(browser, "/en/host")).cache).toBe("HIT");
  expect(await cacheState(browser, `/el/${TEST_SLUG}`)).toMatchObject({
    text: expect.stringContaining(`Second ${mark}`),
  });
});

test("a saved photo is on the static page right away", async ({ browser }) => {
  await page.goto(`/admin/photos/${ROOM_COLLECTION}`);
  await page
    .getByLabel("Add photos")
    .setInputFiles(
      filePayload("static.jpg", await photoWithGps({ r: 20, g: 160, b: 90 })),
    );
  await expect(page.getByText("Photo added")).toBeVisible({ timeout: 30_000 });

  const [stored] = await mediaInSection();
  const context = await browser.newContext();
  const visitor = await context.newPage();
  await expect
    .poll(() => publicPhotos(visitor, PUBLIC_EN), { timeout: 15_000 })
    .toEqual([stored.path]);
  await context.close();
});

test("draft text is not in the static page, and preview still works", async ({
  browser,
}) => {
  await page.goto(`/admin/content/${TEST_SLUG}`);
  await page.getByText("Test room", { exact: true }).click();
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByLabel("Test room: title (English)").fill(`Secret ${mark}`);
  await expect(page.getByText("Draft saved")).toBeVisible({ timeout: 15_000 });

  const [preview] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Preview English" }).click(),
  ]);
  await expect(preview.locator(".room__text h2")).toHaveText(`Secret ${mark}`);
  await preview.close();

  // The Owner's own preview must not have poisoned the cache.
  const state = await cacheState(browser, PUBLIC_EN);
  expect(state.text).not.toContain(`Secret ${mark}`);
});
