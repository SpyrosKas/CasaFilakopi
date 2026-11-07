import { expect, test, type Page } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  releaseSharedSettings,
  newOwnerPage,
  type TestUser,
} from "./admin-helpers";

test.describe.configure({ mode: "serial" });

let owner: TestUser;
let page: Page;
let savedProperty: Record<string, unknown>;
let savedRoom: Record<string, unknown>;
let savedBooking: unknown;

const HOUSE = "00000000-0000-4000-8000-000000000001";

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  owner = await createTestUser("owner");
  page = await newOwnerPage(browser, owner, { width: 375, height: 812 });

  savedProperty = (await db.query(`select * from public.property`)).rows[0];
  savedRoom = (
    await db.query(`select * from public.rooms where id = $1`, [HOUSE])
  ).rows[0];
  savedBooking = (
    await db.query(`select value from public.settings where key = 'booking'`)
  ).rows[0].value;
});

test.afterAll(async () => {
  await db.query(
    `update public.property set name = $1, phone = $2, check_in_time = $3, social_links = $4::jsonb`,
    [
      savedProperty.name,
      savedProperty.phone,
      savedProperty.check_in_time,
      JSON.stringify(savedProperty.social_links),
    ],
  );
  await db.query(
    `update public.rooms set name = $1::jsonb, description = $2::jsonb, max_adults = $3,
       max_children = $4, base_occupancy = $5 where id = $6`,
    [
      JSON.stringify(savedRoom.name),
      JSON.stringify(savedRoom.description),
      savedRoom.max_adults,
      savedRoom.max_children,
      savedRoom.base_occupancy,
      HOUSE,
    ],
  );
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'booking'`,
    [JSON.stringify(savedBooking)],
  );
  await page.context().close();
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

async function save() {
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

test("property details save, and the change is in the audit log", async () => {
  await page.goto("/admin/property");
  await page.getByLabel("Phone").fill("+30 2287 000000");
  await page.getByLabel("Check-in time").fill("16:30");
  await page
    .getByLabel("Instagram link")
    .fill("https://www.instagram.com/test_page/");
  await save();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  const { rows } = await db.query(`select * from public.property`);
  expect(rows[0].phone).toBe("+30 2287 000000");
  expect(rows[0].check_in_time).toBe("16:30:00");
  expect(rows[0].social_links.instagram).toBe(
    "https://www.instagram.com/test_page/",
  );
  // Links this screen does not edit stay as they were.
  expect(rows[0].social_links.facebook).toBe(
    (savedProperty.social_links as { facebook: string }).facebook,
  );

  const audit = await db.query(
    `select actor_id, before, after from public.audit_log
     where entity = 'property' order by id desc limit 1`,
  );
  expect(audit.rows[0].actor_id).toBe(owner.id);
  expect(audit.rows[0].before.phone).toBe(savedProperty.phone);
  expect(audit.rows[0].after.phone).toBe("+30 2287 000000");
});

test("property details refuse a bad link and keep what was typed", async () => {
  await page.goto("/admin/property");
  await page.getByLabel("Public name").fill("Typed name");
  await page.getByLabel("Facebook link").fill("javascript:alert(1)");
  await save();
  await expect(page.locator(".field-error")).toContainText("https://");
  await expect(page.getByLabel("Public name")).toHaveValue("Typed name");

  const { rows } = await db.query(`select name from public.property`);
  expect(rows[0].name).toBe(savedProperty.name);
});

test("the house saves text and capacity in both languages", async () => {
  await page.goto("/admin/house");
  await page.getByLabel("Name in Greek").fill("Το σπίτι");
  await page.getByLabel("Description in English").fill("A new description.");
  await page.getByLabel("Most adults").fill("5");
  await save();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  const { rows } = await db.query(
    `select name, description, max_adults, base_price_cents from public.rooms where id = $1`,
    [HOUSE],
  );
  expect(rows[0].name.el).toBe("Το σπίτι");
  expect(rows[0].description.en).toBe("A new description.");
  expect(rows[0].max_adults).toBe(5);
  expect(rows[0].base_price_cents).toBe(savedRoom.base_price_cents);
});

test("the house refuses more guests than it can hold", async () => {
  await page.goto("/admin/house");
  await page.getByLabel("Guests included in the price").fill("99");
  await save();
  await expect(page.locator(".field-error")).toBeVisible();
});

test("booking settings refuse a hold under 31 minutes", async () => {
  await page.goto("/admin/booking");
  await page.getByLabel("Minutes a guest has to finish paying").fill("30");
  await save();
  await expect(page.locator(".field-error")).toContainText("31");
  const before = await db.query(
    `select value from public.settings where key = 'booking'`,
  );
  expect(before.rows[0].value.holdMinutes).toBe(
    (savedBooking as { holdMinutes: number }).holdMinutes,
  );

  await page.getByLabel("Minutes a guest has to finish paying").fill("31");
  await page.getByLabel("How many months ahead guests can book").fill("12");
  await save();
  await expect(page.getByRole("status")).toHaveText("Saved.");

  const after = await db.query(
    `select value, is_public from public.settings where key = 'booking'`,
  );
  expect(after.rows[0].is_public).toBe(false);
  expect(after.rows[0].value).toEqual({
    ...(savedBooking as object),
    holdMinutes: 31,
    horizonMonths: 12,
    maxStayNights: 30,
  });
});
