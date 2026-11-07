import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { findLayoutProblems, MIN_TAP } from "./admin-layout";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  enrolOwner,
  signInWithPassword,
  testAddress,
  type TestUser,
} from "./admin-helpers";
import {
  addBooking,
  addExternal,
  addMessage,
  addPayment,
  createFixtureRoom,
  HOUSE,
  removeFixtures,
} from "./admin-ops-fixtures";

// D25. The Playwright config asks for English, because the other specs match
// English words. This file clears that, so it sees what Yorgos sees.
test.use({ storageState: { cookies: [], origins: [] } });

const COOKIE = "admin_lang";

/** Common words of the English screens. Names and data are not checked. */
const ENGLISH =
  /\b(the|and|your|you|please|save|cancel|back|add|delete|change|search|filters?|booking|bookings|guests?|prices?|dates?|month|nights?|payments?|status|total|invoices?|receipt|draft|publish|sign in|sign out|settings|home|calendar|messages?|reports?|income|week|monday|sunday|january|november|jan|nov)\b/gi;

/** Text from people, not from Admin: guest names, messages, page content. */
const NOT_OURS = [
  ".row-main > span:not(.row-badges)",
  ".message-text",
  "input",
  "textarea",
  "code",
  ".eml-recipient",
  ".cms-section > summary",
  // The names of buttons on Airbnb and Booking.com.
  ".steps",
].join(",");

/** Each English word left, with the words around it, to find it quickly. */
async function englishLeft(page: Page): Promise<string[]> {
  const text = await page.evaluate((skip) => {
    const copy = document.body.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(`${skip},script,style`).forEach((el) => el.remove());
    return copy.textContent ?? "";
  }, NOT_OURS);
  const ours = text
    .replace(/Booking\.com|Airbnb και Booking/g, "")
    .replace(/\S+@\S+|https?:\/\/\S+/g, "")
    // Payments left by the invoice specs in the shared database.
    .replace(/Test Guest/g, "");
  return [...ours.matchAll(ENGLISH)].map((match) =>
    ours.slice(Math.max(match.index - 25, 0), match.index + 25),
  );
}

async function freshPhone(browser: Browser, width: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width, height: 700 },
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  return context.newPage();
}

type Session = Awaited<ReturnType<BrowserContext["storageState"]>>;

const sessions = new Map<string, Session>();

/** Signs in once, in English, because the helpers know the English words. */
async function ownerInGreek(
  browser: Browser,
  owner: TestUser,
  width = 1100,
): Promise<Page> {
  let session = sessions.get(owner.id);
  if (!session) {
    const first = await freshPhone(browser, width);
    await first
      .context()
      .addCookies([
        { name: COOKIE, value: "en", domain: "localhost", path: "/" },
      ]);
    await signInWithPassword(first, owner);
    await enrolOwner(first, owner);
    await first.context().clearCookies({ name: COOKIE });
    session = await first.context().storageState();
    sessions.set(owner.id, session);
    await first.context().close();
  }
  const context = await browser.newContext({
    viewport: { width, height: 700 },
    storageState: session,
  });
  return context.newPage();
}

