import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { scrollThroughPage, skipCookieBanner } from "../e2e/helpers";
import {
  findLayoutProblems,
  findOverflow,
  freezeMotion,
} from "../e2e/layout-checks";

// The whole guest journey in a browser: calendar, details, a stand-in for
// Stripe's hosted page, the waiting page, the webhook and the private booking
// page. In both languages, at the four widths the site is built for.

const db = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
});
test.afterAll(() => db.end());

test.beforeEach(async () => {
  // Every test comes from one address, so the real limits would stop them.
  await db.query(
    `delete from public.admin_attempts where scope like 'pay\\_%'`,
  );
});

const widths = [320, 375, 768, 1280];
const copy = {
  en: {
    next: "Next month",
    continue: "Continue",
    name: "Full name",
    email: "Email",
    phone: "Phone, with country code",
    country: "Country",
    accept: /I accept the/,
    pay: "Continue to secure payment",
    waiting: "Payment received, confirming your booking",
    confirmed: "Your booking is confirmed",
    open: "View your booking",
    status: "Confirmed",
    notCompleted: "Payment not completed",
    cancel: "Cancel my booking",
    cancelYes: "Yes, cancel my booking",
    cancelled: "Your booking has been cancelled.",
  },
  el: {
    next: "Επόμενος μήνας",
    continue: "Συνέχεια",
    name: "Ονοματεπώνυμο",
    email: "Email",
    phone: "Τηλέφωνο, με κωδικό χώρας",
    country: "Χώρα",
    accept: /Αποδέχομαι τους/,
    pay: "Συνέχεια στην ασφαλή πληρωμή",
    waiting: "Η πληρωμή ελήφθη, επιβεβαιώνουμε την κράτησή σας",
    confirmed: "Η κράτησή σας επιβεβαιώθηκε",
    open: "Δείτε την κράτησή σας",
    status: "Επιβεβαιωμένη",
    notCompleted: "Η πληρωμή δεν ολοκληρώθηκε",
    cancel: "Ακύρωση της κράτησής μου",
    cancelYes: "Ναι, ακυρώστε την κράτησή μου",
    cancelled: "Η κράτησή σας ακυρώθηκε.",
  },
};

/** Months ahead, one per test, so the tests never share dates. */
let monthsAhead = 2;

async function openBook(page: Page, locale: "en" | "el", width: number) {
  await page.setViewportSize({ width, height: 800 });
  await skipCookieBanner(page);
  await page.goto(`/${locale}/book`);
  await expect(page.locator(".calendar")).toBeVisible();
}

async function chooseDates(page: Page, locale: "en" | "el") {
  const ahead = monthsAhead;
  monthsAhead += 1;
  for (let i = 0; i < ahead; i += 1) {
    await page.getByRole("button", { name: copy[locale].next }).click();
  }
  const days = page.locator(".calendar__month").first();
  await days.locator('[data-date$="-10"]').click();
  await days.locator('[data-date$="-14"]').click();
  await expect(page.getByTestId("price-total")).toBeVisible();
}

async function fillDetails(page: Page, locale: "en" | "el") {
  const t = copy[locale];
  await page.getByRole("button", { name: t.continue }).click();
  await page.getByLabel(t.name).fill("Pat Example");
  await page
    .getByLabel(t.email, { exact: true })
    .fill(`pay-e2e-${randomUUID()}@example.test`);
  await page.getByLabel(t.phone).fill("+30 690 000 0000");
  await page.getByLabel(t.country, { exact: true }).fill("Greece");
  await page.getByLabel(t.accept).check();
}

async function expectGoodLayout(page: Page) {
  await scrollThroughPage(page);
  await freezeMotion(page);
  expect(await findOverflow(page)).toEqual([]);
  expect(await findLayoutProblems(page)).toEqual([]);
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `${process.env.PAY_SHOTS ?? "test-results/pay-shots"}/${name}.png`,
    fullPage: true,
  });
}

