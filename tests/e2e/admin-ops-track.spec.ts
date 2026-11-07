import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { addDays, athensDate } from "@/lib/domain/dates";
import { readWorkbook } from "../read-xlsx";
import {
  authAdmin,
  createTestUser,
  db,
  deleteCreatedUsers,
  latestMail,
  newOwnerPage,
  rememberUser,
  signInWithPassword,
  testAddress,
  testEmail,
  type TestUser,
} from "./admin-helpers";

// Privacy on a guest's page, the Users screen and the Home notice.

test.describe.configure({ mode: "serial" });

let owner: TestUser;
let page: Page;
const today = athensDate(new Date());
const created: { guests: string[]; rooms: string[] } = {
  guests: [],
  rooms: [],
};

async function addGuest(checkIn: string, checkOut: string, status: string) {
  const marker = `zq${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const { rows: room } = await db.query(
    `insert into public.rooms (slug, name, max_adults, base_occupancy, base_price_cents, is_active)
     values ($1, '{"en":"Test room"}', 4, 2, 10000, false) returning id`,
    [`ops-track-${marker}`],
  );
  const { rows: guest } = await db.query(
    `insert into public.guests (email, full_name) values ($1, $2) returning id`,
    [`${marker}@example.test`, `Maria ${marker}`],
  );
  await db.query(
    `insert into public.bookings (
       room_id, guest_id, status, check_in, check_out, adults, guest_name, guest_email,
       special_requests, price_breakdown, total_cents, due_now_cents, rules_snapshot, reference
     ) values ($1, $2, $3, $4, $5, 2, $6, $7, $8, '{"nights":[]}', 10000, 0, '{}', $9)`,
    [
      room[0].id,
      guest[0].id,
      status,
      checkIn,
      checkOut,
      `Maria ${marker}`,
      `${marker}@example.test`,
      `A cot ${marker}`,
      `CF-${marker.slice(0, 10)}`,
    ],
  );
  created.guests.push(guest[0].id);
  created.rooms.push(room[0].id);
  return { id: guest[0].id as string, marker };
}

test.beforeAll(async ({ browser }) => {
  owner = await createTestUser("owner");
  page = await newOwnerPage(browser, owner);
});

test.afterAll(async () => {
  await db.query(`delete from public.bookings where guest_id = any($1)`, [
    created.guests,
  ]);
  await db.query(`delete from public.guests where id = any($1)`, [
    created.guests,
  ]);
  await db.query(`delete from public.rooms where id = any($1)`, [
    created.rooms,
  ]);
  await page.context().close();
  await deleteCreatedUsers();
});

test.describe("guest privacy", () => {
  test("the Owner downloads all of a guest's data as Excel", async () => {
    const guest = await addGuest(
      addDays(today, -30),
      addDays(today, -28),
      "completed",
    );
    await page.goto(`/admin/guests/${guest.id}`);
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /Download all their data/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(
      `guest-data-${guest.id.slice(0, 8)}.xlsx`,
    );
    expect(file.suggestedFilename()).not.toContain(guest.marker);
    const stream = await file.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const workbook = await readWorkbook(Buffer.concat(chunks));
    expect(workbook.getWorksheet("Guest")!.getRow(3).getCell(2).value).toBe(
      `${guest.marker}@example.test`,
    );
    expect(workbook.getWorksheet("Bookings")!.rowCount).toBe(2);

    const { rows } = await db.query(
      `select actor_id, after from public.audit_log
       where action = 'export' and entity_id = $1`,
      [guest.id],
    );
    expect(rows[0].actor_id).toBe(owner.id);
  });

  test("removing details needs the box, then they are gone", async () => {
    const guest = await addGuest(
      addDays(today, -40),
      addDays(today, -38),
      "completed",
    );
    await page.goto(`/admin/guests/${guest.id}`);
    const button = page.getByRole("button", { name: "Remove their details" });
    await button.click();
    await expect(page.locator("p.notice-bad")).toContainText("tick the box");

    await page.getByLabel("I understand this cannot be undone").check();
    await button.click();
    await expect(page.getByTestId("guest-anonymised")).toBeVisible();
    await expect(page.getByTestId("guest-privacy")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(guest.marker);

    const { rows } = await db.query(
      `select guest_name, special_requests from public.bookings where guest_id = $1`,
      [guest.id],
    );
    expect(rows[0]).toEqual({ guest_name: null, special_requests: null });
  });

  test("a guest with a stay to come is refused, in plain words", async () => {
    const guest = await addGuest(
      addDays(today, 30),
      addDays(today, 32),
      "confirmed",
    );
    await page.goto(`/admin/guests/${guest.id}`);
    await page.getByLabel("I understand this cannot be undone").check();
    await page.getByRole("button", { name: "Remove their details" }).click();
    await expect(page.locator("p.notice-bad")).toContainText("still to come");
    const { rows } = await db.query(
      `select email from public.guests where id = $1`,
      [guest.id],
    );
    expect(rows[0].email).toBe(`${guest.marker}@example.test`);
  });

  test("a guest known only from an imported stay can be removed too", async () => {
    const { rows: room } = await db.query(
      `insert into public.rooms (slug, name, max_adults, base_occupancy, base_price_cents, is_active)
       values ($1, '{"en":"Test room"}', 4, 2, 10000, false) returning id`,
      [`ops-track-${randomUUID()}`],
    );
    created.rooms.push(room[0].id);
    const { rows: calendar } = await db.query(
      `insert into public.external_calendars (room_id, channel)
       values ($1, 'airbnb') returning id`,
      [room[0].id],
    );
    const marker = `zq${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const { rows: event } = await db.query(
      `insert into public.external_events (calendar_id, uid, start_date, end_date, guest_name)
       values ($1, $2, $3, $4, $5) returning id`,
      [
        calendar[0].id,
        marker,
        addDays(today, -60),
        addDays(today, -58),
        `Imported ${marker}`,
      ],
    );
    await page.goto(`/admin/guests/${event[0].id}`);
    await page.getByLabel("I understand this cannot be undone").check();
    await page.getByRole("button", { name: "Remove their details" }).click();
    await expect(page).toHaveURL(/\/admin\/guests$/);
    await expect(page.locator("main")).not.toContainText(marker);
    const { rows } = await db.query(
      `select guest_name from public.external_events where id = $1`,
      [event[0].id],
    );
    expect(rows[0].guest_name).toBeNull();
  });

  test("a name-only match is offered, left out, and not erased", async () => {
    const guest = await addGuest(
      addDays(today, -70),
      addDays(today, -68),
      "completed",
    );
    const { rows: message } = await db.query(
      `insert into public.contact_messages (name, email, message)
       values ($1, 'other@example.test', 'Same name') returning id`,
      [`Maria ${guest.marker}`],
    );
    await page.goto(`/admin/guests/${guest.id}`);
    await expect(page.getByTestId("name-candidates")).toBeVisible();

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: /Download all their data/ }).click();
    const stream = await (await download).createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const workbook = await readWorkbook(Buffer.concat(chunks));
    expect(workbook.getWorksheet("Messages")!.rowCount).toBe(1);

    await page.getByLabel("I understand this cannot be undone").check();
    await page.getByRole("button", { name: "Remove their details" }).click();
    await expect(page.getByTestId("guest-anonymised")).toBeVisible();
    const { rows } = await db.query(
      `select email from public.contact_messages where id = $1`,
      [message[0].id],
    );
    expect(rows[0].email).toBe("other@example.test");
    await db.query(`delete from public.contact_messages where id = $1`, [
      message[0].id,
    ]);
  });

  test("open money is refused, in plain words", async () => {
    const guest = await addGuest(
      addDays(today, -80),
      addDays(today, -78),
      "completed",
    );
    const { rows: booking } = await db.query(
      `select id from public.bookings where guest_id = $1`,
      [guest.id],
    );
    await db.query(
      `insert into public.payments (booking_id, kind, method, status, amount_cents)
       values ($1, 'full', 'cash', 'succeeded', 10000)`,
      [booking[0].id],
    );
    await page.goto(`/admin/guests/${guest.id}`);
    await page.getByLabel("I understand this cannot be undone").check();
    await page.getByRole("button", { name: "Remove their details" }).click();
    await expect(page.locator("p.notice-bad")).toContainText(
      "no issued document",
    );
    await db.query(`delete from public.payments where booking_id = $1`, [
      booking[0].id,
    ]);
  });

  test("Staff see no privacy tools and cannot reach the export", async ({
    browser,
  }) => {
    const guest = await addGuest(
      addDays(today, -50),
      addDays(today, -48),
      "completed",
    );
    const staff = await createTestUser("staff");
    const context = await browser.newContext({
      extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    });
    const staffPage = await context.newPage();
    await signInWithPassword(staffPage, staff);
    await expect(staffPage).toHaveURL(/\/admin$/);
    await staffPage.goto(`/admin/guests/${guest.id}`);
    await expect(staffPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(staffPage.getByTestId("guest-privacy")).toHaveCount(0);
    await staffPage.goto("/admin/users");
    await expect(staffPage).toHaveURL(/not-allowed/);
    const response = await staffPage.request.get(
      `/admin/guests/${guest.id}/export`,
      { maxRedirects: 0 },
    );
    expect(response.status()).toBe(307);
    expect(response.headers()["location"]).toContain("not-allowed");
    await context.close();
  });
});

