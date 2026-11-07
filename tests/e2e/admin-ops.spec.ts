import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { i18nFor } from "@/lib/admin/i18n";
import { addDays, athensDate } from "@/lib/domain/dates";
import { readWorkbook, rowStarting } from "../read-xlsx";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  newOwnerPage,
  releaseSharedSettings,
  signInWithPassword,
  testAddress,
  type TestUser,
} from "./admin-helpers";
import {
  addBooking,
  addExternal,
  addMessage,
  addPayment,
  addReportYear,
  createFixtureRoom,
  FULL_REFUND_RULES,
  HOUSE,
  removeFixtures,
  trackBooking,
  type FixtureRoom,
} from "./admin-ops-fixtures";

const { formatDate, formatStay } = i18nFor("en");

// The operations screens, end to end, on a real database. Stays on the house
// use 2043, which no other spec touches.

test.describe.configure({ mode: "serial" });

let owner: TestUser;
let staff: TestUser;
let page: Page;
let staffPage: Page;
let room: FixtureRoom;
let savedBooking: unknown;
let savedPolicy: { tiers: unknown; is_non_refundable: boolean };

const today = athensDate(new Date());

async function staffSession(browser: Browser, user: TestUser) {
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    viewport: { width: 375, height: 812 },
  });
  const signedIn = await context.newPage();
  await signInWithPassword(signedIn, user);
  await expect(signedIn).toHaveURL(/\/admin$/);
  return signedIn;
}

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");
  page = await newOwnerPage(browser, owner, { width: 1280, height: 900 });
  page.on("dialog", (dialog) => dialog.accept());
  staffPage = await staffSession(browser, staff);
  staffPage.on("dialog", (dialog) => dialog.accept());
  room = await createFixtureRoom();

  savedBooking = (
    await db.query(`select value from public.settings where key = 'booking'`)
  ).rows[0].value;
  savedPolicy = (
    await db.query(
      `select tiers, is_non_refundable from public.cancellation_policies where is_default`,
    )
  ).rows[0];
});

test.afterAll(async () => {
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'booking'`,
    [JSON.stringify(savedBooking)],
  );
  await db.query(
    `update public.cancellation_policies set tiers = $1::jsonb, is_non_refundable = $2 where is_default`,
    [JSON.stringify(savedPolicy.tiers), savedPolicy.is_non_refundable],
  );
  await removeFixtures();
  await db.query(
    `delete from public.availability_blocks where room_id = $1 and start_date >= '2043-01-01'`,
    [HOUSE],
  );
  await db.query(
    `delete from public.rate_overrides where room_id = $1 and night >= '2043-01-01'`,
    [HOUSE],
  );
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

test.describe("a page that is slow to load", () => {
  let id: string;

  /** Holds back the page's scripts, as a poor phone signal does. */
  const slowScripts = (target: Page) =>
    target.route("**/_next/static/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });

  test.beforeAll(async () => {
    id = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 150),
      checkOut: addDays(today, 152),
      notes: "The old note",
    });
  });

  test.afterEach(async () => {
    // A held-back script may still be waiting, so its route is left to lapse.
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });

  test("keeps what was typed and never loses a save", async () => {
    await slowScripts(page);
    const refused: number[] = [];
    const watch = (response: { status(): number }) => {
      if (response.status() >= 500) refused.push(response.status());
    };
    page.on("response", watch);

    await page.goto(`/admin/bookings/${id}`, { waitUntil: "commit" });
    await page
      .getByRole("textbox", { name: "Your private notes" })
      .fill("Typed on a slow phone");
    await page.getByRole("button", { name: "Save notes" }).click();
    await expect(page.getByText("Notes saved.")).toBeVisible({
      timeout: 30_000,
    });
    const { rows } = await db.query(
      `select internal_notes from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0].internal_notes).toBe("Typed on a slow phone");

    await page.goto("/admin/rates?month=2043-02", { waitUntil: "commit" });
    await page.getByLabel("From", { exact: true }).fill("2043-02-01");
    await page.getByLabel("Until, and including").fill("2043-02-03");
    await page.getByLabel(/^Price per night/).fill("321");
    await page.getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByText("Saved for 3 nights.")).toBeVisible({
      timeout: 30_000,
    });
    const saved = await db.query(
      `select count(*)::int as n from public.rate_overrides
       where room_id = $1 and night between '2043-02-01' and '2043-02-03'`,
      [HOUSE],
    );
    expect(saved.rows[0].n).toBe(3);

    page.off("response", watch);
    expect(refused).toEqual([]);
  });
});