for (const locale of ["en", "el"] as const) {
  for (const width of widths) {
    test(`books, pays and cancels: ${locale} at ${width}`, async ({ page }) => {
      const t = copy[locale];
      await openBook(page, locale, width);
      await expectGoodLayout(page);
      await chooseDates(page, locale);
      await expectGoodLayout(page);
      await shot(page, `${locale}-${width}-1-dates`);

      await fillDetails(page, locale);
      await expectGoodLayout(page);
      await shot(page, `${locale}-${width}-2-details`);

      await page.getByRole("button", { name: t.pay }).click();
      await expect(page.getByText("Fake Stripe hosted page")).toBeVisible();
      await page.getByRole("button", { name: "Pay" }).click();

      // Back from Stripe, and the webhook has not landed.
      await expect(page.getByText(t.waiting)).toBeVisible();
      await expect(page.getByText(t.confirmed)).toHaveCount(0);
      await expectGoodLayout(page);
      await shot(page, `${locale}-${width}-3-waiting`);

      await expect(page.getByText(t.confirmed)).toBeVisible({
        timeout: 20_000,
      });
      await page.getByRole("link", { name: t.open }).click();
      await expect(page.getByTestId("guest-status")).toHaveText(t.status);
      await expectGoodLayout(page);
      await shot(page, `${locale}-${width}-4-guest`);

      const robots = page.locator('meta[name="robots"]');
      await expect(robots).toHaveAttribute("content", /noindex/);

      await page.getByRole("button", { name: t.cancel }).click();
      await page.getByRole("button", { name: t.cancelYes }).click();
      await expect(page.getByText(t.cancelled)).toBeVisible();
    });
  }

  test(`going back from Stripe frees the dates: ${locale}`, async ({
    page,
  }) => {
    const t = copy[locale];
    await openBook(page, locale, 375);
    await chooseDates(page, locale);
    await fillDetails(page, locale);
    await page.getByRole("button", { name: t.pay }).click();
    await expect(page.getByText("Fake Stripe hosted page")).toBeVisible();
    await page.getByRole("link", { name: "Back to the site" }).click();

    await expect(
      page.getByRole("heading", { name: t.notCompleted }),
    ).toBeVisible();
    await expectGoodLayout(page);
    await shot(page, `${locale}-375-cancelled`);

    await page
      .getByRole("link")
      .filter({ hasText: /again|ξανά/ })
      .click();
    await expect(page.getByTestId("price-total")).toBeVisible();
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  });
}

test("stops saying confirming after a few minutes", async ({ page }) => {
  await page.clock.install();
  await page.route("**/api/checkout/status**", (route) =>
    route.fulfill({ json: { state: "confirming" } }),
  );
  await skipCookieBanner(page);
  await page.goto("/en/book/return?session_id=cs_test_stuck");
  await expect(page.getByText(copy.en.waiting)).toBeVisible();

  await page.clock.runFor(5_000);
  await page.clock.fastForward("06:00");
  await page.clock.runFor(16_000);
  await expect(
    page.getByRole("heading", { name: "We are still confirming your booking" }),
  ).toBeVisible();
  await expect(page.getByText(copy.en.waiting)).toHaveCount(0);
  await expect(page.getByText(/do not pay again/i)).toBeVisible();
  await expect(page.locator('main a[href^="mailto:"]')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await findOverflow(page)).toEqual([]);
});

test("the calendar works from the keyboard", async ({ page }) => {
  await openBook(page, "en", 1280);
  await page.getByRole("button", { name: "Next month" }).click();
  const first = page.locator('.calendar [tabindex="0"]');
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("ArrowRight");
  await page.keyboard.press(" ");
  await expect(page.getByTestId("price-total")).toBeVisible();
  await expect(page.locator(".stay-help")).toContainText("Arrival");
});

test("a taken night cannot be chosen, and says nothing about why", async ({
  page,
}) => {
  const { rows } = await db.query(
    `select to_char(current_date + 60, 'YYYY-MM-DD') as day`,
  );
  const day = rows[0].day as string;
  const room = process.env.PAY_TEST_ROOM_ID!;
  await db.query(
    `select public.create_block($1, $2::date, ($2::date + 1), 'owner_use', 'secret reason')`,
    [room, day],
  );
  try {
    await openBook(page, "en", 1280);
    for (let i = 0; i < 2; i += 1) {
      const cell = page.locator(`[data-date="${day}"]`);
      if (await cell.count()) break;
      await page.getByRole("button", { name: "Next month" }).click();
    }
    const cell = page.locator(`[data-date="${day}"]`);
    await expect(cell).toHaveAttribute("aria-disabled", "true");
    await expect(cell).toHaveAttribute("aria-label", /not available/);
    await expect(page.locator("body")).not.toContainText("secret reason");
  } finally {
    await db.query(
      `delete from public.availability_blocks where room_id = $1`,
      [room],
    );
  }
});

test("the home page search leads to the same flow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await skipCookieBanner(page);
  await page.goto("/en");
  const section = page.locator("#availability");
  await section.scrollIntoViewIfNeeded();
  await expect(section.locator(".calendar")).toBeVisible();
  await expectGoodLayout(page);
  await shot(page, "home-375");
  const ahead = monthsAhead;
  monthsAhead += 1;
  for (let i = 0; i < ahead; i += 1) {
    await section.getByRole("button", { name: "Next month" }).click();
  }
  await section.locator('[data-date$="-10"]').first().click();
  await section.locator('[data-date$="-13"]').first().click();
  await section.getByRole("link", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/en\/book\?checkIn=/);
  await expect(page.getByTestId("price-total")).toBeVisible();
});

test("an unknown guest link is the plain 404", async ({ page }) => {
  await skipCookieBanner(page);
  const response = await page.goto(`/en/booking/${"a".repeat(43)}`);
  expect(response?.status()).toBe(404);
  const short = await page.goto("/en/booking/nope");
  expect(short?.status()).toBe(404);
});

test("the guest page is private", async ({ request }) => {
  const response = await request.get(`/en/booking/${"a".repeat(43)}`);
  const headers = response.headers();
  expect(headers["cache-control"]).toContain("no-store");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-robots-tag"]).toContain("noindex");
});
