import { createHash, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  newOwnerPage,
  releaseSharedSettings,
  signInWithPassword,
  type TestUser,
} from "./admin-helpers";

// Runs on the one house row and the one settings row, which it puts back. The
// feeds cannot fetch anything real here: the safety rules refuse every local
// address, so the sync itself is tested in tests/db/channels.test.ts.

test.describe.configure({ mode: "serial" });

const HOUSE = "00000000-0000-4000-8000-000000000001";
const SECRET_LINK = `https://www.airbnb.com/calendar/ical/1.ics?s=${randomUUID()}`;

let owner: TestUser;
let staff: TestUser;
let page: Page;
let savedSettings: unknown;
let savedCalendars: unknown[];
let savedToken: unknown;
let conflictRoom: string;

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");

  const settings = await db.query(
    `select value from public.settings where key = 'channel_sync'`,
  );
  savedSettings = settings.rows[0]?.value ?? null;
  const calendars = await db.query(
    `select * from public.external_calendars where room_id = $1`,
    [HOUSE],
  );
  savedCalendars = calendars.rows;
  const token = await db.query(
    `select * from public.ical_export_tokens where room_id = $1`,
    [HOUSE],
  );
  savedToken = token.rows[0] ?? null;
  await db.query(`delete from public.ical_export_tokens where room_id = $1`, [
    HOUSE,
  ]);

  page = await newOwnerPage(browser, owner, { width: 320, height: 700 });
});

test.afterAll(async () => {
  await page?.context().close();
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'channel_sync'`,
    [JSON.stringify(savedSettings)],
  );
  await db.query(`delete from public.external_calendars where room_id = $1`, [
    HOUSE,
  ]);
  for (const row of savedCalendars as Record<string, unknown>[]) {
    await db.query(
      `insert into public.external_calendars
         (id, room_id, channel, import_url, is_enabled, last_synced_at, consecutive_failures)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.id,
        row.room_id,
        row.channel,
        row.import_url,
        row.is_enabled,
        row.last_synced_at,
        row.consecutive_failures,
      ],
    );
  }
  await db.query(`delete from public.ical_export_tokens where room_id = $1`, [
    HOUSE,
  ]);
  if (savedToken) {
    const { token_hash, rotated_at } = savedToken as {
      token_hash: string;
      rotated_at: string;
    };
    await db.query(
      `insert into public.ical_export_tokens (room_id, token_hash, rotated_at) values ($1, $2, $3)`,
      [HOUSE, token_hash, rotated_at],
    );
  }
  if (conflictRoom) {
    await db.query(`delete from public.inventory_claims where room_id = $1`, [
      conflictRoom,
    ]);
    await db.query(`delete from public.rooms where id = $1`, [conflictRoom]);
  }
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

const airbnb = () => page.locator('[data-channel="airbnb"]');

test("states the limitation in plain words", async () => {
  await page.goto("/admin/integrations");
  await expect(
    page.getByRole("heading", { name: "Channel sync" }),
  ).toBeVisible();
  await expect(page.getByText("close to live, not instant")).toBeVisible();
  await expect(page.getByText("sold twice").first()).toBeVisible();
});

test("is in the menu for the Owner", async () => {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(
    page.getByRole("navigation").getByRole("link", { name: "Channel sync" }),
  ).toBeVisible();
});

test("keeps staff out", async ({ browser }) => {
  const context = await browser.newContext();
  const staffPage = await context.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);
  await staffPage.goto("/admin/integrations");
  await expect(staffPage).toHaveURL(/\/admin\/not-allowed$/);
  await context.close();
});

test("saves the general settings", async () => {
  await page.goto("/admin/integrations");
  await page.getByLabel("Every 30 minutes").check();
  await page.getByLabel("Turn channel sync on").check();
  await page.getByLabel("Booking.com").uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();

  const { rows } = await db.query(
    `select value from public.settings where key = 'channel_sync'`,
  );
  expect(rows[0].value).toMatchObject({
    enabled: true,
    intervalMinutes: 30,
    exportHolds: true,
    channels: { airbnb: true, booking_com: false },
  });
});

