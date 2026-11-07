import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { addDays, athensDate } from "@/lib/domain/dates";
import { deriveGuestToken } from "@/lib/email/guest-link";
import { skipCookieBanner } from "../e2e/helpers";
import {
  createTestUser,
  db,
  deleteCreatedUsers,
  newOwnerPage,
  signInWithPassword,
  testAddress,
} from "../e2e/admin-helpers";

// Yorgos's side of a card payment, on a real paid booking: refunds through
// Stripe, a refund Stripe refuses, the payment link, and the guest paying what
// is left from their private page.

test.describe.configure({ mode: "serial" });

const guestToken = (bookingId: string) =>
  deriveGuestToken("pay-e2e-guest-token-secret-of-enough-length", bookingId);

const FAKE = `http://127.0.0.1:${process.env.FAKE_STRIPE_PORT ?? 12111}`;
let dayOffset = 490;

test.beforeEach(async () => {
  // Every test comes from one address, so the real limits would stop them.
  await db.query(
    `delete from public.admin_attempts where scope like 'pay\\_%'`,
  );
});

test.afterAll(async () => {
  await deleteCreatedUsers();
  await db.end();
});

/** A guest who has paid, by the same route a browser takes. */
async function paidBooking(request: APIRequestContext, baseURL: string) {
  const today = athensDate(new Date());
  const checkIn = addDays(today, dayOffset);
  dayOffset += 5;
  const email = `pay-e2e-${randomUUID()}@example.test`;
  const response = await request.post("/api/checkout", {
    headers: { origin: baseURL },
    data: {
      checkIn,
      checkOut: addDays(checkIn, 3),
      adults: 2,
      children: 0,
      locale: "en",
      name: "Pat Example",
      email,
      phone: "+30 690 000 0000",
      country: "Greece",
      marketing: false,
      acceptTerms: true,
    },
  });
  expect(response.status()).toBe(200);
  const { url } = (await response.json()) as { url: string };
  const paid = await request.post(`${url}/pay`, { maxRedirects: 0 });
  expect(paid.status()).toBe(303);

  await expect
    .poll(
      async () =>
        (
          await db.query(
            `select status from public.bookings where guest_email = $1`,
            [email],
          )
        ).rows[0]?.status,
      { timeout: 15_000 },
    )
    .toBe("confirmed");
  const { rows } = await db.query(
    `select id, total_cents, access_token_hash from public.bookings where guest_email = $1`,
    [email],
  );
  return rows[0] as { id: string; total_cents: number };
}

const refundRows = async (bookingId: string) =>
  (
    await db.query(
      `select status, amount_cents from public.refunds where booking_id = $1 order by created_at`,
      [bookingId],
    )
  ).rows;

test("refunds to the card, after a confirm, and handles a refusal", async ({
  browser,
  request,
  baseURL,
}) => {
  const booking = await paidBooking(request, baseURL!);
  const owner = await createTestUser("owner");
  const page = await newOwnerPage(browser, owner, { width: 375, height: 800 });
  await page.goto(`/admin/bookings/${booking.id}`);

  await page.getByText("Refund to the card").last().click();
  await page.getByLabel("Amount in euros").last().fill("10");
  await page.getByLabel("Reason").last().fill("Goodwill");

  // Saying no sends nothing.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Send refund" }).click();
  expect(await refundRows(booking.id)).toEqual([]);

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Send refund" }).click();
  await expect(page.getByText(/credit note/)).toBeVisible();
  expect(await refundRows(booking.id)).toEqual([
    { status: "succeeded", amount_cents: 1000 },
  ]);

  await page.reload();
  await request.post(`${FAKE}/__fail/refund`);
  await page.getByText("Refund to the card").last().click();
  await page.getByLabel("Amount in euros").last().fill("20");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Send refund" }).click();
  await expect(page.getByText(/Stripe refused/)).toBeVisible();
  expect(await refundRows(booking.id)).toEqual([
    { status: "succeeded", amount_cents: 1000 },
    { status: "failed", amount_cents: 2000 },
  ]);
  await page.context().close();
});

const fakeSessionStatus = async (
  request: APIRequestContext,
  sessionId: string,
) =>
  (
    (await (
      await request.get(`${FAKE}/v1/checkout/sessions/${sessionId}`)
    ).json()) as { status: string }
  ).status;