test.describe("settings in plain words", () => {
  test("same-day bookings is a time, stored as the same hour", async () => {
    await page.goto("/admin/booking");
    const cutoff = page.getByLabel(/^Same-day bookings/);
    await expect(page.getByText("Use 0 to 24")).toHaveCount(0);

    await cutoff.selectOption({ label: "18:00" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    const stored = async () =>
      (
        await db.query(
          `select value from public.settings where key = 'booking'`,
        )
      ).rows[0].value.sameDayCutoffHour;
    expect(await stored()).toBe(18);

    await page.reload();
    await expect(cutoff).toHaveValue("18");
    await cutoff.selectOption({ label: "No limit, any time of day" });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved.");
    expect(await stored()).toBe(24);
  });
});

test.describe("home", () => {
  let arriving: string;

  test.beforeAll(async () => {
    arriving = await addBooking({
      roomId: room.id,
      checkIn: today,
      checkOut: addDays(today, 3),
      name: "Arriving Today",
      totalCents: 40000,
    });
    await addBooking({
      roomId: room.id,
      status: "checked_in",
      checkIn: addDays(today, -4),
      checkOut: today,
      name: "Leaving Today",
    });
    await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 10),
      checkOut: addDays(today, 12),
      name: "Coming Soon",
    });
    await addMessage({
      name: "Unread Person",
      email: "unread@example.test",
      message: "Is June free?",
    });
  });

  test("answers what needs doing today", async () => {
    await page.goto("/admin");
    const panel = (name: string) =>
      page
        .locator(".panel")
        .filter({ has: page.getByRole("heading", { name }) });
    await expect(panel("Arriving today")).toContainText("Arriving Today");
    await expect(panel("Leaving today")).toContainText("Leaving Today");
    await expect(panel("In the house now")).toContainText("Leaving Today");
    await expect(panel("Next arrivals")).toContainText("Coming Soon");
    // Home lists the oldest five, and this database is shared, so the figure
    // is checked on the guest's own row.
    await expect(
      page.getByRole("heading", { name: "Guests who still owe money" }),
    ).toBeVisible();
    await expect(page.getByText("Income this month")).toBeVisible();
    await expect(page.getByText("Unread messages")).toBeVisible();

    await page.goto("/admin/bookings?q=Arriving+Today");
    await expect(page.getByTestId("stay-list")).toContainText("€400.00 due");
  });

  test("shows a sync alert for imported dates that clash", async () => {
    await addExternal(room.airbnb, addDays(today, 40), addDays(today, 44));
    await db.query(
      `update public.inventory_claims c set is_conflicted = true
       from public.external_events e
       where c.external_event_id = e.id and e.calendar_id = $1`,
      [room.airbnb],
    );
    await page.goto("/admin");
    await expect(page.getByText("Calendar sync needs a look")).toBeVisible();
    // Soonest first, so a clash next month is not lost among later ones.
    await expect(page.locator("section.notice-bad")).toContainText(
      formatStay(addDays(today, 40), addDays(today, 44)),
    );
    await db.query(
      `delete from public.external_events where calendar_id = $1`,
      [room.airbnb],
    );
  });

  test("shows money to give back and money on a broken booking", async () => {
    const cancelled = await addBooking({
      roomId: room.id,
      status: "cancelled",
      checkIn: addDays(today, 35),
      checkOut: addDays(today, 37),
      name: "Owed Back",
      totalCents: 60000,
      cancelledAt: new Date().toISOString(),
    });
    await addPayment(cancelled, 60000, { method: "card" });
    const expired = await addBooking({
      roomId: room.id,
      status: "expired",
      checkIn: addDays(today, 38),
      checkOut: addDays(today, 40),
      name: "Paid Too Late",
      totalCents: 25000,
    });
    await addPayment(expired, 25000, { method: "card" });

    await page.goto("/admin");
    await expect(page.getByTestId("give-back")).toContainText("Owed Back");
    await expect(page.getByTestId("give-back")).toContainText("€600.00");
    await expect(page.getByTestId("money-held")).toContainText("Paid Too Late");

    const file = await page.request.get("/admin/bookings/export");
    const book = await readWorkbook(await file.body());
    const names: unknown[] = [];
    book.worksheets[0].eachRow((row) => names.push(row.getCell(4).value));
    expect(names).toContain("Paid Too Late");

    await page.goto(`/admin/bookings/${expired}`);
    await expect(page.getByText(/Money is held on this booking/)).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "What to do next" }),
    ).toHaveCount(0);
  });

  test("the menu marks one page only", async () => {
    await page.goto("/admin/bookings");
    await expect(page.locator('.tabbar [aria-current="page"]')).toHaveText(
      "Bookings",
    );
  });

  test("Staff see the day but no income", async () => {
    await staffPage.goto("/admin");
    await expect(staffPage.getByText("Arriving Today")).not.toHaveCount(0);
    await expect(staffPage.getByText("Income this month")).toHaveCount(0);
  });

  test("the guest name is shown as text, not run", async () => {
    await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 20),
      checkOut: addDays(today, 22),
      name: `<img src=x onerror="document.title='hacked'">`,
    });
    await page.goto("/admin/bookings");
    await expect(page.getByText("<img src=x")).toBeVisible();
    await expect(page).not.toHaveTitle("hacked");
    expect(arriving).toBeTruthy();
  });
});

test.describe("bookings list", () => {
  let imported: string;

  test.beforeAll(async () => {
    await addBooking({
      roomId: room.id,
      status: "completed",
      checkIn: addDays(today, -40),
      checkOut: addDays(today, -35),
      name: "Long Gone",
    });
    await addBooking({
      roomId: room.id,
      status: "cancelled",
      checkIn: addDays(today, 50),
      checkOut: addDays(today, 52),
      name: "Changed Mind",
    });
    await addBooking({
      roomId: room.id,
      status: "expired",
      checkIn: addDays(today, 60),
      checkOut: addDays(today, 62),
      name: "Never Paid",
    });
    imported = await addExternal(
      room.bookingCom,
      addDays(today, 70),
      addDays(today, 73),
    );
  });

  test("sorts stays into the four tabs", async () => {
    const list = page.getByTestId("stay-list");
    await page.goto("/admin/bookings");
    await expect(list).toContainText("Coming Soon");
    await expect(list).not.toContainText("Never Paid");

    await page.goto("/admin/bookings?tab=past");
    await expect(list).toContainText("Long Gone");
    await page.goto("/admin/bookings?tab=cancelled");
    await expect(list).toContainText("Changed Mind");
    await page.goto("/admin/bookings?tab=staying");
    await expect(list).toContainText("Leaving Today");
  });

  test("marks Airbnb and Booking.com stays as dates only", async () => {
    await page.goto("/admin/bookings?source=booking_com");
    const list = page.getByTestId("stay-list");
    await expect(list).toContainText("Booking.com");
    await expect(list).toContainText("Dates only");
    await list
      .getByRole("link", {
        name: formatStay(addDays(today, 70), addDays(today, 73)),
      })
      .click();
    await expect(page).toHaveURL(`/admin/bookings/external/${imported}`);
  });

  test("searches and filters", async () => {
    await page.goto("/admin/bookings");
    await page.getByLabel(/^Search by name/).fill("coming soon");
    await page.getByRole("button", { name: "Show results" }).click();
    await expect(page.getByTestId("stay-list")).toContainText("Coming Soon");
    await expect(page.getByTestId("stay-list")).not.toContainText("Arriving");

    await page.goto("/admin/bookings?q=nobody-called-this");
    await expect(page.getByText("Nothing matches this search.")).toBeVisible();

    await page.goto("/admin/bookings?status=expired");
    await expect(page.getByTestId("stay-list")).toContainText("Never Paid");

    await page.goto(`/admin/bookings?money=paid&q=coming`);
    await expect(page.getByTestId("stay-list")).toHaveCount(0);
  });

  test("downloads an Excel file, for the Owner only", async () => {
    const owned = await page.request.get("/admin/bookings/export");
    expect(owned.headers()["content-type"]).toContain("spreadsheetml");
    expect(owned.headers()["content-disposition"]).toContain(".xlsx");

    const book = await readWorkbook(await owned.body());
    const names: unknown[] = [];
    book.worksheets[0].eachRow((row) => names.push(row.getCell(4).value));
    expect(names).toContain("Coming Soon");
    expect(names).not.toContain("Never Paid");

    const refused = await staffPage.request.get("/admin/bookings/export", {
      maxRedirects: 0,
    });
    expect(refused.headers().location).toContain("/admin/not-allowed");
  });
});