test.describe("checking a link before saving it", () => {
  const cases = [
    ["http://www.airbnb.com/a.ics", "must start with https://"],
    ["https://127.0.0.1/a.ics", "private address"],
    ["https://169.254.169.254/latest/meta-data", "private address"],
    ["https://localhost/a.ics", "private address"],
    ["not a link", "does not look like a web link"],
  ];

  for (const [url, message] of cases) {
    test(`refuses ${url}`, async () => {
      await page.goto("/admin/integrations");
      await airbnb().getByLabel("Link to their calendar").fill(url);
      await airbnb().getByRole("button", { name: "Check and save" }).click();
      await expect(airbnb().locator(".field-error")).toContainText(message);
      // What was typed stays there to be fixed.
      await expect(airbnb().getByLabel("Link to their calendar")).toHaveValue(
        url,
      );

      const { rows } = await db.query(
        `select import_url from public.external_calendars where room_id = $1 and channel = 'airbnb'`,
        [HOUSE],
      );
      expect(rows[0].import_url).toBeNull();
    });
  }
});

test("shows steps for finding the link", async () => {
  await page.goto("/admin/integrations");
  await airbnb().getByText("Where do I find the link").click();
  await expect(airbnb().getByText("Connect calendars")).toBeVisible();
});

test("never sends a saved link to the browser", async () => {
  await db.query(
    `update public.external_calendars
     set import_url = $1, is_enabled = true, consecutive_failures = 3,
         last_synced_at = now()
     where room_id = $2 and channel = 'airbnb'`,
    [SECRET_LINK, HOUSE],
  );
  await page.goto("/admin/integrations");
  await expect(airbnb().getByText("www.airbnb.com/")).toBeVisible();
  const html = await page.content();
  expect(html).not.toContain(SECRET_LINK);
  expect(html).not.toContain(new URL(SECRET_LINK).search.slice(3));
});

test("warns about a feed that keeps failing", async () => {
  await page.goto("/admin");
  await expect(page.getByTestId("channel-alerts")).toContainText(
    "Airbnb has failed 3 times in a row",
  );
});

test("shows the sync log in plain words", async () => {
  const { rows } = await db.query(
    `select id from public.external_calendars where room_id = $1 and channel = 'airbnb'`,
    [HOUSE],
  );
  await db.query(
    `insert into public.sync_logs (calendar_id, status, finished_at, error)
     values ($1, 'failed', now(), 'timeout')`,
    [rows[0].id],
  );
  await page.goto("/admin/integrations");
  await expect(page.getByTestId("sync-log")).toContainText(
    "The site took too long to answer",
  );
});