test.describe("users", () => {
  const row = (name: string) =>
    page.getByTestId("admin-users").locator("li", { hasText: name });

  test("invite, promote, reset and remove", async () => {
    const email = testEmail();
    const name = `Invited ${randomUUID().slice(0, 6)}`;
    await page.goto("/admin/users");
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator("p.notice-ok")).toContainText("Invitation sent");

    const { data } = await authAdmin.listUsers({ perPage: 1000 });
    const invited = data.users.find((user) => user.email === email)!;
    rememberUser(invited.id, email);
    await expect.poll(() => latestMail(email)).toBeTruthy();

    const { rows } = await db.query(
      `select role, display_name from public.admin_profiles where id = $1`,
      [invited.id],
    );
    expect(rows[0]).toEqual({ role: "staff", display_name: name });

    await page.reload();
    const person = row(name);
    await person.locator("summary", { hasText: "Make Owner" }).click();
    const typeEmail = person.getByLabel(`To confirm, type ${email}`).first();
    await typeEmail.fill("wrong@example.test");
    await person.getByRole("button", { name: "Make Owner" }).click();
    await expect(person.locator("p.notice-bad")).toContainText(
      "does not match",
    );
    await typeEmail.fill(email);
    await person.getByRole("button", { name: "Make Owner" }).click();
    await expect(
      row(name).locator("summary", { hasText: "Make Staff" }),
    ).toBeVisible();

    // An Owner goes only by typing their email.
    const removal = row(name).locator("details", { hasText: "Remove" });
    await removal.locator("summary").click();
    await removal.getByLabel(`To confirm, type ${email}`).fill(email);
    await removal.getByRole("button", { name: "Remove" }).click();
    await expect(row(name)).toHaveCount(0);

    const { data: banned } = await authAdmin.getUserById(invited.id);
    expect(banned.user?.banned_until).toBeTruthy();

    // Back again through the same screen, with the same email.
    await page.getByLabel("Name").fill(name);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator("p.notice-ok")).toContainText("Invitation sent");
    const { data: back } = await authAdmin.getUserById(invited.id);
    expect(back.user?.banned_until ?? null).toBeNull();

    const { rows: trail } = await db.query(
      `select action from public.audit_log
       where entity = 'admin_user' and entity_id = $1 order by id`,
      [invited.id],
    );
    expect(trail.map((entry) => entry.action)).toEqual([
      "admin_banned",
      "admin_unbanned",
    ]);
  });

  test("inviting an Owner needs the email typed twice", async () => {
    await page.goto("/admin/users");
    await page.getByLabel("Name").fill("Second Owner");
    await page.getByLabel("Email", { exact: true }).fill(testEmail());
    await page.getByLabel("Role").selectOption("owner");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator(".field-error").first()).toContainText(
      "does not match",
    );
  });

  test("an Owner's own row has no buttons", async () => {
    await page.goto("/admin/users");
    const mine = page
      .getByTestId("admin-users")
      .locator("li", { hasText: owner.email });
    await expect(mine.getByRole("button")).toHaveCount(0);
  });

  test("a bad email stays on the form", async () => {
    await page.goto("/admin/users");
    await page.getByLabel("Name").fill("Nobody");
    await page.getByLabel("Email", { exact: true }).fill("not-an-email");
    await page.getByRole("button", { name: "Send invitation" }).click();
    await expect(page.locator(".field-error").first()).toBeVisible();
  });
});

