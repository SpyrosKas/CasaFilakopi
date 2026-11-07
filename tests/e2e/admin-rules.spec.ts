import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  releaseSharedSettings,
  newOwnerPage,
  signInOwner,
  signInWithPassword,
  type TestUser,
} from "./admin-helpers";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 } });

const notice = '.notice[role="alert"]';

let owner: TestUser;
let staff: TestUser;
let roomId: string;
let bookingId: string;
let savedPayment: unknown;
let savedPolicy: { id: string; tiers: unknown; is_non_refundable: boolean };

const bookingSnapshot = {
  payment: {
    mode: "full",
    deposit: null,
    balanceDaysBefore: 3,
  },
  cancellation: {
    isNonRefundable: false,
    tiers: [
      { daysBefore: 60, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  },
  capturedAt: "2026-11-01T10:00:00.000Z",
};

async function readRules() {
  const payment = await db.query(
    `select value from public.settings where key = 'payment'`,
  );
  const policy = await db.query(
    `select tiers, is_non_refundable from public.cancellation_policies where is_default`,
  );
  return { payment: payment.rows[0].value, policy: policy.rows[0] };
}

async function readSnapshot() {
  const { rows } = await db.query(
    `select rules_snapshot from public.bookings where id = $1`,
    [bookingId],
  );
  return rows[0].rules_snapshot;
}

test.beforeAll(async () => {
  await lockSharedSettings();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");

  const payment = await db.query(
    `select value from public.settings where key = 'payment'`,
  );
  savedPayment = payment.rows[0].value;
  // The tests read a deposit rule, which the seed no longer has by default.
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'payment'`,
    [
      JSON.stringify({
        mode: "deposit",
        deposit: { kind: "percent", percent: 30 },
        balanceDaysBefore: 14,
      }),
    ],
  );
  const policy = await db.query(
    `select id, tiers, is_non_refundable from public.cancellation_policies where is_default`,
  );
  savedPolicy = policy.rows[0];

  roomId = randomUUID();
  await db.query(
    `insert into public.rooms (id, slug, name, max_adults, base_occupancy, base_price_cents, created_at)
     values ($1, $2, '{"en":"Rules test"}', 4, 2, 10000, now() + interval '1 year')`,
    [roomId, `rules-test-${roomId}`],
  );
  const { rows } = await db.query(
    `select public.create_hold(
       $1, '2031-07-01'::date, '2031-07-05'::date, 2, 0,
       $2::jsonb, '{"nights":[]}'::jsonb, 10000, 10000, $3::jsonb,
       'v1', 'rules-test-token', '2099-01-01T00:00:00Z'::timestamptz
     ) as result`,
    [
      roomId,
      JSON.stringify({
        email: `${randomUUID()}@example.test`,
        name: "Test Guest",
        locale: "en",
        marketing_consent: false,
      }),
      JSON.stringify(bookingSnapshot),
    ],
  );
  const result = rows[0].result;
  bookingId = result.booking_id ?? result.bookingId ?? result.id;
  expect(bookingId).toBeTruthy();
});

test.afterAll(async () => {
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'payment'`,
    [JSON.stringify(savedPayment)],
  );
  await db.query(
    `update public.cancellation_policies set tiers = $1::jsonb, is_non_refundable = $2 where id = $3`,
    [
      JSON.stringify(savedPolicy.tiers),
      savedPolicy.is_non_refundable,
      savedPolicy.id,
    ],
  );
  await db.query(`delete from public.holds where booking_id = $1`, [bookingId]);
  await db.query(`delete from public.inventory_claims where room_id = $1`, [
    roomId,
  ]);
  await db.query(`delete from public.bookings where id = $1`, [bookingId]);
  await db.query(`delete from public.rooms where id = $1`, [roomId]);
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

test("the screen shows the stored rules and says they apply to new bookings", async ({
  browser,
}) => {
  const page = await newOwnerPage(browser, owner, {
    width: 375,
    height: 812,
  });
  await page.goto("/admin/rules");
  await expect(
    page.getByText("Changes apply to new bookings only."),
  ).toBeVisible();
  await expect(
    page.getByText("You pay 30% of the booking price when you book."),
  ).toBeVisible();
  await page.context().close();
});

test("saving rules changes the settings but never an existing booking", async ({
  page,
}) => {
  const snapshotBefore = await readSnapshot();
  expect(snapshotBefore).toEqual(bookingSnapshot);

  await signInOwner(page, owner);
  await page.goto("/admin/rules");

  // Only a percentage and a number of days: no fixed amount any more.
  await expect(page.getByText("fixed amount")).toHaveCount(0);
  await expect(
    page.getByText("0 means the guest pays the rest on arrival."),
  ).toBeVisible();

  // A comma is what a Greek phone keyboard types.
  await page.getByLabel(/^Deposit, as a percentage/).fill("25,5");
  await page.getByLabel("Days before arrival the rest is due").fill("10");

  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("7");
  await page
    .getByLabel(/^Percent of the booking price/)
    .last()
    .fill("50");

  // The preview follows what is typed, before anything is saved.
  const preview = page.locator(".preview");
  await expect(preview).toContainText(
    "You pay 25.5% of the booking price when you book.",
  );
  await expect(preview).toContainText(
    "You pay the rest 10 days before you arrive.",
  );
  await expect(preview).toContainText(
    "If you cancel 7 to 29 days before you arrive, we refund 50% of the booking price.",
  );
  await expect(preview).toContainText("Example: a booking of \u20ac1,000");
  await expect(preview).toContainText(
    "7 to 29 days before you arrive: you get \u20ac500 back and we keep \u20ac500.",
  );
  await expect(preview).toContainText(
    "If you have paid only the deposit (\u20ac255)",
  );
  await expect(preview).toContainText(
    "7 to 29 days before you arrive: we keep the \u20ac255 and you still owe \u20ac245.",
  );

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Existing bookings have not changed.",
  );

  const stored = await readRules();
  expect(stored.payment).toEqual({
    mode: "deposit",
    deposit: { kind: "percent", percent: 25.5 },
    balanceDaysBefore: 10,
  });
  expect(stored.policy).toEqual({
    is_non_refundable: false,
    tiers: [
      { daysBefore: 30, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  });

  // T3.20b: the existing booking still has the rules it was made with.
  expect(await readSnapshot()).toEqual(snapshotBefore);

  // The audit log names the Owner, and the page shows the rules after a reload.
  const audit = await db.query(
    `select actor_id from public.audit_log
     where entity = 'settings' and entity_id = 'payment'
     order by id desc limit 1`,
  );
  expect(audit.rows[0].actor_id).toBe(owner.id);

  await page.reload();
  await expect(page.locator(".preview")).toContainText("25.5%");
});

test("switching to full payment and no refunds saves the contract shape", async ({
  page,
}) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  await page.getByRole("radio", { name: /^Full payment/ }).check();
  await expect(page.getByLabel(/^Deposit, as a percentage/)).toHaveCount(0);
  await expect(
    page.getByLabel("Days before arrival the rest is due"),
  ).toHaveCount(0);
  await page.getByLabel("No refunds, ever").check();
  await expect(page.locator(".preview")).toContainText(
    "If you cancel any time before you arrive, we refund nothing.",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Saved.");

  const stored = await readRules();
  expect(stored.payment).toEqual({
    mode: "full",
    deposit: null,
    balanceDaysBefore: 10,
  });
  expect(stored.policy).toEqual({ is_non_refundable: true, tiers: [] });
  expect(await readSnapshot()).toEqual(bookingSnapshot);
});

test("Deposit with no percentage is refused, as it would stop checkout", async ({
  page,
}) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  const before = await readRules();
  expect(before.payment.mode).toBe("full");

  await page.getByRole("radio", { name: /^Deposit/ }).check();
  await expect(page.getByLabel(/^Deposit, as a percentage/)).toHaveValue("");
  await expect(page.locator(".preview")).toContainText(
    "Please type the deposit percentage.",
  );

  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await expect(page.locator(notice)).toContainText("Please fix");
  await expect(page.locator("fieldset .field-error")).toContainText(
    "Please type the deposit percentage.",
  );
  expect(await readRules()).toEqual(before);

  for (const percent of ["0", "0.5", "100", "120", "12.345"]) {
    await page.getByLabel(/^Deposit, as a percentage/).fill(percent);
    await save.click();
    await expect(page.locator("fieldset .field-error")).toContainText(
      "at least 1%",
    );
    expect(await readRules()).toEqual(before);
  }
});

test("days past the limits get a plain message", async ({ page }) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  const before = await readRules();
  const save = page.getByRole("button", { name: "Save", exact: true });

  await page.getByRole("radio", { name: /^Deposit/ }).check();
  await page.getByLabel(/^Deposit, as a percentage/).fill("30");
  await page.getByLabel("Days before arrival the rest is due").fill("366");
  await save.click();
  await expect(page.locator("fieldset .field-error")).toContainText(
    "from 0 to 365",
  );
  expect(await readRules()).toEqual(before);

  await page.getByLabel("Days before arrival the rest is due").fill("10");
  await page.getByLabel("No refunds, ever").uncheck();
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("3651");
  await page
    .getByLabel(/^Percent of the booking price/)
    .last()
    .fill("0");
  await save.click();
  await expect(page.locator("fieldset .field-error")).toContainText(
    "from 0 to 3650",
  );
  expect(await readRules()).toEqual(before);
});

test("rules that make no sense are refused and nothing is saved", async ({
  page,
}) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  await page.getByLabel("No refunds, ever").uncheck();
  const before = await readRules();

  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("30");
  await page
    .getByLabel(/^Percent of the booking price/)
    .last()
    .fill("20");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("0");
  await page
    .getByLabel(/^Percent of the booking price/)
    .last()
    .fill("90");

  // The preview warns first, and the server refuses it anyway.
  await expect(page.locator(".preview")).toContainText("closer to arrival");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(notice)).toContainText("Please fix");
  await expect(page.locator("fieldset .field-error")).toContainText(
    "closer to arrival",
  );
  expect(await readRules()).toEqual(before);

  // Two lines for the same day.
  await page.getByLabel("Days before arrival, or more").last().fill("30");
  await page
    .getByLabel(/^Percent of the booking price/)
    .last()
    .fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator("fieldset .field-error")).toContainText(
    "same number of days",
  );
  expect(await readRules()).toEqual(before);
});

