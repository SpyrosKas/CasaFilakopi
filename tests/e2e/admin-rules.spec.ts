import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteTestUser,
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
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");

  const payment = await db.query(
    `select value from public.settings where key = 'payment'`,
  );
  savedPayment = payment.rows[0].value;
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
  await deleteTestUser(owner);
  await deleteTestUser(staff);
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
    page.getByText("You pay 30% of the price when you book."),
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

  await page.getByLabel("A fixed amount").check();
  await page.getByLabel("Deposit in euros").fill("150.50");
  await page.getByLabel("Days before arrival the rest is due").fill("10");

  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("7");
  await page.getByLabel("Percent refunded").last().fill("50");

  // The preview follows what is typed, before anything is saved.
  const preview = page.locator(".preview");
  await expect(preview).toContainText("You pay €150.50 when you book.");
  await expect(preview).toContainText(
    "The rest is due 10 days before you arrive.",
  );
  await expect(preview).toContainText(
    "If you cancel 7 to 29 days before you arrive, you get 50% of your money back.",
  );

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Existing bookings have not changed.",
  );

  const stored = await readRules();
  expect(stored.payment).toEqual({
    mode: "deposit",
    deposit: { kind: "fixed", amountCents: 15050 },
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
  await expect(page.locator(".preview")).toContainText("€150.50");
});

test("switching to full payment and no refunds saves the contract shape", async ({
  page,
}) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  await page.getByLabel("Full price when they book").check();
  await page.getByLabel("No refunds, ever").check();
  await expect(page.locator(".preview")).toContainText(
    "If you cancel, you get no refund.",
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

test("rules that make no sense are refused and nothing is saved", async ({
  page,
}) => {
  await signInOwner(page, owner);
  await page.goto("/admin/rules");
  await page.getByLabel("No refunds, ever").uncheck();
  const before = await readRules();

  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("30");
  await page.getByLabel("Percent refunded").last().fill("20");
  await page.getByRole("button", { name: "Add a line" }).click();
  await page.getByLabel("Days before arrival, or more").last().fill("0");
  await page.getByLabel("Percent refunded").last().fill("90");

  // The preview warns first, and the server refuses it anyway.
  await expect(page.locator(".preview")).toContainText("closer to arrival");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(notice)).toContainText("Please fix");
  await expect(page.locator("fieldset .field-error")).toContainText(
    "closer to arrival",
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