test("a cash payment closes an open balance page", async ({
  browser,
  request,
  baseURL,
}) => {
  const booking = await paidBooking(request, baseURL!);
  await db.query(
    `update public.bookings set total_cents = total_cents + 5000 where id = $1`,
    [booking.id],
  );
  const opened = await request.post("/api/checkout/balance", {
    headers: { origin: baseURL! },
    data: { token: guestToken(booking.id), locale: "en" },
  });
  expect(opened.status()).toBe(200);
  const { url } = (await opened.json()) as { url: string };
  const sessionId = url.split("/").at(-1)!;
  expect(await fakeSessionStatus(request, sessionId)).toBe("open");

  const owner = await createTestUser("owner");
  const page = await newOwnerPage(browser, owner, { width: 1280, height: 800 });
  await page.goto(`/admin/bookings/${booking.id}`);
  await page.getByLabel("Amount in euros").first().fill("20");
  await page.getByRole("button", { name: "Record a payment" }).click();
  await expect(page.getByText("Payment recorded.")).toBeVisible();
  expect(await fakeSessionStatus(request, sessionId)).toBe("expired");
  await page.context().close();
});

test("cancelling from Admin refunds the card and emails the guest", async ({
  browser,
  request,
  baseURL,
}) => {
  const booking = await paidBooking(request, baseURL!);
  const owner = await createTestUser("owner");
  const page = await newOwnerPage(browser, owner, { width: 1280, height: 800 });
  await page.goto(`/admin/bookings/${booking.id}/cancel`);
  await page.getByRole("button", { name: "Yes, cancel this booking" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/bookings/${booking.id}$`));
  await page.context().close();

  const { rows } = await db.query(
    `select template_key from public.email_logs where booking_id = $1`,
    [booking.id],
  );
  const keys = rows.map((row) => row.template_key);
  expect(keys).toContain("booking_cancellation");
  expect(keys).toContain("refund_confirmation");
  expect(await refundRows(booking.id)).toEqual([
    { status: "succeeded", amount_cents: booking.total_cents },
  ]);
});

test("Staff do not get card refunds", async ({ browser, request, baseURL }) => {
  const booking = await paidBooking(request, baseURL!);
  const staff = await createTestUser("staff");
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  const page = await context.newPage();
  await signInWithPassword(page, staff);
  await page.goto(`/admin/bookings/${booking.id}`);
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("Refund to the card")).toHaveCount(0);
  await context.close();
});

test("sends a payment link, and the guest pays what is left", async ({
  browser,
  request,
  baseURL,
}) => {
  const booking = await paidBooking(request, baseURL!);
  // The stay grew by €50 after it was paid.
  await db.query(
    `update public.bookings set total_cents = total_cents + 5000 where id = $1`,
    [booking.id],
  );

  const owner = await createTestUser("owner");
  const page = await newOwnerPage(browser, owner, { width: 1280, height: 800 });
  await page.goto(`/admin/bookings/${booking.id}`);
  await page.getByRole("button", { name: "Send payment link" }).click();
  await expect
    .poll(
      async () =>
        (
          await db.query(
            `select count(*)::int as n from public.email_logs where booking_id = $1 and template_key = 'balance_request'`,
            [booking.id],
          )
        ).rows[0].n,
    )
    .toBe(1);
  await page.context().close();

  const guest = await browser.newPage({
    viewport: { width: 375, height: 800 },
  });
  await skipCookieBanner(guest);
  await guest.goto(`/en/booking/${guestToken(booking.id)}`);
  await expect(guest.getByTestId("guest-balance")).toHaveText("€50.00");

  await guest.getByRole("button", { name: "Pay the balance" }).click();
  await expect(guest.getByTestId("amount")).toHaveText("5000");
  await guest.getByRole("button", { name: "Pay" }).click();
  await expect(guest.getByText("Your booking is confirmed")).toBeVisible({
    timeout: 20_000,
  });
  await guest.getByRole("link", { name: "View your booking" }).click();
  await expect(guest.getByTestId("guest-balance")).toHaveCount(0);
  await guest.close();

  const { rows } = await db.query(
    `select kind, status, amount_cents from public.payments where booking_id = $1 order by created_at`,
    [booking.id],
  );
  expect(rows.map((row) => row.status)).toEqual(["succeeded", "succeeded"]);
  expect(rows[1]).toMatchObject({ kind: "balance", amount_cents: 5000 });
});
