import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  newOwnerPage,
  signInWithPassword,
  testAddress,
  type TestUser,
} from "./admin-helpers";
import {
  baseBlocks,
  cleanTestContent,
  expectNoBrokenImages,
  filePayload,
  HERO_COLLECTION,
  LIST_MARK,
  mediaInSection,
  photoWithGps,
  publicPhotos,
  publishedField,
  recordActions,
  ROOM_COLLECTION,
  seedTestPage,
  SHARE_COLLECTION,
  storage,
  TEST_SLUG,
  uniqueMark,
  type RecordedAction,
} from "./cms-helpers";
import { findLayoutProblems, findOverflow } from "./layout-checks";
import { skipCookieBanner } from "./helpers";

// Yorgos's work, end to end, on the test-only page: everything real, from the
// admin screens through Storage to what a visitor gets.

test.describe.configure({ mode: "serial" });

const PHONE = { width: 375, height: 812 };
const ROOM_PHOTOS = `/admin/photos/${ROOM_COLLECTION}`;
const PUBLIC_EN = `/en/${TEST_SLUG}`;
const PUBLIC_EL = `/el/${TEST_SLUG}`;

let owner: TestUser;
let staff: TestUser;
let page: Page;
let visitor: BrowserContext;
let staffContext: BrowserContext;
let ownerAal1Context: BrowserContext;
let removedAdminContext: BrowserContext;
const actions = new Map<string, RecordedAction>();
const mark = uniqueMark();

const newContext = (browser: Browser) =>
  browser.newContext({
    viewport: PHONE,
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });

const expectNotice = (text: string | RegExp) =>
  expect(
    page.getByRole("status").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 30_000 });

const upload = (...files: ReturnType<typeof filePayload>[]) =>
  page.getByLabel("Add photos").setInputFiles(files);

const visitorText = async (path: string) => {
  const response = await visitor.request.get(path);
  return response.text();
};

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  await cleanTestContent();
  await seedTestPage(baseBlocks(mark));

  owner = await createTestUser("owner");
  staff = await createTestUser("staff");
  page = await newOwnerPage(browser, owner, PHONE);
  recordActions(page, actions);

  visitor = await newContext(browser);
  await visitor.addInitScript(() => {
    window.localStorage.setItem(
      "casa-filakopi-cookie-consent",
      JSON.stringify({ choice: "declined" }),
    );
  });

  staffContext = await newContext(browser);
  const staffPage = await staffContext.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);

  ownerAal1Context = await newContext(browser);
  const aal1Page = await ownerAal1Context.newPage();
  await signInWithPassword(aal1Page, owner);
  await expect(aal1Page).toHaveURL(/\/admin\/mfa$/);

  // Signed in, then taken off the team: proxy.ts still lets the session
  // through, so only each action's own check can stop it.
  const removed = await createTestUser("staff");
  removedAdminContext = await newContext(browser);
  const removedPage = await removedAdminContext.newPage();
  await signInWithPassword(removedPage, removed);
  await expect(removedPage).toHaveURL(/\/admin$/);
  await db.query(`delete from public.admin_profiles where id = $1`, [
    removed.id,
  ]);
});

test.afterAll(async () => {
  await cleanTestContent();
  await deleteCreatedUsers();
});

const countUploads = async () => {
  const { rows } = await db.query(
    `select count(*)::int as n from public.media where path like 'uploads/%'`,
  );
  const { data } = await storage.from("media").list("uploads", { limit: 1000 });
  return { rows: rows[0].n as number, files: data!.length };
};