test.describe("one booking", () => {
  let id: string;

  test.beforeAll(async () => {
    id = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 100),
      checkOut: addDays(today, 104),
      name: "Maria Papadaki",
      email: "maria.ops@example.test",
      phone: "+30 693 000 1111",
      totalCents: 80000,
      notes: "Likes the upstairs room",
    });
    await addPayment(id, 20000);
  });

  test("has everything in one place", async () => {
    await page.goto(`/admin/bookings/${id}`);
    await expect(page.getByRole("link", { name: "Call" })).toHaveAttribute(
      "href",
      "tel:+306930001111",
    );
    await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/306930001111",
    );
    await expect(
      page.getByRole("link", { name: "Email", exact: true }),
    ).toHaveAttribute("href", "mailto:maria.ops@example.test");
    await expect(
      page.getByRole("textbox", { name: "Your private notes" }),
    ).toHaveValue("Likes the upstairs room");
    await expect(page.getByText("€600.00", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Open invoices/ }),
    ).toHaveAttribute("href", "/admin/invoices");
  });

  test("private notes can be changed, by Staff too", async () => {
    await staffPage.goto(`/admin/bookings/${id}`);
    await staffPage
      .getByRole("textbox", { name: "Your private notes" })
      .fill("Allergic to cats");
    await staffPage.getByRole("button", { name: "Save notes" }).click();
    await expect(staffPage.getByText("Notes saved.")).toBeVisible();
    const { rows } = await db.query(
      `select internal_notes from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0].internal_notes).toBe("Allergic to cats");
    await db.query(
      `update public.bookings set internal_notes = 'Likes the upstairs room' where id = $1`,
      [id],
    );
  });

  test("Staff can work the booking but not open documents", async () => {
    await staffPage.goto(`/admin/bookings/${id}`);
    await expect(
      staffPage.getByRole("textbox", { name: "Your private notes" }),
    ).toHaveValue("Likes the upstairs room");
    await expect(
      staffPage.getByRole("link", { name: /Open invoices/ }),
    ).toHaveCount(0);
  });

  test("writing to a guest queues it and says so", async () => {
    await page.goto(`/admin/bookings/${id}`);
    await page
      .getByLabel("Start from")
      .selectOption({ label: "Before arrival" });
    await expect(page.getByLabel("Message")).toHaveValue(/Hello Maria,/);
    await page.getByRole("button", { name: "Save message" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "will send once email is connected",
    );
    await expect(
      page
        .getByTestId("sent-message")
        .getByText("Will send once email is connected"),
    ).toBeVisible();

    const { rows } = await db.query(
      `select status, recipient, template_key, payload from public.email_logs where booking_id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "queued",
      recipient: "maria.ops@example.test",
      template_key: "host_message",
    });
    expect(rows[0].payload.sent_by).toBe(owner.id);
    expect(JSON.stringify(rows[0].payload)).not.toContain("token");
    await expect(
      page.getByRole("link", { name: "Open in my email app" }),
    ).toBeVisible();
  });

  test("a guest with no email gets call and WhatsApp only", async () => {
    const noEmail = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 110),
      checkOut: addDays(today, 112),
      email: null,
    });
    await page.goto(`/admin/bookings/${noEmail}`);
    await expect(page.getByText(/No email saved/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Call" })).toBeVisible();
    await expect(page.getByLabel("Message")).toHaveCount(0);
  });
});

test.describe("adding a booking by hand", () => {
  const fill = async (target: Page, name: string) => {
    await target.goto("/admin/bookings/new");
    await target.getByLabel("Arrival date").fill("2043-03-10");
    await target.getByLabel("Departure date").fill("2043-03-13");
    await target.getByLabel("Full name").fill(name);
    await target.getByLabel("Email").fill("manual.ops@example.test");
    await target.getByLabel(/^Phone/).fill("+30 693 222 3333");
    await target.getByRole("button", { name: "See the price" }).click();
  };

  test("prices it on the server and takes the dates", async () => {
    await fill(page, "Phone Guest");
    // 3 nights at 120, 40 cleaning, 2 a night climate fee.
    await expect(page.getByText("€406.00")).toBeVisible();
    await page.getByRole("button", { name: "Add this booking" }).click();
    await expect(page).toHaveURL(/\/admin\/bookings\/[0-9a-f-]{36}$/);
    const id = page.url().split("/").pop()!;
    trackBooking(id);

    const { rows } = await db.query(
      `select status, source, total_cents, due_now_cents, rules_snapshot, price_breakdown
       from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      status: "confirmed",
      source: "manual",
      total_cents: 40600,
      due_now_cents: 0,
    });
    expect(rows[0].price_breakdown.balanceCents).toBe(40600);
    expect(rows[0].rules_snapshot.cancellation.tiers).toEqual(
      savedPolicy.tiers,
    );

    const audit = await db.query(
      `select actor_id from public.audit_log
       where entity = 'bookings' and entity_id = $1 and action = 'insert'`,
      [id],
    );
    expect(audit.rows[0].actor_id).toBe(owner.id);
  });

  test("refuses the same stay when the dates are taken", async () => {
    await fill(page, "Second Guest");
    await expect(page.locator(".notice-bad")).toContainText("already taken");
    await expect(
      page.getByRole("button", { name: "Add this booking" }),
    ).toHaveCount(0);
  });

  test("refuses when the dates go between seeing the price and saving", async () => {
    await page.goto("/admin/bookings/new");
    await page.getByLabel("Arrival date").fill("2043-03-20");
    await page.getByLabel("Departure date").fill("2043-03-22");
    await page.getByLabel("Full name").fill("Too Late");
    await page.getByRole("button", { name: "See the price" }).click();
    const add = page.getByRole("button", { name: "Add this booking" });
    await add.waitFor();

    await addBooking({
      roomId: HOUSE,
      checkIn: "2043-03-21",
      checkOut: "2043-03-23",
    });
    await add.click();
    await expect(page.locator(".notice-bad")).toContainText("already taken");
    const { rows } = await db.query(
      `select count(*)::int as n from public.bookings where guest_name = 'Too Late'`,
    );
    expect(rows[0].n).toBe(0);
  });

  test("hides the price again once a box changes", async () => {
    await page.goto("/admin/bookings/new");
    await page.getByLabel("Arrival date").fill("2043-05-10");
    await page.getByLabel("Departure date").fill("2043-05-12");
    await page.getByLabel("Full name").fill("Changing Mind");
    await page.getByRole("button", { name: "See the price" }).click();
    const add = page.getByRole("button", { name: "Add this booking" });
    await add.waitFor();
    await page.getByLabel("Departure date").fill("2043-05-14");
    await expect(add).toHaveCount(0);
  });

  test("warns when guests could not book this, but lets him add it", async () => {
    await page.goto("/admin/bookings/new");
    await page.getByLabel("Arrival date").fill("2043-07-10");
    await page.getByLabel("Departure date").fill("2043-07-12");
    await page.getByLabel("Full name").fill("Short Stay");
    await page.getByRole("button", { name: "See the price" }).click();
    await expect(page.getByText(/further ahead than guests/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add this booking" }),
    ).toBeVisible();
  });
});

test.describe("changing dates", () => {
  let id: string;

  test.beforeAll(async () => {
    id = await addBooking({
      roomId: HOUSE,
      checkIn: "2043-04-01",
      checkOut: "2043-04-03",
      totalCents: 28400,
      rules: {
        ...FULL_REFUND_RULES,
        payment: {
          mode: "deposit",
          deposit: { kind: "percent", percent: 30 },
          balanceDaysBefore: 14,
        },
      },
    });
    await addBooking({
      roomId: HOUSE,
      checkIn: "2043-04-20",
      checkOut: "2043-04-25",
    });
  });

  const newDates = async (from: string, to: string) => {
    await page.goto(`/admin/bookings/${id}/change`);
    await page.getByLabel("Arrival date").fill(from);
    await page.getByLabel("Departure date").fill(to);
    await page.getByRole("button", { name: "See the price" }).click();
  };

  test("shows the difference, and saves the new price", async () => {
    await newDates("2043-04-05", "2043-04-09");
    // 4 nights: 480 + 40 + 8 is 528, up from 284.
    await expect(page.getByText("Guest pays more: €244.00")).toBeVisible();
    await page.getByRole("button", { name: "Save the new dates" }).click();
    await expect(page).toHaveURL(`/admin/bookings/${id}`);

    const { rows } = await db.query(
      `select check_in::text, check_out::text, total_cents, price_breakdown from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0]).toMatchObject({
      check_in: "2043-04-05",
      check_out: "2043-04-09",
      total_cents: 52800,
    });
    // Uses the booking's own 14 days, not whatever settings say today.
    expect(rows[0].price_breakdown.balanceDueOn).toBe("2043-03-22");
    expect(rows[0].price_breakdown.balanceCents).toBe(52800);

    const claim = await db.query(
      `select stay::text from public.inventory_claims where booking_id = $1`,
      [id],
    );
    expect(claim.rows[0].stay).toBe("[2043-04-05,2043-04-09)");
  });

  test("keeps the booking's own promo, even if it has since expired", async () => {
    const code = `OPS-${randomUUID().slice(0, 8)}`;
    await db.query(
      `insert into public.promo_codes
         (code, kind, value, valid_to, max_uses, used_count, is_active)
       values ($1, 'percent', 1000, '2020-01-01', 1, 1, false)`,
      [code],
    );
    const promoted = await addBooking({
      roomId: HOUSE,
      checkIn: "2043-05-20",
      checkOut: "2043-05-22",
      totalCents: 25600,
      promo: { code },
    });
    await page.goto(`/admin/bookings/${promoted}/change`);
    await page.getByLabel("Departure date").fill("2043-05-24");
    await page.getByRole("button", { name: "See the price" }).click();
    // 4 nights is 480, cleaning 40, so 52 off. Then 8 climate fee.
    await expect(
      page.locator(".money-line").filter({ hasText: "Discount" }),
    ).toContainText("-€52.00");
    await expect(
      page.locator(".money-line").filter({ hasText: "Booking price" }).first(),
    ).toContainText("€476.00");
    await expect(page.getByText(/no longer works/)).toHaveCount(0);
    await db.query(`delete from public.promo_codes where code = $1`, [code]);
  });

  test("refuses dates that are taken and changes nothing", async () => {
    await newDates("2043-04-19", "2043-04-22");
    await page.getByRole("button", { name: "Save the new dates" }).click();
    await expect(page.locator(".notice-bad")).toContainText("already taken");
    const { rows } = await db.query(
      `select check_in::text from public.bookings where id = $1`,
      [id],
    );
    expect(rows[0].check_in).toBe("2043-04-05");
  });
});

