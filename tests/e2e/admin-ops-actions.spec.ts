import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { formatters } from "@/lib/admin/format";
import { addDays, athensDate } from "@/lib/domain/dates";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  enrolOwner,
  lockSharedSettings,
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
  createFixtureRoom,
  HOUSE,
  removeFixtures,
  type FixtureRoom,
} from "./admin-ops-fixtures";

const { formatDate } = formatters("en");

// Server actions are public POST endpoints, so each one is captured from the
// real Owner and sent again as everybody else. A refused replay must change
// nothing. Staff replays of booking work must land, and name them.

test.describe.configure({ mode: "serial" });

interface CapturedAction {
  path: string;
  action: string;
  contentType: string;
  body: Buffer;
}

const today = athensDate(new Date());

const newContext = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    viewport: { width: 1280, height: 900 },
  });

async function capture(
  page: Page,
  submit: () => Promise<void>,
): Promise<CapturedAction> {
  const pattern = /\/admin(\/|$)/;
  const captured = new Promise<CapturedAction>((resolve) => {
    void page.route(pattern, async (route) => {
      const request = route.request();
      const action = request.headers()["next-action"];
      if (request.method() !== "POST" || !action) return route.continue();
      resolve({
        path: new URL(request.url()).pathname + new URL(request.url()).search,
        action,
        contentType: request.headers()["content-type"],
        body: request.postDataBuffer()!,
      });
      await route.abort();
    });
  });
  await submit();
  const result = await captured;
  await page.unroute(pattern);
  return result;
}

function replay(request: APIRequestContext, action: CapturedAction) {
  return request.post(action.path, {
    headers: {
      "next-action": action.action,
      "content-type": action.contentType,
      origin: test.info().project.use.baseURL!,
    },
    data: action.body,
    maxRedirects: 0,
  });
}

function redirectTarget(response: {
  headers(): Record<string, string>;
}): string {
  const headers = response.headers();
  const target = headers["x-action-redirect"] ?? headers.location ?? "";
  return target.split(";")[0];
}

let owner: TestUser;
let staff: TestUser;
let ownerPage: Page;
let staffContext: BrowserContext;
let ownerAal1Context: BrowserContext;
let removedContext: BrowserContext;
let anonymous: BrowserContext;
let room: FixtureRoom;
let bookingId: string;
let eventId: string;
let messageId: string;
let cashPaymentId: string;
let blockId: string;
let basePrice: number;

const owned: Record<string, CapturedAction> = {};
const shared: Record<string, CapturedAction> = {};

/**
 * Every row these actions could touch. A refused replay must leave it alone.
 * Only this spec's own rows count: other runs share the database.
 */