test("Staff holding an owner page cannot save through it", async ({
  page,
  browser,
}) => {
  await signInOwner(page, owner);
  const before = await readRules();

  for (const [path, button] of [
    ["/admin/rules", "Save"],
    ["/admin/property", "Save"],
    ["/admin/house", "Save"],
    ["/admin/booking", "Save"],
  ]) {
    await page.goto(path);

    // Swap in a Staff session behind the open form, as a replay would.
    const staffContext = await browser.newContext();
    const staffPage = await staffContext.newPage();
    await signInWithPassword(staffPage, staff);
    await expect(staffPage).toHaveURL(/\/admin$/);
    const staffCookies = await staffContext.cookies();
    await staffContext.close();
    const ownerCookies = await page.context().cookies();
    await page.context().clearCookies();
    await page.context().addCookies(staffCookies);

    const audit = await db.query(
      `select count(*)::int as n from public.audit_log where actor_id = $1`,
      [staff.id],
    );
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/not-allowed$/);

    const after = await db.query(
      `select count(*)::int as n from public.audit_log where actor_id = $1`,
      [staff.id],
    );
    expect(after.rows[0].n).toBe(audit.rows[0].n);

    await page.context().clearCookies();
    await page.context().addCookies(ownerCookies);
  }
  expect(await readRules()).toEqual(before);
});