test.describe("money on a booking", () => {
  let id: string;

  test.beforeAll(async () => {
    id = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 200),
      checkOut: addDays(today, 203),
      totalCents: 30000,
    });
  });

  test("records a cash payment, and refuses too much", async () => {
    await page.goto(`/admin/bookings/${id}`);
    const panel = page
      .locator(".panel")
      .filter({ hasText: "€300.00 is still to pay" });
    await panel.getByLabel("Amount in euros").fill("100,50");
    await panel.getByRole("button", { name: "Record a payment" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "Payment recorded",
    );

    const { rows } = await db.query(
      `select kind, method, amount_cents, recorded_by from public.payments where booking_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        kind: "deposit",
        method: "cash",
        amount_cents: 10050,
        recorded_by: owner.id,
      },
    ]);

    await page.reload();
    const form = page.locator(".panel").filter({ hasText: "is still to pay" });
    await form.getByLabel("Amount in euros").fill("9999");
    await form.getByRole("button", { name: "Record a payment" }).click();
    await expect(page.locator(".notice-bad")).toContainText("more than");
  });

  test("a second tab cannot record the same payment twice", async ({
    browser,
  }) => {
    const twice = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 210),
      checkOut: addDays(today, 212),
      totalCents: 30000,
    });
    const other = await staffSession(browser, staff);
    const form = (target: Page) =>
      target.locator(".panel").filter({ hasText: "is still to pay" });

    await page.goto(`/admin/bookings/${twice}`);
    await other.goto(`/admin/bookings/${twice}`);
    await form(page).getByLabel("Amount in euros").fill("100");
    await form(page).getByRole("button", { name: "Record a payment" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "Payment recorded",
    );
    // The form empties, so a repeat tap has nothing to send.
    await expect(form(page).getByLabel("Amount in euros")).toHaveValue("");

    await form(other).getByLabel("Amount in euros").fill("100");
    await form(other).getByRole("button", { name: "Record a payment" }).click();
    await expect(other.locator(".notice-bad")).toContainText(
      "has just changed",
    );
    const { rows } = await db.query(
      `select count(*)::int as n from public.payments where booking_id = $1`,
      [twice],
    );
    expect(rows[0].n).toBe(1);
    await other.context().close();
  });

  test("records money given back, as Staff, up to what was paid", async () => {
    await staffPage.goto(`/admin/bookings/${id}`);
    const panel = staffPage.locator(".panel").filter({
      has: staffPage.getByRole("heading", {
        name: "Record money given back",
      }),
    });
    await panel.getByText("I gave money back").click();
    await panel.getByLabel("Amount in euros").fill("200");
    await panel
      .getByRole("button", { name: "Record money given back" })
      .click();
    await expect(panel.locator(".notice-bad")).toContainText("more than");

    await panel.getByLabel("Amount in euros").fill("50");
    await panel.getByLabel("Reason").fill("Goodwill");
    await panel
      .getByRole("button", { name: "Record money given back" })
      .click();
    await expect(panel.getByRole("status")).toContainText("Refund recorded");

    const { rows } = await db.query(
      `select amount_cents, status, recorded_by, reason from public.refunds where booking_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        amount_cents: 5000,
        status: "succeeded",
        recorded_by: staff.id,
        reason: "Goodwill",
      },
    ]);
  });

  test("a goodwill refund leaves no debt behind", async () => {
    await page.goto(`/admin/bookings/${id}`);
    // 300.00 less the 100.50 received. The 50 given back changes nothing.
    await expect(
      page.locator(".money-line").filter({ hasText: "Still to pay" }),
    ).toContainText("€199.50");
    await expect(
      page.locator(".money-line").filter({ hasText: "Refunded" }),
    ).toContainText("€50.00");
  });

  test("no money warning on a cancelled booking", async () => {
    const gone = await addBooking({
      roomId: room.id,
      status: "cancelled",
      checkIn: addDays(today, 220),
      checkOut: addDays(today, 222),
      name: "No Warning",
      cancelledAt: new Date().toISOString(),
    });
    await page.goto(`/admin/bookings/${gone}`);
    await expect(page.locator(".badge-warn")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "What to do next" }),
    ).toHaveCount(0);
  });
});