test("Sync now reports a failure and releases nothing", async () => {
  await db.query(
    `update public.external_calendars
     set import_url = 'https://127.0.0.1/feed.ics', is_enabled = true,
         consecutive_failures = 0
     where room_id = $1 and channel = 'airbnb'`,
    [HOUSE],
  );
  await page.goto("/admin/integrations");
  await airbnb().getByRole("button", { name: "Sync Airbnb now" }).click();
  await expect(airbnb().getByText("1 of 1 could not be read")).toBeVisible();
  await expect(page.getByTestId("sync-log")).toContainText("private address");

  await page.getByRole("button", { name: "Sync everything now" }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
});

test("removes a link and keeps the taken dates", async () => {
  await page.goto("/admin/integrations");
  await airbnb().getByRole("button", { name: "Remove link" }).click();
  await expect(airbnb().getByText("Link removed")).toBeVisible();
  const { rows } = await db.query(
    `select import_url, is_enabled from public.external_calendars where room_id = $1 and channel = 'airbnb'`,
    [HOUSE],
  );
  expect(rows[0]).toEqual({ import_url: null, is_enabled: false });
});

test.describe("our calendar for the other sites", () => {
  let firstPath: string;

  const pathOf = (link: string) => new URL(link).pathname;

  async function shownLinks() {
    const links = await page
      .getByTestId("export-links")
      .locator(".channel-link")
      .allTextContents();
    expect(links).toHaveLength(3);
    return links;
  }

  test("creates a link per site, shown once, stored only as a hash", async ({
    request,
  }) => {
    await page.goto("/admin/integrations");
    await page.getByRole("button", { name: "Create links" }).click();
    await expect(page.getByText("Copy these now")).toBeVisible();

    const links = await shownLinks();
    firstPath = pathOf(links[0]);
    expect(firstPath).toMatch(/^\/api\/ical\/airbnb-.{43}\.ics$/);

    const token = firstPath.slice("/api/ical/airbnb-".length, -".ics".length);
    const { rows } = await db.query(
      `select token_hash from public.ical_export_tokens where room_id = $1`,
      [HOUSE],
    );
    expect(rows[0].token_hash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );

    await page.reload();
    await expect(page.getByText("Links created on")).toBeVisible();
    expect(await page.content()).not.toContain(token);

    const feed = await request.get(firstPath);
    expect(feed.status()).toBe(200);
  });

  test("serves a calendar to anyone with the link, uncached", async ({
    request,
  }) => {
    const feed = await request.get(firstPath);
    expect(feed.status()).toBe(200);
    expect(feed.headers()["content-type"]).toContain("text/calendar");
    expect(feed.headers()["cache-control"]).toBe("no-store");
    const body = await feed.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("END:VCALENDAR");
  });

  test("answers a wrong link with 404", async ({ request }) => {
    const wrong = `/api/ical/airbnb-${randomBytes(32).toString("base64url")}.ics`;
    for (const path of [
      wrong,
      "/api/ical/nothing.ics",
      "/api/ical/airbnb.ics",
    ]) {
      const response = await request.get(path);
      expect(response.status()).toBe(404);
      expect(await response.text()).not.toContain("VCALENDAR");
    }
  });

  test("replacing the links stops the old ones", async ({ request }) => {
    await page.goto("/admin/integrations");
    await page.getByText("Replace the links").click();
    await page.getByRole("button", { name: "Replace all links" }).click();
    await expect(page.getByText("Copy these now")).toBeVisible();

    const links = await shownLinks();
    expect(pathOf(links[0])).not.toBe(firstPath);
    expect((await request.get(firstPath)).status()).toBe(404);
    expect((await request.get(pathOf(links[0]))).status()).toBe(200);
  });
});

test("the cron route refuses a caller without the secret", async ({
  request,
}) => {
  const attempts: Record<string, string>[] = [
    {},
    { authorization: "Bearer wrong" },
  ];
  for (const headers of attempts) {
    const response = await request.get("/api/cron/channel-sync", { headers });
    expect(response.status()).toBe(401);
    const post = await request.post("/api/cron/channel-sync", { headers });
    expect(post.status()).toBe(401);
  }
});

test("shows a double booking on the home page and Channel sync", async ({
  browser,
}) => {
  conflictRoom = randomUUID();
  await db.query(
    `insert into public.rooms (id, slug, name, max_adults, base_occupancy, base_price_cents, created_at)
     values ($1, $2, '{"en":"Conflict test"}', 4, 2, 10000, now() + interval '1 year')`,
    [conflictRoom, `conflict-test-${conflictRoom}`],
  );
  const { rows } = await db.query(
    `insert into public.external_calendars (room_id, channel, is_enabled)
     values ($1, 'airbnb', false), ($1, 'booking_com', false)
     returning id`,
    [conflictRoom],
  );
  await db.query(
    `select public.upsert_external_event($1, 'first', '2031-02-03', '2031-02-09', 'Reserved')`,
    [rows[0].id],
  );
  await db.query(
    `select public.upsert_external_event($1, 'second', '2031-02-05', '2031-02-11', 'CLOSED - Not available')`,
    [rows[1].id],
  );

  const line = /5 Feb 2031 to 11 Feb 2031/;
  await page.goto("/admin");
  await expect(page.getByTestId("channel-alerts")).toContainText(line);
  await page.goto("/admin/integrations");
  await expect(page.getByTestId("channel-alerts")).toContainText(line);

  const context = await browser.newContext();
  const staffPage = await context.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);
  await expect(staffPage.getByTestId("channel-alerts")).toContainText(line);
  await context.close();
});

test("works at 320 px with 44 px targets", async () => {
  await page.goto("/admin/integrations");
  await page.getByText("Replace the links").click();

  const problems = await page.evaluate(() => {
    const found: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth > root.clientWidth) {
      found.push(`page is ${root.scrollWidth}px wide`);
    }
    const main = document.querySelector("main") as HTMLElement;
    const targets = main.querySelectorAll(
      "a, button, summary, input:not([type=hidden]), label.choice",
    );
    for (const target of targets) {
      const element = target as HTMLElement;
      const box = (
        element.closest("label.choice") ?? element
      ).getBoundingClientRect();
      if (box.width > 0 && box.height < 44) {
        found.push(`${element.tagName} ${element.textContent} ${box.height}`);
      }
      if (box.right > root.clientWidth + 0.5) {
        found.push(`past the edge: ${element.tagName}`);
      }
    }
    return found;
  });
  expect(problems).toEqual([]);
});