test.describe("footer", () => {
  test("shows the registration number only when there is one", async ({
    page: visitor,
  }) => {
    const { rows } = await db.query(
      `select registration_number from public.property`,
    );
    const before = rows[0].registration_number;
    try {
      await db.query(`update public.property set registration_number = null`);
      await visitor.goto("/en");
      await expect(visitor.getByTestId("registration-number")).toHaveCount(0);

      await db.query(
        `update public.property set registration_number = '00000123456'`,
      );
      await visitor.goto("/el");
      await expect(visitor.getByTestId("registration-number")).toContainText(
        "00000123456",
      );
    } finally {
      await db.query(`update public.property set registration_number = $1`, [
        before,
      ]);
    }
  });
});

test.describe("job health route", () => {
  test("needs the cron secret, and leaves a heartbeat", async ({ request }) => {
    expect((await request.post("/api/cron/health")).status()).toBe(401);
    const response = await request.post("/api/cron/health", {
      headers: { authorization: "Bearer cms-e2e-cron" },
    });
    expect(response.status()).toBe(200);
    const { rows } = await db.query(
      `select status from public.job_runs where job = 'job_health'
       order by id desc limit 1`,
    );
    expect(rows[0].status).toBe("success");
    await db.query(
      `delete from public.job_runs where job = 'job_health' and detail like 'alerted%'`,
    );
  });
});

test.describe("Home", () => {
  test("says so when a database job last failed or the site is silent", async () => {
    await db.query(
      `insert into public.job_runs (job, status, finished_at, detail)
       values ('apply_retention', 'failed', now(), 'boom')`,
    );
    await page.goto("/admin");
    await expect(page.getByTestId("job-health")).toContainText(
      "Removing old guest data",
    );

    await db.query(`select public.run_database_job('apply_retention')`);
    await db.query(
      `insert into public.job_runs (job, status, finished_at, detail)
       select unnest(array['job_health', 'release_expired_holds', 'complete_finished_bookings',
                           'purge_admin_attempts', 'scheduled_emails']),
              'success', now(), 'test'`,
    );
    await page.reload();
    await expect(page.getByTestId("job-health")).toHaveCount(0);
    await db.query(`delete from public.job_runs where detail = 'test'`);
  });
});