test.describe("cancelling", () => {
  test("refunds under the booking's own rules, not today's", async () => {
    const id = await addBooking({
      roomId: HOUSE,
      checkIn: "2043-06-01",
      checkOut: "2043-06-03",
      totalCents: 100000,
    });
    await addPayment(id, 100000);
    // Today's settings would refund nothing.
    await db.query(
      `update public.cancellation_policies set is_non_refundable = true, tiers = '[]' where is_default`,
    );

    await page.goto(`/admin/bookings/${id}`);
    await page.getByRole("link", { name: "Cancel booking" }).click();
    await expect(page).toHaveURL(`/admin/bookings/${id}/cancel`);
    await expect(page.getByText(/The 100% line applies/)).toBeVisible();
    const refundLine = page
      .locator(".money-line")
      .filter({ hasText: "Goes back to the guest" });
    await expect(refundLine).toContainText("€1,000.00");

    await page.getByLabel("Reason (optional)").fill("Family reasons");
    await page.getByLabel(/I have given €1,000.00 back/).check();
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(page).toHaveURL(`/admin/bookings/${id}`);

    const { rows } = await db.query(
      `select b.status, b.cancellation_reason, r.amount_cents, r.recorded_by
       from public.bookings b join public.refunds r on r.booking_id = b.id
       where b.id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        status: "refunded",
        cancellation_reason: "Family reasons",
        amount_cents: 100000,
        recorded_by: owner.id,
      },
    ]);
    const claims = await db.query(
      `select count(*)::int as n from public.inventory_claims where booking_id = $1`,
      [id],
    );
    expect(claims.rows[0].n).toBe(0);
    const audit = await db.query(
      `select actor_id from public.audit_log
       where entity = 'bookings' and entity_id = $1 and action = 'update'
       order by id desc limit 1`,
      [id],
    );
    expect(audit.rows[0].actor_id).toBe(owner.id);

    await db.query(
      `update public.cancellation_policies set is_non_refundable = $2, tiers = $1::jsonb where is_default`,
      [JSON.stringify(savedPolicy.tiers), savedPolicy.is_non_refundable],
    );
  });

  test("leaves a card refund marked for online payments", async () => {
    const id = await addBooking({
      roomId: HOUSE,
      checkIn: "2043-06-10",
      checkOut: "2043-06-12",
      totalCents: 60000,
    });
    await addPayment(id, 60000, { method: "card" });

    await page.goto(`/admin/bookings/${id}/cancel`);
    await expect(
      page.getByText(/€600.00 of this was paid by card/),
    ).toBeVisible();
    await expect(page.getByLabel(/I have given/)).toHaveCount(0);
    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(page).toHaveURL(`/admin/bookings/${id}`);

    await expect(
      page.locator(".money-line").filter({ hasText: "Still to give back" }),
    ).toContainText("€600.00");
    await expect(page.getByText(/Card payments can be refunded/)).toBeVisible();
    const { rows } = await db.query(
      `select count(*)::int as n from public.refunds where booking_id = $1`,
      [id],
    );
    expect(rows[0].n).toBe(0);
  });

  test("keeps the deposit when it is too late for a refund, with no debt", async () => {
    const id = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 5),
      checkOut: addDays(today, 7),
      totalCents: 40000,
    });
    await addPayment(id, 10000);
    await page.goto(`/admin/bookings/${id}/cancel`);
    await expect(page.getByText("The guest owes nothing more.")).toBeVisible();
    await expect(
      page.locator(".money-line").filter({ hasText: "You keep" }),
    ).toContainText("€100.00");
    await expect(page.getByText(/still owes/)).toHaveCount(0);

    await page
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(page).toHaveURL(`/admin/bookings/${id}`);
    await expect(page.getByText(/still owes/)).toHaveCount(0);
    await expect(
      page.locator(".money-line").filter({ hasText: "Still to pay" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Record a payment" }),
    ).toHaveCount(0);
  });

  test("Staff can cancel, and the log names them", async () => {
    const id = await addBooking({
      roomId: HOUSE,
      checkIn: "2043-06-20",
      checkOut: "2043-06-22",
      totalCents: 20000,
    });
    await staffPage.goto(`/admin/bookings/${id}/cancel`);
    await staffPage
      .getByRole("button", { name: "Yes, cancel this booking" })
      .click();
    await expect(staffPage).toHaveURL(`/admin/bookings/${id}`);
    const audit = await db.query(
      `select actor_id from public.audit_log
       where entity = 'bookings' and entity_id = $1 and action = 'update'
       order by id desc limit 1`,
      [id],
    );
    expect(audit.rows[0].actor_id).toBe(staff.id);
  });
});

test.describe("arrivals and departures", () => {
  // Stays on today's date need a room of their own: the home tests hold it.
  let arrivals: FixtureRoom;

  test.beforeAll(async () => {
    arrivals = await createFixtureRoom();
  });

  test("marks a stay through to the end", async () => {
    const id = await addBooking({
      roomId: arrivals.id,
      checkIn: today,
      checkOut: addDays(today, 2),
    });
    const status = async () =>
      (await db.query(`select status from public.bookings where id = $1`, [id]))
        .rows[0].status;

    await page.goto(`/admin/bookings/${id}`);
    await page.getByRole("button", { name: "Mark as arrived" }).click();
    await page.getByRole("button", { name: "Mark as left" }).waitFor();
    await expect.poll(status).toBe("checked_in");
    await page.getByRole("button", { name: "Mark as left" }).click();
    await expect.poll(status).toBe("completed");
  });

  test("marks a no-show and frees the dates", async () => {
    const id = await addBooking({
      roomId: arrivals.id,
      checkIn: addDays(today, -10),
      checkOut: addDays(today, -8),
    });
    await page.goto(`/admin/bookings/${id}`);
    await page.getByRole("button", { name: "Guest did not arrive" }).click();
    const stored = async () =>
      (
        await db.query(
          `select b.status, (select count(*)::int from public.inventory_claims c where c.booking_id = b.id) as claims
           from public.bookings b where b.id = $1`,
          [id],
        )
      ).rows[0];
    await expect.poll(stored).toEqual({ status: "no_show", claims: 0 });
  });

  test("offers no arrival before the day", async () => {
    const id = await addBooking({
      roomId: arrivals.id,
      checkIn: addDays(today, 300),
      checkOut: addDays(today, 302),
    });
    await page.goto(`/admin/bookings/${id}`);
    await expect(
      page.getByRole("button", { name: "Mark as arrived" }),
    ).toHaveCount(0);
  });
});

test.describe("calendar", () => {
  const day = (target: Page, date: string) =>
    target.getByRole("button", {
      name: new RegExp(`^${formatDate(date)}:`),
    });

  test("closes and reopens a range of nights", async () => {
    await page.goto("/admin/calendar?month=2043-09");
    await day(page, "2043-09-10").click();
    await day(page, "2043-09-12").click();
    await expect(page.getByText(/3 nights/)).toBeVisible();
    await page.getByLabel("Why?").selectOption({ label: "Repairs" });
    await page.getByLabel("Note (optional)").fill("New boiler");
    await page.getByRole("button", { name: "Close these dates" }).click();
    await expect(day(page, "2043-09-11")).toHaveClass(/night-block/);

    const { rows } = await db.query(
      `select end_date::text, reason, created_by from public.availability_blocks
       where room_id = $1 and start_date = '2043-09-10'`,
      [HOUSE],
    );
    expect(rows).toEqual([
      {
        end_date: "2043-09-13",
        reason: "maintenance",
        created_by: owner.id,
      },
    ]);

    await day(page, "2043-09-11").click();
    await page.getByRole("button", { name: "Open these dates again" }).click();
    await expect(day(page, "2043-09-11")).not.toHaveClass(/night-block/);
    const left = await db.query(
      `select count(*)::int as n from public.availability_blocks
       where room_id = $1 and start_date = '2043-09-10'`,
      [HOUSE],
    );
    expect(left.rows[0].n).toBe(0);
  });

  test("closes a range across two months in one go", async () => {
    await page.goto("/admin/calendar?month=2043-09");
    await day(page, "2043-09-29").click();
    await page.getByRole("link", { name: "Next month" }).click();
    await expect(page).toHaveURL(/month=2043-10/);
    await day(page, "2043-10-02").click();
    await expect(page.getByText(/4 nights/)).toBeVisible();
    await page.getByRole("button", { name: "Close these dates" }).click();
    await expect(day(page, "2043-10-01")).toHaveClass(/night-block/);

    const { rows } = await db.query(
      `select end_date::text from public.availability_blocks
       where room_id = $1 and start_date = '2043-09-29'`,
      [HOUSE],
    );
    expect(rows).toEqual([{ end_date: "2043-10-03" }]);
  });

  test("will not run a range across a booking", async () => {
    await addBooking({
      roomId: HOUSE,
      checkIn: "2043-08-10",
      checkOut: "2043-08-12",
      name: "Summer Guest",
    });
    await page.goto("/admin/calendar?month=2043-08");
    await day(page, "2043-08-08").click();
    await day(page, "2043-08-14").click();
    await expect(page.getByText(/One of those nights is taken/)).toBeVisible();
  });

  test("tapping a booking opens it, and each source has its colour", async () => {
    await addExternal(room.airbnb, "2043-08-20", "2043-08-22");
    await page.goto("/admin/calendar?month=2043-08");
    await expect(page.locator(".legend")).toContainText("Airbnb");
    await expect(page.locator(".cal .night-airbnb")).toHaveCount(2);
    await page
      .getByRole("link", { name: /Summer Guest/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/admin\/bookings\/[0-9a-f-]{36}$/);
  });

  test("Staff can close dates", async () => {
    await staffPage.goto("/admin/calendar?month=2043-09");
    await day(staffPage, "2043-09-20").click();
    await staffPage.getByRole("button", { name: "Close these dates" }).click();
    await expect(day(staffPage, "2043-09-20")).toHaveClass(/night-block/);
    const { rows } = await db.query(
      `select created_by from public.availability_blocks
       where room_id = $1 and start_date = '2043-09-20'`,
      [HOUSE],
    );
    expect(rows[0].created_by).toBe(staff.id);
  });
});

test.describe("prices and rules", () => {
  test("sets a price on Fridays and Saturdays of a month, then clears it", async () => {
    await page.goto("/admin/rates?month=2043-10");
    await page.getByLabel("From", { exact: true }).fill("2043-10-01");
    await page.getByLabel("Until, and including").fill("2043-10-31");
    for (const name of ["Mon", "Tue", "Wed", "Thu", "Sun"]) {
      await page.getByLabel(name, { exact: true }).uncheck();
    }
    await page.getByLabel(/^Price per night/).fill("150,50");
    await page.getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByText("Saved for 10 nights.")).toBeVisible();

    const count = async () =>
      (
        await db.query(
          `select count(*)::int as n, min(nightly_cents) as low from public.rate_overrides
           where room_id = $1 and night between '2043-10-01' and '2043-10-31'`,
          [HOUSE],
        )
      ).rows[0];
    expect(await count()).toEqual({ n: 10, low: 15050 });

    await page.reload();
    await expect(page.locator(".price-set")).toHaveCount(10);
    // The exact price, not a rounded one.
    await expect(page.locator(".price-set").first()).toContainText("150.50");

    await page.getByLabel("From", { exact: true }).fill("2043-10-01");
    await page.getByLabel("Until, and including").fill("2043-10-31");
    const asked = page.waitForEvent("dialog");
    await page
      .getByRole("button", { name: "Go back to the normal price" })
      .click();
    expect((await asked).message()).toContain(formatDate("2043-10-31"));
    await expect(page.getByText(/10 days went back/)).toBeVisible();
    expect((await count()).n).toBe(0);
  });

  test("a day price of zero needs saying twice", async () => {
    await page.goto("/admin/rates?month=2043-10");
    await page.getByLabel("From", { exact: true }).fill("2043-10-05");
    await page.getByLabel("Until, and including").fill("2043-10-05");
    await page.getByLabel(/^Price per night/).fill("0");
    await page.getByRole("button", { name: "Set this price" }).click();
    await expect(page.getByText(/make the night free/)).toBeVisible();
    const { rows } = await db.query(
      `select count(*)::int as n from public.rate_overrides
       where room_id = $1 and night = '2043-10-05'`,
      [HOUSE],
    );
    expect(rows[0].n).toBe(0);
  });

  test("clearing with no dates says what is missing", async () => {
    await page.goto("/admin/rates?month=2043-10");
    await page
      .getByRole("button", { name: "Go back to the normal price" })
      .click();
    await expect(page.getByText("Please choose a date.").first()).toBeVisible();
  });

  test("a season can be added, and cannot overlap another", async () => {
    await page.goto("/admin/rates/seasons");
    const add = page
      .locator(".panel")
      .filter({ has: page.getByRole("heading", { name: "Add a season" }) });
    const fill = async (name: string) => {
      await add.getByLabel("Name of the season").fill(name);
      await add.getByLabel("First day").fill("2043-11-01");
      await add.getByLabel("Last day").fill("2043-11-30");
      await add.getByLabel("Price per night, in euros").fill("200");
      await add.getByRole("button", { name: "Add a season" }).click();
    };
    await fill("Ops autumn");
    await expect(
      page.getByRole("heading", { name: "Ops autumn" }),
    ).toBeVisible();

    await fill("Ops overlap");
    await expect(add.locator(".notice-bad")).toContainText("overlaps");

    const card = page.locator(".panel").filter({
      has: page.getByRole("heading", { name: "Ops autumn" }),
    });
    await card.getByText("Change").click();
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Ops autumn" })).toHaveCount(
      0,
    );
  });

  test("stay rules are open to Staff", async () => {
    await staffPage.goto("/admin/rates/restrictions");
    const add = staffPage
      .locator(".panel")
      .filter({ has: staffPage.getByRole("heading", { name: "Add a rule" }) });
    await add.getByLabel("First day").fill("2043-12-01");
    await add.getByLabel("Last day").fill("2043-12-10");
    await add.getByRole("button", { name: "Add a rule" }).click();
    await expect(add.locator(".notice-bad")).toContainText("at least one rule");

    await add.getByLabel(/^Shortest stay/).fill("3");
    await add.getByLabel("Sat").check();
    await add.getByRole("button", { name: "Add a rule" }).click();
    await expect(staffPage.getByText("At least 3 nights")).toBeVisible();

    const { rows } = await db.query(
      `select min_stay, allowed_check_in_days from public.restrictions
       where room_id = $1 and start_date = '2043-12-01'`,
      [HOUSE],
    );
    expect(rows).toEqual([{ min_stay: 3, allowed_check_in_days: [6] }]);

    const card = staffPage
      .locator(".panel")
      .filter({ hasText: "At least 3 nights" });
    await card.getByText("Change").click();
    await card.getByRole("button", { name: "Delete" }).click();
    await expect(staffPage.getByText("At least 3 nights")).toHaveCount(0);
  });

  test("a fee and a promo code save in the right units", async () => {
    await page.goto("/admin/rates/fees");
    const addFee = page
      .locator(".panel")
      .filter({ has: page.getByRole("heading", { name: "Add a tax or fee" }) });
    await addFee.getByLabel("Name in English").fill("Ops fee");
    await addFee.getByLabel("Name in Greek").fill("Τέλος");
    await addFee.getByLabel("Amount in euros").fill("1,50");
    await addFee.getByLabel(/^Applies from/).fill("2043-12-01");
    await addFee.getByLabel(/^Applies until/).fill("2043-12-31");
    await addFee.getByRole("button", { name: "Add a tax or fee" }).click();
    await expect(page.getByRole("heading", { name: "Ops fee" })).toBeVisible();
    const fee = await db.query(
      `select amount_cents, kind from public.taxes_fees where name->>'en' = 'Ops fee'`,
    );
    expect(fee.rows).toEqual([{ amount_cents: 150, kind: "per_night" }]);
    const feeCard = page.locator(".panel").filter({
      has: page.getByRole("heading", { name: "Ops fee" }),
    });
    await feeCard.getByText("Change").click();
    await feeCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: "Ops fee" })).toHaveCount(0);

    const code = `OPS-${randomUUID().slice(0, 8)}`;
    await page.goto("/admin/rates/promos");
    const addPromo = page
      .locator(".panel")
      .filter({ has: page.getByRole("heading", { name: "Add a code" }) });
    await addPromo.getByLabel("Code", { exact: true }).fill(code);
    await addPromo.getByLabel(/^Percentage, or amount/).fill("12,5");
    await addPromo.getByRole("button", { name: "Add a code" }).click();
    await expect(page.getByRole("heading", { name: code })).toBeVisible();
    const promo = await db.query(
      `select kind, value from public.promo_codes where code = $1`,
      [code],
    );
    expect(promo.rows).toEqual([{ kind: "percent", value: 1250 }]);

    // The form emptied after saving, so a repeat tap adds nothing.
    await expect(addPromo.getByLabel("Code", { exact: true })).toHaveValue("");
    await addPromo.getByLabel("Code", { exact: true }).fill(code.toLowerCase());
    await addPromo.getByLabel(/^Percentage, or amount/).fill("12,5");
    await addPromo.getByRole("button", { name: "Add a code" }).click();
    await expect(addPromo.locator(".notice-bad")).toContainText(
      "already exists",
    );

    const promoCard = page.locator(".panel").filter({
      has: page.getByRole("heading", { name: code }),
    });
    await promoCard.getByText("Change").click();
    await promoCard.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("heading", { name: code })).toHaveCount(0);
  });

  test("the price pages are the Owner's", async () => {
    for (const path of [
      "/admin/rates",
      "/admin/rates/seasons",
      "/admin/rates/fees",
      "/admin/rates/promos",
    ]) {
      await staffPage.goto(path);
      await expect(staffPage).toHaveURL(/\/admin\/not-allowed$/);
    }
  });
});

test.describe("Airbnb and Booking.com details", () => {
  let event: string;

  test.beforeAll(async () => {
    event = await addExternal(
      room.bookingCom,
      addDays(today, 120),
      addDays(today, 124),
    );
  });

  test("the Owner adds contacts and the amount, and they survive a sync", async () => {
    await page.goto(`/admin/bookings/external/${event}`);
    await expect(page.getByText("No amount yet")).toBeVisible();
    await page.getByLabel("Guest name").fill("Sophie Laurent");
    await page.getByLabel("Email", { exact: true }).fill("sophie@example.test");
    await page.getByLabel(/^Phone/).fill("+33 6 12 34 56 78");
    await page.getByLabel(/^Amount in euros/).fill("640,50");
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByRole("status").first()).toContainText(
      "Details saved.",
    );

    const stored = async () =>
      (
        await db.query(
          `select guest_name, guest_email, guest_phone, amount_cents
           from public.external_events where id = $1`,
          [event],
        )
      ).rows[0];
    expect(await stored()).toEqual({
      guest_name: "Sophie Laurent",
      guest_email: "sophie@example.test",
      guest_phone: "+33 6 12 34 56 78",
      amount_cents: 64050,
    });

    await db.query(
      `select public.upsert_external_event(calendar_id, uid, start_date, end_date, 'Changed')
       from public.external_events where id = $1`,
      [event],
    );
    expect((await stored()).amount_cents).toBe(64050);

    await page.reload();
    await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
      "href",
      "https://wa.me/33612345678",
    );
  });

  test("Staff add contacts but cannot see or change the amount", async () => {
    await staffPage.goto(`/admin/bookings/external/${event}`);
    await expect(staffPage.getByText("640.50")).toHaveCount(0);
    await expect(staffPage.getByLabel(/^Amount in euros/)).toHaveCount(0);
    await staffPage.getByLabel("Notes").fill("Late arrival");
    await staffPage.getByRole("button", { name: "Save details" }).click();
    await expect(staffPage.getByRole("status").first()).toContainText(
      "Details saved.",
    );
    const { rows } = await db.query(
      `select guest_notes, amount_cents from public.external_events where id = $1`,
      [event],
    );
    expect(rows[0]).toEqual({
      guest_notes: "Late arrival",
      amount_cents: 64050,
    });
  });

  test("the guest appears in Guests, and can be written to", async () => {
    await page.goto("/admin/guests?q=sophie");
    await page.getByRole("link", { name: /Sophie Laurent/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/guests/${event}$`));
    await expect(page.getByRole("link", { name: "Call" })).toBeVisible();

    await page.getByLabel("Subject").fill("Your stay");
    await page.getByLabel("Message").fill("See you soon.");
    await page.getByRole("button", { name: "Save message" }).click();
    await expect(page.getByRole("status").first()).toContainText("Saved.");
    const { rows } = await db.query(
      `select recipient, status from public.email_logs where payload->>'external_event_id' = $1`,
      [event],
    );
    expect(rows).toEqual([
      { recipient: "sophie@example.test", status: "queued" },
    ]);

    await page.goto(`/admin/bookings/external/${event}`);
    await expect(page.getByTestId("sent-message")).toContainText("Your stay");
  });

  test("an import with no details stays out of Guests", async () => {
    await page.goto("/admin/guests");
    await expect(page.getByRole("link", { name: /Reserved/ })).toHaveCount(0);
  });
});