async function fingerprint() {
  const { rows } = await db.query(
    `select
       (select count(*)::int from public.bookings
         where room_id = $1 and check_in between '2042-01-01' and '2042-12-31') as bookings,
       (select count(*)::int from public.payments where booking_id = $2) as payments,
       (select count(*)::int from public.refunds where booking_id = $2) as refunds,
       (select count(*)::int from public.email_logs where booking_id = $2) as emails,
       (select count(*)::int from public.availability_blocks
         where room_id = $1 and start_date between '2042-01-01' and '2042-12-31') as blocks,
       (select count(*)::int from public.seasons where name = 'Replayed') as seasons,
       (select count(*)::int from public.restrictions
         where room_id = $1 and start_date between '2042-01-01' and '2042-12-31') as restrictions,
       (select count(*)::int from public.taxes_fees where name->>'en' = 'Replayed') as fees,
       (select count(*)::int from public.promo_codes where code = 'REPLAYED') as promos,
       (select count(*)::int from public.rate_overrides
         where room_id = $1 and night between '2042-01-01' and '2042-12-31') as rates,
       (select base_price_cents from public.rooms where id = $1) as base,
       (select status::text from public.bookings where id = $2) as status,
       (select check_in::text from public.bookings where id = $2) as check_in,
       (select status from public.contact_messages where id = $3) as message,
       (select guest_name from public.external_events where id = $4) as event`,
    [HOUSE, bookingId, messageId, eventId],
  );
  return rows[0];
}

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  room = await createFixtureRoom();
  basePrice = (
    await db.query(`select base_price_cents from public.rooms where id = $1`, [
      HOUSE,
    ])
  ).rows[0].base_price_cents;
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");

  const ownerContext = await newContext(browser);
  ownerPage = await ownerContext.newPage();
  await signInWithPassword(ownerPage, owner);
  await enrolOwner(ownerPage, owner);

  staffContext = await newContext(browser);
  const staffPage = await staffContext.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);

  ownerAal1Context = await newContext(browser);
  const aal1 = await ownerAal1Context.newPage();
  await signInWithPassword(aal1, owner);
  await expect(aal1).toHaveURL(/\/admin\/mfa$/);

  anonymous = await newContext(browser);

  const removed = await createTestUser("staff");
  removedContext = await newContext(browser);
  const removedPage = await removedContext.newPage();
  await signInWithPassword(removedPage, removed);
  await expect(removedPage).toHaveURL(/\/admin$/);
  await db.query(`delete from public.admin_profiles where id = $1`, [
    removed.id,
  ]);

  bookingId = await addBooking({
    roomId: HOUSE,
    checkIn: "2042-05-10",
    checkOut: "2042-05-12",
    totalCents: 50000,
    email: "replay@example.test",
  });
  cashPaymentId = await addPayment(bookingId, 20000);
  const arriving = await addBooking({
    roomId: room.id,
    checkIn: today,
    checkOut: addDays(today, 2),
  });
  eventId = await addExternal(room.airbnb, "2042-06-01", "2042-06-03");
  await db.query(
    `update public.external_events set guest_email = 'replay@example.test' where id = $1`,
    [eventId],
  );
  messageId = await addMessage({
    name: "Replay",
    email: "replay@example.test",
    message: "Hello",
  });
  const block = await db.query(
    `select public.create_block($1, '2042-07-01', '2042-07-03', 'other') as id`,
    [HOUSE],
  );
  blockId = block.rows[0].id;

  const page = ownerPage;
  const bookingPage = `/admin/bookings/${bookingId}`;
  const panel = (name: string) =>
    page.locator(".panel").filter({
      has: page.getByRole("heading", { name, exact: true }),
    });

  await page.goto("/admin/bookings/new");
  await page.getByLabel("Arrival date").fill("2042-08-10");
  await page.getByLabel("Departure date").fill("2042-08-12");
  await page.getByLabel("Full name").fill("Replayed Guest");
  await page.getByRole("button", { name: "See the price" }).click();
  await page.getByRole("button", { name: "Add this booking" }).waitFor();
  shared.createBooking = await capture(page, () =>
    page.getByRole("button", { name: "Add this booking" }).click(),
  );

  await page.goto(`${bookingPage}/change`);
  await page.getByLabel("Arrival date").fill("2042-05-14");
  await page.getByLabel("Departure date").fill("2042-05-16");
  await page.getByRole("button", { name: "See the price" }).click();
  await page.getByRole("button", { name: "Save the new dates" }).waitFor();
  shared.changeDates = await capture(page, () =>
    page.getByRole("button", { name: "Save the new dates" }).click(),
  );

  await page.goto(bookingPage);
  const pay = panel("Record a payment");
  await pay.getByLabel("Amount in euros").fill("10");
  shared.recordPayment = await capture(page, () =>
    pay.getByRole("button", { name: "Record a payment" }).click(),
  );

  await page.goto(bookingPage);
  const back = panel("Record money given back");
  await back.getByText("I gave money back").click();
  await back.getByLabel("Amount in euros").fill("5");
  await back.getByLabel("Reason").fill("Replay");
  shared.recordRefund = await capture(page, () =>
    back.getByRole("button", { name: "Record money given back" }).click(),
  );

  await page.goto(`${bookingPage}/cancel`);
  shared.cancelBooking = await capture(page, () =>
    page.getByRole("button", { name: "Yes, cancel this booking" }).click(),
  );

  await page.goto(`/admin/bookings/${arriving}`);
  shared.markStay = await capture(page, () =>
    page.getByRole("button", { name: "Mark as arrived" }).click(),
  );

  await page.goto(`/admin/bookings/external/${eventId}`);
  await page.getByLabel("Guest name").fill("Forged name");
  await page.getByLabel(/^Amount in euros/).fill("999");
  shared.externalDetails = await capture(page, () =>
    page.getByRole("button", { name: "Save details" }).click(),
  );

  await page.goto(bookingPage);
  await page.getByLabel("Subject").fill("Replayed");
  await page.getByLabel("Message").fill("Replayed");
  shared.queueMessage = await capture(page, () =>
    page.getByRole("button", { name: "Save message" }).click(),
  );

  await page.goto(`/admin/messages/${messageId}`);
  shared.messageStatus = await capture(page, () =>
    page.getByRole("button", { name: "Archive" }).click(),
  );

  const day = (date: string) =>
    page.getByRole("button", { name: new RegExp(`^${formatDate(date)}:`) });
  await page.goto("/admin/calendar?month=2042-09");
  await day("2042-09-10").click();
  shared.closeDates = await capture(page, () =>
    page.getByRole("button", { name: "Close these dates" }).click(),
  );

  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/admin/calendar?month=2042-07");
  await day("2042-07-01").click();
  shared.reopenDates = await capture(page, () =>
    page.getByRole("button", { name: "Open these dates again" }).click(),
  );

  await page.goto("/admin/rates/restrictions");
  const addRule = panel("Add a rule");
  await addRule.getByLabel("First day").fill("2042-10-01");
  await addRule.getByLabel("Last day").fill("2042-10-02");
  await addRule.getByLabel(/^Shortest stay/).fill("2");
  shared.saveRestriction = await capture(page, () =>
    addRule.getByRole("button", { name: "Add a rule" }).click(),
  );

  await page.goto("/admin/rates");
  await page.getByLabel("From", { exact: true }).fill("2042-11-01");
  await page.getByLabel("Until, and including").fill("2042-11-03");
  await page.getByLabel(/^Price per night/).fill("321");
  owned.setDailyPrices = await capture(page, () =>
    page.getByRole("button", { name: "Set this price" }).click(),
  );

  await page.goto("/admin/rates");
  await page.getByLabel(/^Normal price per night/).fill("321");
  owned.saveBasePrices = await capture(page, () =>
    panel("Normal prices").getByRole("button", { name: "Save" }).click(),
  );

  await page.goto("/admin/rates/seasons");
  const addSeason = panel("Add a season");
  await addSeason.getByLabel("Name of the season").fill("Replayed");
  await addSeason.getByLabel("First day").fill("2042-12-01");
  await addSeason.getByLabel("Last day").fill("2042-12-02");
  await addSeason.getByLabel("Price per night, in euros").fill("321");
  owned.saveSeason = await capture(page, () =>
    addSeason.getByRole("button", { name: "Add a season" }).click(),
  );

  await page.goto("/admin/rates/fees");
  const addFee = panel("Add a tax or fee");
  await addFee.getByLabel("Name in English").fill("Replayed");
  await addFee.getByLabel("Name in Greek").fill("Replayed");
  await addFee.getByLabel("Amount in euros").fill("1");
  await addFee.getByLabel(/^Applies from/).fill("2042-12-01");
  await addFee.getByLabel(/^Applies until/).fill("2042-12-02");
  owned.saveFee = await capture(page, () =>
    addFee.getByRole("button", { name: "Add a tax or fee" }).click(),
  );

  await page.goto("/admin/rates/promos");
  const addPromo = panel("Add a code");
  await addPromo.getByLabel("Code", { exact: true }).fill("REPLAYED");
  await addPromo.getByLabel(/^Percentage, or amount/).fill("10");
  owned.savePromo = await capture(page, () =>
    addPromo.getByRole("button", { name: "Add a code" }).click(),
  );
});