const secondSession = async (browser: Browser, path: string) => {
  const context = await browser.newContext({
    storageState: await page.context().storageState(),
    viewport: PHONE,
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  const second = await context.newPage();
  await second.goto(path);
  return second;
};

test.describe("photos", () => {
  test("two uploads into an empty section both land, with one cover", async ({
    browser,
  }) => {
    await page.goto(ROOM_PHOTOS);
    const second = await secondSession(browser, ROOM_PHOTOS);
    const file = async (name: string, r: number) =>
      filePayload(name, await photoWithGps({ r, g: 10, b: 10 }));
    const [one, two] = [await file("one.jpg", 20), await file("two.jpg", 240)];

    await Promise.all([
      upload(one),
      second.getByLabel("Add photos").setInputFiles(two),
    ]);
    await expect
      .poll(async () => (await mediaInSection()).length, { timeout: 30_000 })
      .toBe(2);
    await expect
      .poll(
        async () =>
          (await mediaInSection()).filter((row) => row.is_cover).length,
      )
      .toBe(1);
    await expect(page.locator(".notice-bad")).toHaveCount(0);
    await expect(second.locator(".notice-bad")).toHaveCount(0);
    await second.context().close();

    await cleanTestContent();
    await seedTestPage(baseBlocks(mark));
  });

  test("two photos racing for a one-photo place leave one, and no stray file", async ({
    browser,
  }) => {
    const path = `/admin/photos/${SHARE_COLLECTION}`;
    const before = await countUploads();
    await page.goto(path);
    const second = await secondSession(browser, path);
    await Promise.all([
      page
        .getByLabel("Add a photo")
        .setInputFiles(
          filePayload("a.jpg", await photoWithGps({ r: 1, g: 200, b: 1 })),
        ),
      second
        .getByLabel("Add a photo")
        .setInputFiles(
          filePayload("b.jpg", await photoWithGps({ r: 200, g: 1, b: 1 })),
        ),
    ]);
    await expect
      .poll(async () => (await mediaInSection(SHARE_COLLECTION)).length, {
        timeout: 30_000,
      })
      .toBe(1);
    await expect
      .poll(countUploads, { timeout: 15_000 })
      .toEqual({ rows: before.rows + 1, files: before.files + 1 });

    // The one that lost is told why, in plain words, and the winner is not.
    const refused = [page, second].map((tab) =>
      tab.locator(".notice-bad").filter({ hasText: "added first" }),
    );
    await expect
      .poll(async () => (await refused[0].count()) + (await refused[1].count()))
      .toBe(1);
    await second.context().close();
    await cleanTestContent();
    await seedTestPage(baseBlocks(mark));
  });

  test("the database lets only one photo into a one-photo place", async () => {
    // What the race comes down to, with no timing left to luck: ten inserts
    // on their own connections, all claiming the place at once.
    const { rows: photos } = await db.query<{ id: string }>(
      `select id from public.media where path like 'site/%' limit 10`,
    );
    const attempts = await Promise.allSettled(
      photos.map(({ id }) =>
        db.query(
          `insert into public.media_placements
             (collection, media_id, sort_order, is_cover)
           values ($1, $2, 0, true)`,
          [SHARE_COLLECTION, id],
        ),
      ),
    );
    const lost = attempts.filter(
      (attempt): attempt is PromiseRejectedResult =>
        attempt.status === "rejected",
    );
    expect(lost).toHaveLength(photos.length - 1);
    expect(lost.every((attempt) => attempt.reason.code === "23505")).toBe(true);
    expect(await mediaInSection(SHARE_COLLECTION)).toHaveLength(1);
    await cleanTestContent();
    await seedTestPage(baseBlocks(mark));
  });

  test("Add cannot quietly replace a place filled in another tab", async ({
    browser,
  }) => {
    const path = `/admin/photos/${SHARE_COLLECTION}`;
    await page.goto(path);
    const second = await secondSession(browser, path);

    await page
      .getByLabel("Add a photo")
      .setInputFiles(
        filePayload("first.jpg", await photoWithGps({ r: 9, g: 99, b: 9 })),
      );
    await expectNotice("Photo added");
    const [winner] = await mediaInSection(SHARE_COLLECTION);

    await second
      .getByLabel("Add a photo")
      .setInputFiles(
        filePayload("late.jpg", await photoWithGps({ r: 99, g: 9, b: 9 })),
      );
    await expect(second.locator(".notice-bad")).toContainText("added first");
    expect(
      (await mediaInSection(SHARE_COLLECTION)).map((row) => row.id),
    ).toEqual([winner.id]);
    await second.context().close();
    await cleanTestContent();
    await seedTestPage(baseBlocks(mark));
  });

  test("upload from the admin screen shows on the public page", async () => {
    await page.goto(ROOM_PHOTOS);
    await expect(page.getByText("every change here appears")).toBeVisible();
    await upload(
      filePayload("first.jpg", await photoWithGps({ r: 200, g: 40, b: 40 })),
      filePayload("second.jpg", await photoWithGps({ r: 40, g: 200, b: 40 })),
      filePayload("third.jpg", await photoWithGps({ r: 40, g: 40, b: 200 })),
    );
    await expectNotice("3 photos added");

    const stored = await mediaInSection();
    expect(stored).toHaveLength(3);
    expect(stored[0].is_cover).toBe(true);

    const visitorPage = await visitor.newPage();
    expect(await publicPhotos(visitorPage, PUBLIC_EN)).toEqual(
      stored.map((row) => row.path),
    );
    await expectNoBrokenImages(visitorPage);
    await visitorPage.close();
  });

  test("the stored file has no location or camera data", async () => {
    // With the browser's own resizing turned off, so the server alone is
    // what removes it.
    await page.addInitScript(() => {
      window.createImageBitmap = () => Promise.reject(new Error("off"));
    });
    await page.goto(ROOM_PHOTOS);
    const original = await photoWithGps({ r: 90, g: 90, b: 90 });
    expect((await sharp(original).metadata()).exif).toBeTruthy();
    expect(original.includes("SecretCamera")).toBe(true);

    await upload(filePayload("raw.jpg", original));
    await expectNotice("Photo added");

    const stored = (await mediaInSection()).at(-1)!;
    const { data } = await storage.from("media").download(stored.path);
    const bytes = Buffer.from(await data!.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(bytes.includes("SecretCamera")).toBe(false);
    expect(bytes.includes("GPS")).toBe(false);

    // Nothing is left in the private bucket either.
    const { data: temp } = await storage
      .from("uploads-private")
      .list(`cms/${owner.id}`);
    expect(temp).toEqual([]);
  });

  test("a large phone photo is made smaller, and rotated upright", async () => {
    const big = await sharp({
      create: {
        width: 4000,
        height: 3000,
        channels: 3,
        background: { r: 10, g: 120, b: 90 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    await page.goto(ROOM_PHOTOS);
    await upload(filePayload("big.jpg", big));
    await expectNotice("Photo added");

    const stored = (await mediaInSection()).at(-1)!;
    const { data } = await storage.from("media").download(stored.path);
    const metadata = await sharp(
      Buffer.from(await data!.arrayBuffer()),
    ).metadata();
    expect(metadata.width).toBe(1920);
    expect(metadata.height).toBe(2560);
  });

  test("a file that is not a photo is refused in plain words", async () => {
    await page.goto(ROOM_PHOTOS);
    const before = await mediaInSection();
    await upload({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not a photo"),
    });
    await expect(page.locator(".notice-bad")).toContainText(
      "not a photo we can use",
    );

    await upload({
      name: "fake.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from("not really a photo"),
    });
    await expect(page.locator(".notice-bad")).toContainText(
      "could not be read",
    );
    expect(await mediaInSection()).toHaveLength(before.length);
  });

  test("up and down buttons reorder, saved and public", async () => {
    await page.goto(ROOM_PHOTOS);
    const before = await mediaInSection();
    const total = before.length;

    await page
      .getByRole("button", { name: `Move down: Photo 1 of ${total}` })
      .click();
    await expectNotice(`Moved to place 2 of ${total}`);

    const after = await mediaInSection();
    expect(after.map((row) => row.id)).toEqual([
      before[1].id,
      before[0].id,
      ...before.slice(2).map((row) => row.id),
    ]);
    expect(after[0].is_cover).toBe(true);
    expect(after[1].is_cover).toBe(false);

    const visitorPage = await visitor.newPage();
    expect(await publicPhotos(visitorPage, PUBLIC_EN)).toEqual(
      after.map((row) => row.path),
    );
    await visitorPage.close();
  });

  test("framing keeps the chosen spot in view, saved and public", async () => {
    await page.goto(ROOM_PHOTOS);
    const first = (await mediaInSection())[0];
    const framing = page.locator(".cms-photo").first().locator(".cms-focus");
    await framing.locator("summary").click();
    const picker = framing.getByRole("button", {
      name: /Choose the spot to keep in view/,
    });
    const box = (await picker.boundingBox())!;
    await picker.click({
      position: { x: box.width * 0.2, y: box.height * 0.8 },
    });
    // The keyboard moves it too, in steps of 5.
    await picker.press("ArrowRight");
    await framing.getByRole("button", { name: "Save framing" }).click();
    await expectNotice("Framing saved.");

    const stored = async () =>
      (
        await db.query<{ focus_x: number | null; focus_y: number | null }>(
          `select focus_x, focus_y from public.media where id = $1`,
          [first.id],
        )
      ).rows[0];
    const { focus_x: x, focus_y: y } = await stored();
    expect(x).toBeGreaterThanOrEqual(22);
    expect(x).toBeLessThanOrEqual(28);
    expect(y).toBeGreaterThanOrEqual(77);
    expect(y).toBeLessThanOrEqual(83);

    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EN);
    await expect(visitorPage.locator(".gallery__track img").first()).toHaveCSS(
      "object-position",
      `${x}% ${y}%`,
    );

    const again = page.locator(".cms-photo").first().locator(".cms-focus");
    await again.locator("summary").click();
    await again.getByRole("button", { name: "Back to centre" }).click();
    await expect
      .poll(stored, { timeout: 30_000 })
      .toEqual({ focus_x: null, focus_y: null });
    await visitorPage.reload();
    await expect(visitorPage.locator(".gallery__track img").first()).toHaveCSS(
      "object-position",
      "50% 50%",
    );
    await visitorPage.close();
  });

  test("the keyboard reaches and works the move buttons", async () => {
    await page.goto(ROOM_PHOTOS);
    const before = await mediaInSection();
    const total = before.length;
    await page
      .getByRole("button", { name: `Move up: Photo 2 of ${total}` })
      .focus();
    await page.keyboard.press("Enter");
    await expectNotice("New cover saved");
    expect((await mediaInSection())[0].id).toBe(before[1].id);
  });

  test("choosing a cover puts that photo first", async () => {
    await page.goto(ROOM_PHOTOS);
    const before = await mediaInSection();
    await page
      .getByRole("button", {
        name: `Make this the cover: Photo 3 of ${before.length}`,
      })
      .click();
    await expectNotice("New cover saved");
    const after = await mediaInSection();
    expect(after[0].id).toBe(before[2].id);
    expect(after[0].is_cover).toBe(true);
    expect(after.filter((row) => row.is_cover)).toHaveLength(1);
  });

  test("drag and drop reorders on a desktop", async ({ browser }) => {
    const desktop = await browser.newContext({
      storageState: await page.context().storageState(),
      // Tall enough to show both cards: the test tool scrolls to the target
      // before moving the mouse, which stops a drag from starting at all.
      viewport: { width: 1280, height: 2400 },
      extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    });
    const desktopPage = await desktop.newPage();
    await desktopPage.goto(ROOM_PHOTOS);
    const before = await mediaInSection();

    const cards = desktopPage.locator(".cms-photo");
    await cards.nth(2).dragTo(cards.nth(0));
    await expect(
      desktopPage
        .getByRole("status")
        .filter({ hasText: "New cover saved" })
        .first(),
    ).toBeVisible();
    expect((await mediaInSection())[0].id).toBe(before[2].id);

    // The photo itself is the handle.
    const moved = await mediaInSection();
    const frames = desktopPage.locator(".cms-photo-frame");
    await frames.nth(2).dragTo(frames.nth(1));
    await expect(
      desktopPage
        .getByRole("status")
        .filter({ hasText: `Moved to place 2 of ${moved.length}` })
        .first(),
    ).toBeVisible();
    expect((await mediaInSection())[1].id).toBe(moved[2].id);

    // Three to a row on a laptop, so a drag does not cross a whole screen.
    const first = await cards.nth(0).boundingBox();
    const third = await cards.nth(2).boundingBox();
    expect(third!.y).toBe(first!.y);
    await desktop.close();
  });

  test("a description is asked for, per language, and never copied", async () => {
    await page.goto(ROOM_PHOTOS);
    const first = page.locator(".cms-photo").first();
    await expect(first.getByText("Needs a description")).toBeVisible();
    await expect(first.getByLabel("Description in Greek")).toHaveValue("");
    await expect(first.getByLabel("Description in English")).toHaveValue("");

    await first.getByRole("button", { name: "Save" }).click();
    await expect(page.locator(".notice-bad")).toContainText(
      "at least one language",
    );

    await first.getByLabel("Description in English").fill(`Alt ${mark}`);
    await first.getByRole("button", { name: "Save" }).click();
    await expectNotice("Description saved");

    const refreshed = page.locator(".cms-photo").first();
    await expect(
      refreshed.getByText("Greek description is missing"),
    ).toBeVisible();
    await expect(refreshed.getByLabel("Description in Greek")).toHaveValue("");

    await refreshed
      .getByLabel("Description in Greek")
      .fill(`Περιγραφή ${mark}`);
    await refreshed.getByRole("button", { name: "Save" }).click();
    // The first save's notice is still on screen, so watch the data instead.
    await expect
      .poll(async () => (await mediaInSection())[0].alt.el)
      .toBe(`Περιγραφή ${mark}`);

    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EL);
    await expect(
      visitorPage.getByRole("button", {
        name: new RegExp(`Περιγραφή ${mark}`),
      }),
    ).toHaveCount(2);
    await visitorPage.close();
  });

  test("replace keeps the place in the order and removes the old file", async () => {
    await page.goto(ROOM_PHOTOS);
    const before = await mediaInSection();
    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: `Replace: Photo 2 of ${before.length}` })
      .click();
    await (
      await chooser
    ).setFiles(
      filePayload("new.jpg", await photoWithGps({ r: 250, g: 200, b: 0 })),
    );
    await expectNotice("Photo replaced");

    const after = await mediaInSection();
    expect(after).toHaveLength(before.length);
    expect(after[0].id).toBe(before[0].id);
    expect(after[1].id).not.toBe(before[1].id);
    expect(after[2].id).toBe(before[2].id);

    const oldUrl = storage.from("media").getPublicUrl(before[1].path);
    expect((await fetch(oldUrl.data.publicUrl)).status).toBeGreaterThanOrEqual(
      400,
    );
  });

  test("replacing a photo someone else just removed changes nothing", async () => {
    await page.goto(ROOM_PHOTOS);
    const stored = await mediaInSection();
    const before = await countUploads();

    // A second tab removes photo 2 while this one still shows it.
    await db.query(
      `delete from public.media_placements where collection = $1 and media_id = $2`,
      [ROOM_COLLECTION, stored[1].id],
    );

    const chooser = page.waitForEvent("filechooser");
    await page
      .getByRole("button", { name: `Replace: Photo 2 of ${stored.length}` })
      .click();
    await (
      await chooser
    ).setFiles(
      filePayload("late.jpg", await photoWithGps({ r: 7, g: 7, b: 7 })),
    );
    await expect(page.locator(".notice-bad")).toContainText("changed");

    // Nothing new is left, and the section did not lose a photo to it.
    expect(await countUploads()).toEqual(before);
    expect((await mediaInSection()).map((row) => row.id)).toEqual([
      stored[0].id,
      ...stored.slice(2).map((row) => row.id),
    ]);
    const { data: temp } = await storage
      .from("uploads-private")
      .list(`cms/${owner.id}`);
    expect(temp).toEqual([]);

    await db.query(
      `insert into public.media_placements (collection, media_id, sort_order)
       values ($1, $2, 99)`,
      [ROOM_COLLECTION, stored[1].id],
    );
  });

  test("delete warns when used elsewhere, and can remove from one section", async () => {
    const [target] = await mediaInSection();
    await db.query(
      `insert into public.media_placements (collection, media_id) values ($1, $2)`,
      [HERO_COLLECTION, target.id],
    );

    await page.goto(ROOM_PHOTOS);
    const total = (await mediaInSection()).length;
    await page
      .getByRole("button", { name: `Delete: Photo 1 of ${total}` })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("also used in: Test hero");

    // Nothing has happened yet.
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(await mediaInSection()).toHaveLength(total);

    await page
      .getByRole("button", { name: `Delete: Photo 1 of ${total}` })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove from this section only" })
      .click();
    await expectNotice("Removed from this section");

    const left = await mediaInSection();
    expect(left).toHaveLength(total - 1);
    expect(left[0].is_cover).toBe(true);
    expect(left.map((row) => row.id)).not.toContain(target.id);

    // Still in the other place, so the file is still there.
    const { publicUrl } = storage.from("media").getPublicUrl(target.path).data;
    expect((await fetch(publicUrl)).status).toBe(200);
  });

  test("delete everywhere removes the file and leaves no broken image", async () => {
    const [target] = await mediaInSection();
    const { publicUrl } = storage.from("media").getPublicUrl(target.path).data;
    expect((await fetch(publicUrl)).status).toBe(200);

    await page.goto(ROOM_PHOTOS);
    const total = (await mediaInSection()).length;
    await page
      .getByRole("button", { name: `Delete: Photo 1 of ${total}` })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete everywhere" })
      .click();
    await expectNotice("Photo deleted");

    const { rows } = await db.query(
      `select id from public.media where id = $1`,
      [target.id],
    );
    expect(rows).toEqual([]);
    expect((await fetch(publicUrl)).status).toBeGreaterThanOrEqual(400);

    const visitorPage = await visitor.newPage();
    expect(await publicPhotos(visitorPage, PUBLIC_EN)).not.toContain(
      target.path,
    );
    await expectNoBrokenImages(visitorPage);
    await visitorPage.close();
  });

  test("a required photo cannot be deleted, only replaced", async () => {
    await page.goto("/admin/photos/home.hero");
    await expect(page.getByRole("button", { name: /^Replace/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    await expect(page.getByLabel("Add a photo")).toHaveCount(0);
  });

  test("a photo removed from a section waits under unused photos", async () => {
    await page.goto(ROOM_PHOTOS);
    const [target, ...rest] = await mediaInSection();
    await page
      .getByRole("button", { name: `Delete: Photo 1 of ${rest.length + 1}` })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Remove from this section only" })
      .click();
    await expectNotice("Photos not used anywhere");

    await page.goto("/admin/photos/unused");
    const card = page.locator(".cms-photo").filter({
      has: page.locator(`img[src*="${target.path.split("/").pop()}"]`),
    });
    await card.getByLabel("Section").selectOption(ROOM_COLLECTION);
    await card.getByRole("button", { name: "Put in a section" }).click();
    await expectNotice("Added to the section");
    expect((await mediaInSection()).map((row) => row.id)).toContain(target.id);
  });
});

test.describe("text", () => {
  const draftEn = `Draft English ${mark}`;
  const draftEl = `Πρόχειρο κείμενο ${mark}`;
  const editorUrl = `/admin/content/${TEST_SLUG}`;

  async function openRoom() {
    await page.goto(editorUrl);
    await page.getByText("Test room", { exact: true }).click();
  }

  const typeBoth = async (english: string, greek: string) => {
    await page.getByRole("button", { name: "Greek", exact: true }).click();
    await page.getByLabel("Test room: title (Greek)").fill(greek);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByLabel("Test room: title (English)").fill(english);
  };

  test("a phone shows one language at a time, with plain labels", async () => {
    await openRoom();
    await expect(page.getByLabel("Test room: title (Greek)")).toBeVisible();
    await expect(page.getByLabel("Test room: title (English)")).toBeHidden();
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page.getByLabel("Test room: title (English)")).toBeVisible();
    await expect(page.getByLabel("Test room: title (Greek)")).toBeHidden();
  });

  test("drafts save themselves and stay private", async () => {
    await openRoom();
    await typeBoth(draftEn, draftEl);
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("publish-state")).toHaveText(
      "You have unpublished changes.",
    );

    expect((await publishedField("room", "en", "title")).draft).toBe(draftEn);
    expect((await publishedField("room", "en", "title")).published).toBe(
      `Room ${mark}`,
    );

    // The HTML, and the RSC payload a client navigation asks for.
    for (const path of [PUBLIC_EN, PUBLIC_EL]) {
      const html = await visitorText(path);
      expect(html).not.toContain("Draft English");
      expect(html).not.toContain("Πρόχειρο");
      const rsc = await visitor.request.get(path, { headers: { RSC: "1" } });
      const payload = await rsc.text();
      expect(payload).not.toContain("Draft English");
      expect(payload).not.toContain("Πρόχειρο");
    }

    // Through the anon key the draft column does not exist for this role.
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/content_blocks?select=draft`;
    const anon = await fetch(url, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
    });
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });

  test("the preview shows the draft in the real page, to the Owner only", async () => {
    await page.goto(editorUrl);
    const [preview] = await Promise.all([
      page.waitForEvent("popup"),
      page.getByRole("button", { name: "Preview English" }).click(),
    ]);
    await expect(preview).toHaveURL(new RegExp(`${PUBLIC_EN}$`));
    await expect(preview.locator(".room__text h2")).toHaveText(draftEn);
    await expect(preview.getByText("Only you can see this")).toBeVisible();
    await expect(preview.locator(".site-header")).toBeVisible();
    await expect(preview.locator(".footer-section")).toBeVisible();

    // The preview cookie alone, in the hands of anyone else, shows nothing.
    const cookies = await page.context().cookies();
    const bypass = cookies.find((c) => c.name === "__prerender_bypass");
    expect(bypass).toBeTruthy();
    const cookie = `${bypass!.name}=${bypass!.value}`;
    for (const context of [visitor, staffContext]) {
      const response = await context.request.get(PUBLIC_EN, {
        headers: { cookie },
      });
      expect(await response.text()).not.toContain("Draft English");
    }
    const staffPreview = await staffContext.request.get(
      `/admin/content/preview?page=${TEST_SLUG}&lang=en`,
      { maxRedirects: 0 },
    );
    expect(staffPreview.headers().location).toContain("/admin/not-allowed");

    await preview.getByRole("link", { name: "Close preview" }).click();
    await expect(preview).toHaveURL(/\/admin\/content$/);
    await preview.goto(PUBLIC_EN);
    await expect(preview.getByText("Only you can see this")).toHaveCount(0);
    await preview.close();
  });

  test("publish puts both languages on the public page", async () => {
    await page.goto(editorUrl);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectNotice("Published");
    await expect(page.getByTestId("publish-state")).toHaveText(
      "Everything here is published.",
    );

    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EN);
    await expect(visitorPage.locator(".room__text h2")).toHaveText(draftEn);
    await visitorPage.goto(PUBLIC_EL);
    await expect(visitorPage.locator(".room__text h2")).toHaveText(draftEl);
    await visitorPage.close();
  });

  test("discard goes back to what is published", async () => {
    await openRoom();
    await typeBoth("Thrown away", "Πεταμένο");
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole("button", { name: "Discard changes" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(page.getByTestId("publish-state")).toHaveText(
      "Everything here is published.",
      { timeout: 15_000 },
    );
    expect((await publishedField("room", "en", "title")).draft).toBe(draftEn);
  });

  const discardAll = async () => {
    await page.getByRole("button", { name: "Discard changes" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(page.getByTestId("publish-state")).toHaveText(
      "Everything here is published.",
      { timeout: 15_000 },
    );
  };

  test("leaving one language empty warns before publishing", async () => {
    await openRoom();
    await page.getByLabel("Test room: description (Greek)").fill("");
    await expect(
      page.getByText("Test room: description (Greek) is empty"),
    ).toBeVisible();
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      "Test room: description (Greek is empty)",
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await discardAll();
  });

  test("a blank title cannot be published, and the page says which", async () => {
    await openRoom();
    await page.getByLabel("Test room: title (Greek)").fill("   ");
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();

    const notice = page.locator(".notice-bad").first();
    await expect(notice).toContainText("must be filled in");
    await expect(
      page.locator(".notice-bad").getByText("Test room: title (Greek)"),
    ).toBeVisible();
    expect((await publishedField("room", "el", "title")).published).toBe(
      draftEl,
    );
    await discardAll();
  });

  test("two sessions cannot overwrite each other's draft", async ({
    browser,
  }) => {
    await openRoom();
    const other = await secondSession(browser, editorUrl);
    await other.getByText("Test room", { exact: true }).click();

    await page.getByLabel("Test room: title (Greek)").fill("Από την πρώτη");
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });

    await other.getByLabel("Test room: title (Greek)").fill("Από τη δεύτερη");
    await expect(other.locator(".notice-bad")).toContainText("changed", {
      timeout: 15_000,
    });
    expect((await publishedField("room", "el", "title")).draft).toBe(
      "Από την πρώτη",
    );

    // It stops: more typing saves nothing, and it cannot publish.
    await other.getByLabel("Test room: title (Greek)").fill("Και κάτι ακόμα");
    await other.waitForTimeout(2000);
    expect((await publishedField("room", "el", "title")).draft).toBe(
      "Από την πρώτη",
    );
    await expect(
      other.getByRole("button", { name: "Publish", exact: true }),
    ).toBeDisabled();
    await other.context().close();

    await page.goto(editorUrl);
    await discardAll();
  });

  test("a save just after publishing still works, and a stale publish is honest", async () => {
    await openRoom();
    await page.getByLabel("Test room: title (Greek)").fill(draftEl + "!");
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectNotice("Published");
    await page.getByLabel("Test room: title (Greek)").fill(draftEl);
    await expect(page.getByTestId("publish-state")).toHaveText(
      "You have unpublished changes.",
    );
    await expect(page.locator(".notice-bad")).toHaveCount(0);
    await expect
      .poll(async () => (await publishedField("room", "el", "title")).draft)
      .toBe(draftEl);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectNotice("Published");
  });

  test("the previous version comes back as a draft to publish", async () => {
    await page.goto(editorUrl);
    await page
      .getByRole("button", { name: "Go back to the previous version" })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Go back to the previous version" })
      .click();
    await expect(page.getByTestId("publish-state")).toHaveText(
      "You have unpublished changes.",
      { timeout: 15_000 },
    );
    const field = await publishedField("room", "el", "title");
    expect(field.draft).toBe(draftEl + "!");
    expect(field.published).toBe(draftEl);
    expect(await visitorText(PUBLIC_EL)).toContain(draftEl);
    await discardAll();
  });

  test("a bad address in the link box is refused out loud", async () => {
    await openRoom();
    page.once("dialog", (dialog) => dialog.accept("javascript:alert(1)"));
    await page.getByRole("button", { name: "Link" }).first().click();
    await expect(
      page.getByRole("alert").filter({ hasText: "web address" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Test room: description (Greek)"),
    ).not.toHaveValue(/javascript/);
  });

  test("HTML from the form never reaches a page, but simple formatting does", async () => {
    await page.goto(editorUrl);
    await page.getByText("The text", { exact: true }).click();
    const body = [
      `<script>window.hacked = 1</script>Rules ${mark}`,
      `<img src=x onerror="window.hacked = 1"> **bold words**`,
      `[safe link](https://example.test/page) [bad link](javascript:alert(1))`,
    ].join("\n\n");
    await page.getByLabel("The text: the policy (Greek)").fill(body);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await page.getByLabel("The text: the policy (English)").fill(body);
    await expect(page.getByText("Draft saved")).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectNotice("Published");

    const stored = await publishedField("main", "en", "body");
    expect(stored.published).not.toContain("<script");
    expect(stored.published).not.toContain("onerror");

    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EN);
    await expect(visitorPage.locator(".page-content strong")).toHaveText(
      "bold words",
    );
    await expect(
      visitorPage.getByRole("link", { name: "safe link" }),
    ).toHaveAttribute("href", "https://example.test/page");
    await expect(visitorPage.locator('a[href^="javascript"]')).toHaveCount(0);
    expect(await visitorPage.evaluate(() => "hacked" in window)).toBe(false);
    await visitorPage.close();
  });

  test("a legal page keeps its notice until its own language is published", async () => {
    const blocks = baseBlocks(mark);
    blocks.main = { en: { body: `Real terms ${mark}` }, el: { body: "" } };
    await seedTestPage(blocks);

    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EN);
    await expect(visitorPage.getByText(`Real terms ${mark}`)).toBeVisible();
    await expect(visitorPage.locator("[data-placeholder]")).toHaveCount(0);

    await visitorPage.goto(PUBLIC_EL);
    await expect(visitorPage.locator("[data-placeholder]")).toBeVisible();
    await expect(visitorPage.getByText(`Real terms ${mark}`)).toHaveCount(0);
    await visitorPage.close();
  });

  test("a draft loaded by a script stays private until Yorgos publishes it", async () => {
    await seedTestPage(baseBlocks(mark));
    const loaded = `Loaded by script ${mark}`;
    await db.query(
      `update public.content_blocks b
       set draft = $1
       from public.pages p
       where p.id = b.page_id and p.slug = $2 and b.key = 'main'`,
      [
        JSON.stringify({ en: { body: loaded }, el: { body: loaded } }),
        TEST_SLUG,
      ],
    );

    expect(await visitorText(PUBLIC_EN)).not.toContain(loaded);
    const visitorPage = await visitor.newPage();
    await visitorPage.goto(PUBLIC_EN);
    await expect(visitorPage.locator("[data-placeholder]")).toBeVisible();
    await visitorPage.close();

    await page.goto("/admin/content");
    await expect(
      page.getByRole("link", { name: /Test page.*Unpublished changes/ }),
    ).toBeVisible();

    await page.goto(editorUrl);
    await expect(page.getByTestId("publish-state")).toHaveText(
      "You have unpublished changes.",
    );
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectNotice("Published");
    expect(await visitorText(PUBLIC_EN)).toContain(loaded);
  });

  for (const slug of ["privacy", "terms", "cancellation", "cookies"]) {
    test(`/${slug} still says its text must be provided`, async () => {
      const visitorPage = await visitor.newPage();
      await visitorPage.goto(`/en/${slug}`);
      await expect(visitorPage.locator("[data-placeholder]")).toContainText(
        "must be provided",
      );
      await visitorPage.close();
    });
  }
});

test.describe("lists", () => {
  const name = `${LIST_MARK}-${mark}`;
  const newEntry = () => page.locator(".cms-section-open");

  test("a new question stays hidden until it is published", async () => {
    await page.goto("/admin/content/lists/faq");
    await page.getByRole("button", { name: "Add a question" }).click();
    await newEntry().getByLabel("Question (English)").fill(name);
    await newEntry().getByLabel("Answer (English)").fill(`Answer ${mark}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectNotice("Saved");

    await expect(
      page
        .locator("details")
        .filter({ hasText: name })
        .getByText("Not published"),
    ).toBeVisible();
    const hidden = await visitor.request.get(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/faq?select=question`,
      {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY! },
      },
    );
    expect(await hidden.text()).not.toContain(name);
    expect(await visitorText("/en/faq")).not.toContain(name);
  });

  test("a review can be added, published, reordered and deleted", async () => {
    await page.goto("/admin/content/lists/testimonials");
    await page.getByRole("button", { name: "Add a review" }).click();
    await newEntry().getByLabel("Guest's name").fill(name);
    await newEntry().getByLabel("Stars").selectOption("4.5");
    await newEntry().getByLabel("Full review (English)").fill(`Lovely ${mark}`);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectNotice("Saved");

    const row = page.locator("details").filter({ hasText: name });
    await row.locator("summary").first().click();
    await row.getByRole("button", { name: "Publish" }).click();
    await expectNotice("Published");
    expect(await visitorText("/en")).toContain(name);

    await row.getByRole("button", { name: `Move up: ${name}` }).click();
    await expectNotice("New order saved");

    await row.getByRole("button", { name: "Hide from the site" }).click();
    await expectNotice("Hidden from the site");
    expect(await visitorText("/en")).not.toContain(name);

    await row.getByRole("button", { name: "Delete" }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Delete for good" })
      .click();
    await expectNotice("Deleted");
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("a place can be added and published", async () => {
    await page.goto("/admin/content/lists/places");
    await page.getByRole("button", { name: "Add a place" }).click();
    await newEntry().getByLabel("Name (English)").fill(name);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expectNotice("Saved");
    const row = page.locator("details").filter({ hasText: name });
    await row.locator("summary").first().click();
    await row.getByRole("button", { name: "Publish" }).click();
    await expectNotice("Published");
    expect(await visitorText("/en")).toContain(name);
    await row.getByRole("button", { name: "Hide from the site" }).click();
    await expectNotice("Hidden from the site");
  });
});

test.describe("who may use all this", () => {
  test("every recorded action is refused for Staff, an aal1 Owner and a removed admin", async () => {
    // saveDraft, publish, discard; start and finish upload, reorder, alt,
    // remove, delete, add existing; save, status, delete and reorder a list;
    // restore.
    expect(actions.size).toBeGreaterThanOrEqual(15);
    const snapshot = async () => {
      const { rows } = await db.query(`
        select
          (select count(*) from public.media) as media,
          (select count(*) from public.media_placements) as placements,
          (select count(*) from public.faq) as faq,
          (select count(*) from public.places) as places,
          (select count(*) from public.testimonials) as reviews,
          (select md5(string_agg(draft::text || published::text, ''))
             from public.content_blocks) as blocks`);
      return rows[0];
    };
    const before = await snapshot();

    const send = (context: BrowserContext, action: RecordedAction) =>
      context.request.post(action.url, {
        headers: {
          "next-action": action.action,
          "content-type": action.contentType,
          origin: test.info().project.use.baseURL!,
        },
        data: action.body,
        maxRedirects: 0,
      });
    const target = (response: { headers(): Record<string, string> }) => {
      const headers = response.headers();
      return (headers["x-action-redirect"] ?? headers.location ?? "").split(
        ";",
      )[0];
    };

    for (const action of actions.values()) {
      const asStaff = await send(staffContext, action);
      expect(target(asStaff), action.url).toContain("/admin/not-allowed");

      const asAal1 = await send(ownerAal1Context, action);
      expect(target(asAal1), action.url).toContain("/admin/mfa");

      const asRemoved = await send(removedAdminContext, action);
      expect(target(asRemoved), action.url).toContain("/admin/login");
    }
    expect(await snapshot()).toEqual(before);
  });

  test("the upload cleanup needs its secret", async ({ request }) => {
    const anyone = await request.get("/api/cron/cms");
    expect(anyone.status()).toBe(401);
    const wrong = await request.get("/api/cron/cms", {
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status()).toBe(401);
    const scheduler = await request.get("/api/cron/cms", {
      headers: { authorization: "Bearer cms-e2e-cron" },
    });
    expect(scheduler.status()).toBe(200);
    expect(await scheduler.json()).toEqual({ removed: 0 });
    // The database scheduler (pg_net) sends POST.
    const posted = await request.post("/api/cron/cms", {
      headers: { authorization: "Bearer cms-e2e-cron" },
    });
    expect(posted.status()).toBe(200);
  });

  test("Staff cannot open the screens", async () => {
    for (const path of [
      "/admin/content",
      `/admin/content/${TEST_SLUG}`,
      "/admin/content/lists/faq",
      "/admin/photos",
      ROOM_PHOTOS,
      "/admin/photos/unused",
    ]) {
      const response = await staffContext.request.get(path);
      expect(new URL(response.url()).pathname, path).toBe("/admin/not-allowed");
    }
  });

  test("a section name the site does not know is refused", async () => {
    const response = await page.goto("/admin/photos/section.nothing");
    expect(response?.status()).toBe(404);
  });
});

test.describe("phones", () => {
  const GREEK_WORD =
    "Αντιδιαμετρικότατασυνταγματικότατοςκαιάλλαπολλάμαζί".repeat(3);

  for (const width of [320, 375, 768]) {
    test(`admin screens fit at ${width} px with 44 px targets`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        storageState: await page.context().storageState(),
        viewport: { width, height: 800 },
        extraHTTPHeaders: { "x-forwarded-for": testAddress() },
      });
      const phone = await context.newPage();
      for (const path of [
        "/admin/content",
        `/admin/content/${TEST_SLUG}`,
        "/admin/content/directions",
        "/admin/content/lists/faq",
        "/admin/photos",
        ROOM_PHOTOS,
        "/admin/photos/section.kitchen",
        "/admin/photos/unused",
      ]) {
        await phone.goto(path);
        await phone.evaluate(() =>
          document
            .querySelectorAll("details")
            .forEach((details) => (details.open = true)),
        );
        expect(await findOverflow(phone), path).toEqual([]);
        const small = await phone.evaluate(() =>
          [
            ...document.querySelectorAll(
              "main button, main a, main summary, main select, main input:not([type=file]):not([type=radio])",
            ),
          ]
            .filter((element) => element.checkVisibility())
            .map((element) => ({
              text: element.textContent?.slice(0, 30),
              height: element.getBoundingClientRect().height,
            }))
            .filter(({ height }) => height < 44),
        );
        expect(small, path).toEqual([]);
      }
      await context.close();
    });

    test(`long Greek text stays clear at ${width} px`, async ({ browser }) => {
      const blocks = baseBlocks(mark);
      blocks.hero.el.title = GREEK_WORD;
      blocks.room.el = {
        title: GREEK_WORD,
        body: `${GREEK_WORD} ${"Μακρύ ελληνικό κείμενο χωρίς τέλος. ".repeat(80)}`,
      };
      await seedTestPage(blocks);

      const context = await browser.newContext({
        viewport: { width, height: 800 },
        extraHTTPHeaders: { "x-forwarded-for": testAddress() },
      });
      const phone = await context.newPage();
      await skipCookieBanner(phone);
      await phone.goto(PUBLIC_EL);
      await phone.evaluate(() =>
        document
          .querySelectorAll("[data-reveal]")
          .forEach((element) => element.removeAttribute("data-reveal")),
      );
      await expect(phone.locator(".room__text h2")).toHaveText(GREEK_WORD);
      expect(await findOverflow(phone)).toEqual([]);
      expect(await findLayoutProblems(phone)).toEqual([]);
      await context.close();
    });
  }
});