test.describe("messages", () => {
  test("opens, reads, replies and archives", async () => {
    const email = `inbox-${randomUUID()}@example.test`;
    const bookingId = await addBooking({
      roomId: room.id,
      checkIn: addDays(today, 130),
      checkOut: addDays(today, 132),
      email,
      name: "Inbox Guest",
    });
    const id = await addMessage({
      name: "Inbox Guest",
      email,
      message: "Can we bring a dog?",
    });

    await staffPage.goto("/admin/messages");
    await expect(
      staffPage.getByRole("link", { name: /Inbox Guest/ }),
    ).toContainText("Unread");
    await staffPage.getByRole("link", { name: /Inbox Guest/ }).click();
    await expect(staffPage.getByText("Can we bring a dog?")).toBeVisible();
    await expect(
      staffPage.getByRole("link", { name: /^E2E-/ }),
    ).toHaveAttribute("href", `/admin/bookings/${bookingId}`);

    const stored = async () =>
      (
        await db.query(
          `select status, is_read from public.contact_messages where id = $1`,
          [id],
        )
      ).rows[0];
    expect(await stored()).toEqual({ status: "new", is_read: true });

    await staffPage.getByRole("button", { name: "Mark as replied" }).click();
    await expect.poll(async () => (await stored()).status).toBe("replied");

    await staffPage.getByRole("button", { name: "Archive" }).click();
    await expect.poll(async () => (await stored()).status).toBe("archived");
  });

  test("shows older messages instead of cutting them off", async () => {
    for (let index = 0; index < 31; index += 1) {
      await addMessage({
        name: `Older ${index}`,
        email: "older@example.test",
        message: "An old message",
        status: "archived",
      });
    }
    await page.goto("/admin/messages?tab=archived");
    await page.getByRole("link", { name: "Older messages" }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(
      page.getByRole("link", { name: "Newer messages" }),
    ).toBeVisible();
  });

  test("explains an empty box", async () => {
    await page.goto("/admin/messages?tab=archived");
    await expect(page.locator("main")).toContainText(/Archived/);
  });
});

test.describe("income and reports", () => {
  test.beforeAll(async () => {
    await addReportYear(room);
  });

  const text = (id: string) => page.getByTestId(id);

  test("August 2019 matches the numbers worked by hand", async () => {
    await page.goto("/admin/reports?year=2019&month=8");

    const income = text("income");
    const line = (label: string | RegExp) =>
      income.locator(".money-line").filter({ hasText: label });
    await expect(line(/^Payments€/)).toContainText("€400.00");
    await expect(line(/^Refunds given back/)).toContainText("-€200.00");
    await expect(line(/^Received/)).toContainText("€200.00");
    await expect(line("Airbnb, entered by you")).toContainText("€500.00");
    await expect(line("Total income")).toContainText("€700.00");
    await expect(line("Held in a card dispute")).toContainText("€50.00");

    const expected = text("expected");
    const owed = (label: string) =>
      expected.locator(".money-line").filter({ hasText: label });
    await expect(owed("Booked")).toContainText("€1,000.00");
    await expect(owed("Still to come")).toContainText("€0.00");
    await expect(owed("Overdue")).toContainText("€600.00");
    await expect(expected).not.toContainText("cancellation");

    const stat = (id: string, label: string) =>
      text(id).locator(".stat").filter({ hasText: label });
    await expect(stat("booking-counts", "New bookings")).toContainText("3");
    await expect(stat("booking-counts", "Stays so far")).toContainText("3");
    await expect(stat("booking-counts", "Stays expected")).toContainText("0");
    await expect(stat("booking-counts", "Cancelled")).toContainText("1");
    await expect(stat("booking-counts", "Did not arrive")).toContainText("1");
    await expect(stat("night-figures", "Nights booked")).toContainText("10");
    await expect(stat("night-figures", "House full")).toContainText("34.5%");
    await expect(stat("night-figures", "House full")).toContainText("Of 29");
    await expect(stat("night-figures", "Average price")).toContainText(
      "€190.00",
    );
    await expect(stat("night-figures", "Average stay")).toContainText(
      "3.0 nights",
    );

    await expect(text("no-amount")).toContainText(
      "1 Airbnb or Booking.com stay (2 nights) has no amount",
    );

    const source = (name: string) =>
      text("by-source").locator(".source-card").filter({ hasText: name });
    await expect(source("Added by hand")).toContainText("€1,000.00");
    await expect(source("Added by hand")).toContainText("€400.00");
    await expect(source("Website")).toContainText("-€200.00");
    await expect(source("Airbnb")).toContainText("€500.00");
  });

  test("the no amount link lists exactly those stays", async () => {
    await page.goto("/admin/reports?year=2019&month=8");
    await text("no-amount").getByRole("link").click();
    await expect(page).toHaveURL(/tab=past/);
    await expect(page).toHaveURL(/money=no_amount/);
    const rows = page.getByTestId("stay-list").getByRole("listitem");
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText("Booking.com");
  });

  test("the whole year adds up", async () => {
    await page.goto("/admin/reports?year=2019&month=all");
    const total = text("income")
      .locator(".money-line")
      .filter({ hasText: "Total income" });
    await expect(total).toContainText("€1,600.00");
  });

  test("downloads the year as an Excel file", async () => {
    const response = await page.request.get("/admin/reports/export?year=2019");
    expect(response.headers()["content-disposition"]).toContain(
      "casa-filakopi-report-2019.xlsx",
    );
    const book = await readWorkbook(await response.body());
    const sheet = book.worksheets[0];
    const august = rowStarting(sheet, "2019-08");
    expect([2, 3, 4, 5, 6].map((n) => august.getCell(n).value)).toEqual([
      400, 200, 200, 500, 700,
    ]);
    expect(rowStarting(sheet, "Whole year").getCell(6).value).toBe(1600);
  });

  test("Staff are turned away", async () => {
    await staffPage.goto("/admin/reports");
    await expect(staffPage).toHaveURL(/\/admin\/not-allowed$/);
    const refused = await staffPage.request.get(
      "/admin/reports/export?year=2019",
      { maxRedirects: 0 },
    );
    expect(refused.headers().location).toContain("/admin/not-allowed");
  });
});