test.afterAll(async () => {
  await db.query(
    `update public.rooms set base_price_cents = $2 where id = $1`,
    [HOUSE, basePrice],
  );
  await db.query(`delete from public.promo_codes where code = 'REPLAYED'`);
  await db.query(`delete from public.seasons where name = 'Replayed'`);
  await db.query(
    `delete from public.taxes_fees where name->>'en' = 'Replayed'`,
  );
  await db.query(
    `delete from public.rate_overrides where room_id = $1 and night >= '2042-01-01'`,
    [HOUSE],
  );
  await db.query(
    `delete from public.restrictions where room_id = $1 and start_date >= '2042-01-01'`,
    [HOUSE],
  );
  await db.query(
    `delete from public.availability_blocks where room_id = $1 and start_date >= '2042-01-01'`,
    [HOUSE],
  );
  await db.query(
    `delete from public.email_logs where booking_id in (
       select id from public.bookings where guest_name = 'Replayed Guest'
     )`,
  );
  await db.query(
    `delete from public.bookings where guest_name = 'Replayed Guest'`,
  );
  await removeFixtures();
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

const allActions = () => ({ ...shared, ...owned });

test("an Owner with only a password is sent to the code screen, changing nothing", async () => {
  const before = await fingerprint();
  for (const [name, action] of Object.entries(allActions())) {
    const response = await replay(ownerAal1Context.request, action);
    expect(redirectTarget(response), name).toBe("/admin/mfa");
  }
  expect(await fingerprint()).toEqual(before);
});

test("a login that is no longer an admin is refused, changing nothing", async () => {
  const before = await fingerprint();
  for (const [name, action] of Object.entries(allActions())) {
    const response = await replay(removedContext.request, action);
    expect(redirectTarget(response), name).toBe("/admin/login");
  }
  expect(await fingerprint()).toEqual(before);
});

test("no session at all is refused, changing nothing", async () => {
  const before = await fingerprint();
  for (const [name, action] of Object.entries(allActions())) {
    const response = await replay(anonymous.request, action);
    expect(redirectTarget(response), name).toBe("/admin/login");
  }
  expect(await fingerprint()).toEqual(before);
});

test("Staff are refused the Owner's price actions, changing nothing", async () => {
  const before = await fingerprint();
  for (const [name, action] of Object.entries(owned)) {
    const response = await replay(staffContext.request, action);
    expect(redirectTarget(response), name).toBe("/admin/not-allowed");
  }
  expect(await fingerprint()).toEqual(before);
});

test("a forged refund of a card payment is refused", async () => {
  // Same request, with the cash payment swapped for a card one.
  const card = await addPayment(bookingId, 500, { method: "card" });
  const action = shared.recordRefund;
  const forged = {
    ...action,
    body: Buffer.from(
      action.body.toString("latin1").replaceAll(cashPaymentId, card),
      "latin1",
    ),
  };
  expect(forged.body.equals(action.body)).toBe(false);

  const response = await replay(staffContext.request, forged);
  expect(await response.text()).toContain("only be refunded through online");
  const { rows } = await db.query(
    `select count(*)::int as n from public.refunds where payment_id = $1`,
    [card],
  );
  expect(rows[0].n).toBe(0);
  await db.query(`delete from public.payments where id = $1`, [card]);
});

test("Staff can do booking work, and the records name them", async () => {
  const request = staffContext.request;
  for (const name of [
    "recordPayment",
    "recordRefund",
    "queueMessage",
    "messageStatus",
    "closeDates",
    "saveRestriction",
  ]) {
    const response = await replay(request, shared[name]);
    expect(response.status(), name).toBe(200);
  }

  const payment = await db.query(
    `select recorded_by, amount_cents from public.payments
     where booking_id = $1 and id <> $2`,
    [bookingId, cashPaymentId],
  );
  expect(payment.rows).toEqual([{ recorded_by: staff.id, amount_cents: 1000 }]);

  const refund = await db.query(
    `select recorded_by, amount_cents from public.refunds where booking_id = $1`,
    [bookingId],
  );
  expect(refund.rows).toEqual([{ recorded_by: staff.id, amount_cents: 500 }]);

  const mail = await db.query(
    `select payload->>'sent_by' as sent_by from public.email_logs where booking_id = $1`,
    [bookingId],
  );
  expect(mail.rows).toEqual([{ sent_by: staff.id }]);

  const block = await db.query(
    `select created_by from public.availability_blocks
     where room_id = $1 and start_date = '2042-09-10'`,
    [HOUSE],
  );
  expect(block.rows).toEqual([{ created_by: staff.id }]);
});

test("the same payment or refund sent again is refused", async () => {
  const count = async () =>
    (
      await db.query(
        `select
           (select count(*)::int from public.payments where booking_id = $1) as payments,
           (select count(*)::int from public.refunds where booking_id = $1) as refunds`,
        [bookingId],
      )
    ).rows[0];
  const before = await count();
  for (const name of ["recordPayment", "recordRefund"]) {
    const response = await replay(staffContext.request, shared[name]);
    expect(await response.text(), name).toContain("has just changed");
  }
  expect(await count()).toEqual(before);
});

test("a change of dates by Staff lands and is logged under them", async () => {
  const response = await replay(staffContext.request, shared.changeDates);
  expect(redirectTarget(response)).toBe(`/admin/bookings/${bookingId}`);
  const { rows } = await db.query(
    `select actor_id from public.audit_log
     where entity = 'bookings' and entity_id = $1 and action = 'update'
     order by id desc limit 1`,
    [bookingId],
  );
  expect(rows[0].actor_id).toBe(staff.id);
});

test("an amount in a Staff request for an import is ignored", async () => {
  const response = await replay(staffContext.request, shared.externalDetails);
  expect(response.status()).toBe(200);
  const { rows } = await db.query(
    `select guest_name, amount_cents from public.external_events where id = $1`,
    [eventId],
  );
  expect(rows[0]).toEqual({ guest_name: "Forged name", amount_cents: null });
});

test("the same bytes set the amount for the real Owner", async () => {
  const response = await replay(
    ownerPage.context().request,
    shared.externalDetails,
  );
  expect(response.status()).toBe(200);
  const { rows } = await db.query(
    `select amount_cents from public.external_events where id = $1`,
    [eventId],
  );
  expect(rows[0].amount_cents).toBe(99900);
});

test("marking an arrival before the day is refused on the server", async () => {
  const future = addDays(today, 30);
  const { rows } = await db.query(
    `update public.bookings set check_in = $1, check_out = $2
     where room_id = $3 and check_in = $4 returning id`,
    [future, addDays(future, 2), room.id, today],
  );
  const response = await replay(staffContext.request, shared.markStay);
  expect(response.status()).toBe(200);
  const stored = await db.query(
    `select status from public.bookings where id = $1`,
    [rows[0].id],
  );
  expect(stored.rows[0].status).toBe("confirmed");
});

test("a cancel sent with an old refund figure is refused", async () => {
  // Refund changed since the form was opened, so the booking stands.
  await addPayment(bookingId, 1000);
  const response = await replay(staffContext.request, shared.cancelBooking);
  expect(response.status()).toBe(200);
  const { rows } = await db.query(
    `select status from public.bookings where id = $1`,
    [bookingId],
  );
  expect(rows[0].status).toBe("confirmed");
});

test("the Owner's own replays work, so the refusals above mean something", async () => {
  const request = ownerPage.context().request;
  for (const [name, action] of Object.entries(owned)) {
    const response = await replay(request, action);
    expect(response.status(), name).toBe(200);
    // A refusal also answers 200, so read what it said.
    expect(await response.text(), name).not.toContain(
      "Please fix the items marked below.",
    );
  }
  const { rows } = await db.query(
    `select
       (select count(*)::int from public.rate_overrides where room_id = $1 and night between '2042-11-01' and '2042-11-03') as rates,
       (select count(*)::int from public.promo_codes where code = 'REPLAYED') as promos`,
    [HOUSE],
  );
  expect(rows[0]).toEqual({ rates: 3, promos: 1 });
});

test("the block action works for Staff too", async () => {
  const response = await replay(staffContext.request, shared.reopenDates);
  expect(response.status()).toBe(200);
  const { rows } = await db.query(
    `select count(*)::int as n from public.availability_blocks where id = $1`,
    [blockId],
  );
  expect(rows[0].n).toBe(0);
});