test.describe("language of the admin", () => {
  let owner: TestUser;

  test.beforeAll(async () => {
    owner = await createTestUser("owner");
  });

  test.afterAll(async () => {
    await deleteCreatedUsers();
  });

  test("the signed-out screens start in Greek", async ({ browser }) => {
    const page = await freshPhone(browser, 375);
    await page.goto("/admin/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "el");
    await expect(page).toHaveTitle("Διαχείριση Casa Filakopi");
    await expect(page.getByRole("heading", { name: "Σύνδεση" })).toBeVisible();
    expect(await englishLeft(page)).toEqual([]);

    await page.getByRole("button", { name: "Σύνδεση" }).click();
    await expect(page.locator(".field-error").first()).toHaveText(
      "Γράψτε ένα σωστό email.",
    );

    await page.goto("/admin/forgot-password");
    await expect(page.locator("h1")).toHaveText("Ξεχάσατε τον κωδικό σας");
    expect(await englishLeft(page)).toEqual([]);

    await page.goto("/admin/auth/confirm");
    expect(await englishLeft(page)).toEqual([]);
    await page.context().close();
  });

  test("the switch works signed out, and stays", async ({ browser }) => {
    const page = await freshPhone(browser, 375);
    await page.goto("/admin/login");

    await page.getByRole("button", { name: "English" }).click();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const cookies = await page.context().cookies();
    const saved = cookies.find((cookie) => cookie.name === COOKIE);
    expect(saved).toMatchObject({ value: "en", sameSite: "Lax", path: "/" });
    expect(saved!.expires).toBeGreaterThan(Date.now() / 1000 + 86400 * 300);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

    await page.goto("/admin/forgot-password");
    await expect(page.locator("h1")).toHaveText("Forgot your password");

    await page.getByRole("button", { name: "Ελληνικά" }).click();
    await expect(page.locator("h1")).toHaveText("Ξεχάσατε τον κωδικό σας");
    await expect(page.locator("html")).toHaveAttribute("lang", "el");
    await page.context().close();
  });

  test("a made-up cookie gives Greek", async ({ browser }) => {
    const page = await freshPhone(browser, 375);
    await page
      .context()
      .addCookies([
        { name: COOKIE, value: "xx", domain: "localhost", path: "/" },
      ]);
    await page.goto("/admin/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "el");
    await page.context().close();
  });

  test("signed in, the switch changes everything at once", async ({
    browser,
  }) => {
    const page = await ownerInGreek(browser, owner, 375);
    await page.goto("/admin");
    await expect(page.locator("html")).toHaveAttribute("lang", "el");
    await expect(
      page.getByRole("link", { name: "Κρατήσεις", exact: true }),
    ).toBeVisible();

    // From the menu, on a phone.
    await page.getByRole("button", { name: "Μενού" }).click();
    await page.getByRole("button", { name: "English" }).click();
    await expect(
      page.getByRole("link", { name: "Bookings", exact: true }),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");

    await page.goto("/admin/calendar");
    await expect(page.locator("h1")).toHaveText("Calendar");

    // And back, from the account screen. Client and server agree.
    await page.goto("/admin/account");
    await page.getByRole("button", { name: "Ελληνικά" }).click();
    await expect(page.locator("h1")).toHaveText("Ο λογαριασμός μου");
    await expect(
      page.getByRole("link", { name: "Κρατήσεις", exact: true }),
    ).toBeVisible();
    await page.goto("/admin/calendar");
    await expect(page.locator("h1")).toHaveText("Ημερολόγιο");
    await expect(page.getByText("Δε", { exact: true })).toBeVisible();
    await page.context().close();
  });
});

test.describe("Greek screens", () => {
  let owner: TestUser;
  let staff: TestUser;
  let greekStay: string;
  let englishStay: string;
  let event: string;
  let message: string;
  const consoleErrors: string[] = [];

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    owner = await createTestUser("owner");
    staff = await createTestUser("staff");
    const room = await createFixtureRoom();
    greekStay = await addBooking({
      roomId: room.id,
      checkIn: "2042-03-10",
      checkOut: "2042-03-14",
      name: "Μαρία Παπαδάκη Κωνσταντοπούλου",
      email: "a.long.address.for.a.guest@example.test",
      notes: "Σημείωση",
      totalCents: 123456,
    });
    await addPayment(greekStay, 23400);
    await db.query(`update public.bookings set locale = 'el' where id = $1`, [
      greekStay,
    ]);
    englishStay = await addBooking({
      roomId: room.id,
      checkIn: "2042-04-10",
      checkOut: "2042-04-14",
      name: "Alex Example",
      email: "alex@example.test",
      totalCents: 90000,
    });
    event = await addExternal(room.airbnb, "2042-03-20", "2042-03-23");
    message = await addMessage({
      name: "Κάποιος",
      email: "someone@example.test",
      message: "Μια ερώτηση για το σπίτι.",
    });
    await db.query(
      `insert into public.seasons (room_id, name, start_date, end_date, nightly_cents)
       values ($1, 'Δοκιμή κινητού', '2042-11-01', '2042-11-30', 20000)`,
      [HOUSE],
    );
  });

  test.afterAll(async () => {
    await db.query(`delete from public.seasons where name = 'Δοκιμή κινητού'`);
    await removeFixtures();
    await deleteCreatedUsers();
  });

  const screens = (): [string, string][] => [
    ["home", "/admin"],
    ["bookings", "/admin/bookings"],
    ["bookings-past", "/admin/bookings?tab=past"],
    ["new-booking", "/admin/bookings/new"],
    ["booking", `/admin/bookings/${greekStay}`],
    ["change-dates", `/admin/bookings/${greekStay}/change`],
    ["cancel", `/admin/bookings/${greekStay}/cancel`],
    ["imported", `/admin/bookings/external/${event}`],
    ["calendar", "/admin/calendar?month=2042-03"],
    ["rates", "/admin/rates?month=2042-03"],
    ["seasons", "/admin/rates/seasons"],
    ["restrictions", "/admin/rates/restrictions"],
    ["fees", "/admin/rates/fees"],
    ["promos", "/admin/rates/promos"],
    ["guests", "/admin/guests"],
    ["messages", "/admin/messages"],
    ["message", `/admin/messages/${message}`],
    ["reports", "/admin/reports?year=2042&month=3"],
    ["reports-year", "/admin/reports?year=2042&month=all"],
    ["property", "/admin/property"],
    ["house", "/admin/house"],
    ["booking-settings", "/admin/booking"],
    ["rules", "/admin/rules"],
    ["account", "/admin/account"],
    ["invoices", "/admin/invoices"],
    ["invoices-issue", "/admin/invoices/issue"],
    ["invoices-export", "/admin/invoices/export"],
    ["invoices-settings", "/admin/invoices/settings"],
    ["integrations", "/admin/integrations"],
    ["email", "/admin/email"],
    ["email-settings", "/admin/email/settings"],
    ["email-templates", "/admin/email/templates"],
    ["email-template", "/admin/email/templates/booking_confirmation"],
    ["email-scheduled", "/admin/email/scheduled"],
    ["content", "/admin/content"],
    ["content-home", "/admin/content/home"],
    ["content-faq", "/admin/content/lists/faq"],
    ["photos", "/admin/photos"],
    ["photos-kitchen", "/admin/photos/section.kitchen"],
    ["photos-unused", "/admin/photos/unused"],
  ];

  async function check(page: Page, label: string) {
    await page.waitForLoadState("networkidle");
    // The editor's language tabs stay pinned on purpose while it scrolls.
    await page.evaluate(() => window.scrollTo(0, 0));
    const problems = await page.evaluate(findLayoutProblems, MIN_TAP);
    const width = page.viewportSize()!.width;
    await page.screenshot({
      path: test.info().outputPath(`${width}-${label}.png`),
      fullPage: true,
    });
    expect(problems, `${label} at ${width} px`).toEqual([]);
  }

  test("no English left on any screen", async ({ browser }) => {
    test.setTimeout(240_000);
    const page = await ownerInGreek(browser, owner);
    page.on("console", (entry) => {
      if (entry.type() === "error") consoleErrors.push(entry.text());
    });
    const found: Record<string, string[]> = {};
    for (const [label, path] of screens()) {
      const response = await page.goto(path);
      expect(response?.status(), path).toBe(200);
      await page.waitForLoadState("networkidle");
      const left = await englishLeft(page);
      if (left.length) found[label] = left;
    }
    expect(found).toEqual({});
    // A hydration mismatch would mean server and browser chose differently.
    expect(consoleErrors.filter((text) => /hydrat/i.test(text))).toEqual([]);
    await page.context().close();
  });

  test("money and dates are in Greek", async ({ browser }) => {
    const page = await ownerInGreek(browser, owner);
    await page.goto(`/admin/bookings/${greekStay}`);
    await expect(page.getByText("1.234,56 €").first()).toBeVisible();
    await expect(page.getByText(/Δευ 10 Μαρ 2042/).first()).toBeVisible();
    await page.goto(`/admin/bookings/external/${event}`);
    await expect(page.getByText(/20 Μαρ/).first()).toBeVisible();
    await page.goto("/admin/calendar?month=2042-03");
    await expect(page.getByText("Μάρτιος 2042").first()).toBeVisible();
    await page.goto("/admin/rates?month=2042-03");
    await expect(page.locator(".price-normal").first()).toContainText("€");
    await expect(page.locator(".price-normal").first()).not.toContainText(/^€/);
    await page.context().close();
  });

  test("a validation message from the server is in Greek", async ({
    browser,
  }) => {
    const page = await ownerInGreek(browser, owner);
    await page.goto("/admin/house");
    await page.locator('input[name="max_adults"]').fill("500");
    await page.getByRole("button", { name: "Αποθήκευση" }).click();
    await expect(page.locator(".field-error").first()).toHaveText(
      "Πρέπει να είναι ακέραιος αριθμός από 1 έως 30.",
    );
    await page.context().close();
  });

  test("an amount typed with a comma is saved", async ({ browser }) => {
    const page = await ownerInGreek(browser, owner);
    await page.goto(`/admin/bookings/external/${event}`);
    const box = page.getByLabel("Ποσό σε ευρώ");
    await box.fill("1250,50");
    await page.getByRole("button", { name: "Αποθήκευση στοιχείων" }).click();
    await expect(page.getByText("Τα στοιχεία αποθηκεύτηκαν.")).toBeVisible();
    await page.reload();
    await expect(box).toHaveValue("1250,50");
    await page.context().close();
  });

  test("the composer writes in the booking's language", async ({ browser }) => {
    const page = await ownerInGreek(browser, owner);
    await page.goto(`/admin/bookings/${greekStay}`);
    await page
      .getByLabel("Ξεκινήστε από")
      .selectOption({ label: "Πριν την άφιξη" });
    await expect(page.getByLabel("Θέμα")).toHaveValue(/Η άφιξή σας/);
    await expect(page.getByLabel("Μήνυμα", { exact: true })).toHaveValue(
      /Γεια σας Μαρία,[\s\S]*Τρί 14 Μαρ 2042|Γεια σας Μαρία,/,
    );

    await page.goto(`/admin/bookings/${englishStay}`);
    await page
      .getByLabel("Ξεκινήστε από")
      .selectOption({ label: "Πριν την άφιξη" });
    await expect(page.getByLabel("Θέμα")).toHaveValue(/Your arrival/);
    await expect(page.getByLabel("Μήνυμα", { exact: true })).toHaveValue(
      /Hello Alex,/,
    );
    await page.context().close();
  });

  test("a page that does not exist says so in Greek", async ({ browser }) => {
    const page = await ownerInGreek(browser, owner);
    const missing = "00000000-0000-4000-8000-00000000dead";
    const response = await page.goto(`/admin/bookings/${missing}`);
    expect(response?.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText("Η σελίδα δεν βρέθηκε");
    await page.context().close();
  });

  test("the guest rules preview is in Greek", async ({ browser }) => {
    const page = await ownerInGreek(browser, owner);
    await page.goto("/admin/rules");
    await expect(page.getByText(/Αν ακυρώσετε/).first()).toBeVisible();
    await expect(page.getByText(/Παράδειγμα: κράτηση 1\.000 €/)).toBeVisible();
    await page.context().close();
  });

  test("sticky bars sit above the phone navigation at 320 px", async ({
    browser,
  }) => {
    const page = await ownerInGreek(browser, owner, 320);
    const barTop = () =>
      page
        .locator(".tabbar-row")
        .evaluate((row) => row.getBoundingClientRect().top);

    await page.goto("/admin/invoices");
    await page.waitForLoadState("networkidle");
    await page
      .getByRole("button", { name: "Επιλογή αυτής της σελίδας" })
      .click();
    const selection = page.getByTestId("selection-bar");
    await expect(selection).toBeVisible();
    // It floats over the list by design, so only its own fit is checked here.
    expect(
      await selection.evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const tooWide = await selection.evaluate((el) =>
      [...el.querySelectorAll(".button")]
        .filter((button) => button.scrollWidth > button.clientWidth + 1)
        .map((button) => button.textContent),
    );
    expect(tooWide).toEqual([]);
    await page.screenshot({
      path: test.info().outputPath("320-invoice-bar.png"),
    });
    await page.evaluate(() => window.scrollTo(0, 400));
    const invoiceBar = await selection.boundingBox();
    expect(invoiceBar!.y + invoiceBar!.height).toBeLessThanOrEqual(
      await barTop(),
    );

    // Marked dirty by hand, so no draft is written to shared content.
    await page.goto("/admin/content/cms-test");
    await page.waitForLoadState("networkidle");
    const bar = page.locator(".cms-publish-bar");
    await bar.evaluate((el) => el.setAttribute("data-dirty", ""));
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(bar).toHaveCSS("position", "sticky");
    const publishBar = await bar.boundingBox();
    expect(publishBar!.y + publishBar!.height).toBeLessThanOrEqual(
      await barTop(),
    );
    await page.context().close();
  });

  for (const width of [320, 375]) {
    test(`every screen fits at ${width} px`, async ({ browser }) => {
      test.setTimeout(420_000);
      const page = await ownerInGreek(browser, owner, width);
      for (const [label, path] of screens()) {
        await page.goto(path);
        await check(page, label);
        if (width === 320) {
          const closed = page.locator("details:not([open]) > summary");
          while ((await closed.count()) > 0) await closed.first().click();
          await check(page, `${label}-open`);
        }
      }

      await page.goto("/admin");
      await page.getByRole("button", { name: "Μενού" }).click();
      await check(page, "menu");
      await page.context().close();
    });

    test(`signed-out and staff screens fit at ${width} px`, async ({
      browser,
    }) => {
      const page = await freshPhone(browser, width);
      for (const [label, path] of [
        ["login", "/admin/login"],
        ["forgot", "/admin/forgot-password"],
        ["confirm", "/admin/auth/confirm"],
      ]) {
        await page.goto(path);
        await check(page, label);
      }
      await page.goto("/admin/login");
      await page.getByRole("button", { name: "Σύνδεση" }).click();
      await page.locator(".field-error").first().waitFor();
      await check(page, "login-error");
      await page.context().close();

      const helper = await freshPhone(browser, width);
      await helper
        .context()
        .addCookies([
          { name: COOKIE, value: "en", domain: "localhost", path: "/" },
        ]);
      await signInWithPassword(helper, staff);
      await expect(helper).toHaveURL(/\/admin$/);
      await helper.context().clearCookies({ name: COOKIE });
      await helper.goto("/admin/rules");
      await expect(helper).toHaveURL(/\/admin\/not-allowed$/);
      await expect(helper.locator("h1")).toHaveText(
        "Η σελίδα αυτή είναι για τον ιδιοκτήτη",
      );
      await check(helper, "not-allowed");
      await helper.goto("/admin/account/two-step");
      await check(helper, "two-step");
      await helper.context().close();
    });
  }
});
