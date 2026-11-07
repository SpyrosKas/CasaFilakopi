import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  newOwnerPage,
  releaseSharedSettings,
} from "./admin-helpers";
import { findOverflow } from "./layout-checks";

test.describe.configure({ mode: "serial" });

const TEMPLATE = "thank_you";
const marker = `e2e-${randomUUID()}`;
let page: Page;

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  const owner = await createTestUser("owner");
  page = await newOwnerPage(browser, owner, { width: 375, height: 812 });
});

test.afterAll(async () => {
  await db.query(`delete from public.settings where key = 'email'`);
  await db.query(
    `delete from public.settings where key = 'scheduled_messages'`,
  );
  await db.query(`delete from public.email_templates where key = $1`, [
    TEMPLATE,
  ]);
  await db.query(`delete from public.email_logs where recipient = $1`, [
    `${marker}@example.test`,
  ]);
  await page?.context().close();
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

test("the log shows a failed email, and it can be tried again", async () => {
  const { rows } = await db.query(
    `insert into public.email_logs (template_key, recipient, status, attempts, last_error)
     values ('thank_you', $1, 'failed', 6, 'provider down') returning id`,
    [`${marker}@example.test`],
  );

  await page.goto("/admin/email?status=failed");
  await expect(page.getByText("could not be sent")).toBeVisible();
  const item = page.locator(".eml-item", {
    hasText: `${marker}@example.test`,
  });
  await expect(item).toContainText("provider down");
  expect(await findOverflow(page)).toEqual([]);

  await item.getByRole("button", { name: "Try again" }).click();
  await expect
    .poll(async () => {
      const result = await db.query(
        `select status, attempts from public.email_logs where id = $1`,
        [rows[0].id],
      );
      return result.rows[0];
    })
    .toEqual({ status: "queued", attempts: 0 });
});

test("settings save, and a bad address is refused", async () => {
  await page.goto("/admin/email/settings");
  await expect(page.getByLabel("Sender name")).toHaveValue("Casa Filakopi");
  expect(await findOverflow(page)).toEqual([]);

  const recipients = page.getByLabel("Your notifications go to");
  await recipients.fill("not an address");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert")).toBeVisible();

  await recipients.fill("host@example.test\nsecond@example.test");
  await page.getByLabel("Before-arrival email, days before arrival").fill("5");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  const { rows } = await db.query(
    `select value from public.settings where key = 'email'`,
  );
  expect(rows[0].value).toMatchObject({
    hostRecipients: ["host@example.test", "second@example.test"],
    preArrivalDays: 5,
    invoiceEmailEnabled: false,
  });
});

test("an unknown placeholder is refused, and a good text saves", async () => {
  await page.goto(`/admin/email/templates/${TEMPLATE}?lang=en`);
  expect(await findOverflow(page)).toEqual([]);

  const body = page.getByLabel("Text", { exact: true });
  await body.fill("Hello {{gustName}}");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("alert").first()).toContainText("{{gustName}}");
  const none = await db.query(
    `select 1 from public.email_templates where key = $1`,
    [TEMPLATE],
  );
  expect(none.rows).toEqual([]);

  await body.fill("Hello {{guestName}}, come back <soon>.");
  await page.getByRole("button", { name: "Preview" }).click();
  const frame = page.frameLocator(".eml-preview-frame");
  await expect(frame.locator("body")).toContainText(
    "Hello Alex Example, come back <soon>.",
  );

  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  const saved = await db.query(
    `select body from public.email_templates where key = $1 and locale = 'en'`,
    [TEMPLATE],
  );
  expect(saved.rows[0].body).toContain("come back");

  await page.reload();
  await page
    .getByRole("button", { name: "Go back to the built-in text" })
    .click();
  await expect(page.getByRole("status")).toContainText("built-in");
  const gone = await db.query(
    `select 1 from public.email_templates where key = $1`,
    [TEMPLATE],
  );
  expect(gone.rows).toEqual([]);
});

test("the list has every email, and the preview works on a phone", async () => {
  await page.goto("/admin/email/templates");
  await expect(page.getByText("Booking confirmation")).toBeVisible();
  await expect(page.getByText("Host: calendar conflict")).toBeVisible();
  expect(await findOverflow(page)).toEqual([]);

  await page.goto("/admin/email/templates/host_new_booking?lang=el");
  await expect(
    page.frameLocator(".eml-preview-frame").locator("body"),
  ).toContainText("Επιβεβαιώθηκε νέα κράτηση");
  expect(await findOverflow(page)).toEqual([]);
});

test("a rule saves with both languages and refuses bad text", async () => {
  await page.goto("/admin/email/scheduled");
  expect(await findOverflow(page)).toEqual([]);

  await page.getByText("Add a rule").click();
  const form = page.locator("details[open]");
  await form.getByLabel("Name, for you").fill("Week before");
  await form.getByLabel("How many days").fill("7");
  await form.getByLabel("Subject, Greek").fill("Σε μία εβδομάδα");
  await form.getByLabel("Text, Greek").fill("Γεια {{nope}}");
  await form.getByLabel("Subject, English").fill("In a week");
  await form.getByLabel("Text, English").fill("Hi {{guestName}}");
  await form.getByRole("button", { name: "Save the rule" }).click();
  await expect(form.getByRole("alert")).toContainText("Check the text");

  await form.getByLabel("Text, Greek").fill("Γεια {{guestName}}");
  await form.getByRole("button", { name: "Save the rule" }).click();
  await expect(
    page.getByText("Week before: 7 days before arrival"),
  ).toBeVisible();

  const { rows } = await db.query(
    `select value from public.settings where key = 'scheduled_messages'`,
  );
  expect(rows[0].value[0]).toMatchObject({
    enabled: true,
    anchor: "check_in",
    offsetDays: -7,
  });
});

test("a one-off refuses an unknown booking", async () => {
  await page.goto("/admin/email/scheduled");
  await page.getByLabel("Booking reference").fill("NO-SUCH-REF");
  await page.getByLabel("Subject", { exact: true }).fill("Hello");
  await page.getByLabel("Text", { exact: true }).fill("Hello there");
  await page.getByRole("button", { name: "Schedule it" }).click();
  await expect(page.getByText("No booking has that reference.")).toBeVisible();
});
