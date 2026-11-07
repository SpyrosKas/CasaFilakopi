import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  authAdmin,
  createTestUser,
  deleteCreatedUsers,
  enrolOwner,
  signInWithPassword,
  type TestUser,
} from "./admin-helpers";
import {
  addBooking,
  addExternal,
  addMessage,
  addPayment,
  createFixtureRoom,
  removeFixtures,
} from "./admin-ops-fixtures";

// T3.20c: every admin screen at phone and tablet widths.

const WIDTHS = [320, 375, 768];
const MIN_TAP = 44;

interface LayoutProblem {
  kind: string;
  detail: string;
}

/** Runs in the page. Reports sideways scrolling, overflow, small or overlapping targets. */
function findLayoutProblems(minTap: number): LayoutProblem[] {
  const problems: LayoutProblem[] = [];
  const name = (el: Element) =>
    `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  const width = document.documentElement.clientWidth;

  if (document.documentElement.scrollWidth > width) {
    problems.push({
      kind: "sideways scroll",
      detail: `${document.documentElement.scrollWidth} > ${width}`,
    });
  }

  for (const el of document.querySelectorAll("body *")) {
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.right > width + 0.5) {
      problems.push({ kind: "past the edge", detail: name(el) });
    }
  }

  const targets = [
    ...document.querySelectorAll(
      "a, button, input:not([type=hidden]), textarea, select, summary",
    ),
  ]
    .map((el) => {
      // A radio or checkbox is tapped through its whole label.
      const small = el.matches("input[type=radio], input[type=checkbox]");
      const target = small ? (el.closest("label") ?? el) : el;
      return { el: target, box: target.getBoundingClientRect() };
    })
    .filter(
      ({ el, box }) =>
        box.width > 0 &&
        getComputedStyle(el).visibility !== "hidden" &&
        // A closed <details> keeps its layout box but shows nothing.
        (!el.closest("details:not([open])") || el.closest("summary") !== null),
    );

  for (const { el, box } of targets) {
    if (box.height < minTap - 0.5 || box.width < minTap - 0.5) {
      problems.push({
        kind: "small target",
        detail: `${name(el)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      });
    }
  }

  const isPinned = (el: Element) => el.closest("[data-pinned]") !== null;

  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const [a, b] = [targets[i], targets[j]];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      // The bottom bar floats over the page by design. That the page can
      // always scroll clear of it is checked below instead.
      if (isPinned(a.el) !== isPinned(b.el)) continue;
      const overlaps =
        a.box.left < b.box.right - 1 &&
        b.box.left < a.box.right - 1 &&
        a.box.top < b.box.bottom - 1 &&
        b.box.top < a.box.bottom - 1;
      if (overlaps) {
        problems.push({
          kind: "overlap",
          detail: `${name(a.el)} and ${name(b.el)}`,
        });
      }
    }
  }

  // At the very bottom of the page, nothing may be left behind the bar.
  const bar = document.querySelector("[data-pinned]");
  const main = document.querySelector("main");
  if (bar && main && getComputedStyle(bar).top === "auto") {
    const start = window.scrollY;
    window.scrollTo(0, document.documentElement.scrollHeight);
    const barTop = bar.getBoundingClientRect().top;
    const hidden = targets.filter(
      ({ el }) =>
        !isPinned(el) && el.getBoundingClientRect().bottom > barTop + 0.5,
    );
    for (const { el } of hidden) {
      problems.push({ kind: "behind the bottom bar", detail: name(el) });
    }
    window.scrollTo(0, start);
  }
  return problems;
}

async function check(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  const problems = await page.evaluate(findLayoutProblems, MIN_TAP);
  const width = page.viewportSize()!.width;
  await page.screenshot({
    path: test.info().outputPath(`${width}-${label}.png`),
    fullPage: true,
  });
  expect(problems, `${label} at ${width} px`).toEqual([]);
}

async function checkWithMenu(page: Page, label: string) {
  await check(page, label);
  const menu = page.getByRole("button", { name: "Menu" });
  if (await menu.isVisible()) {
    await menu.click();
    await check(page, `${label}-menu`);
  }
}

async function phone(browser: Browser, width: number) {
  const context = await browser.newContext({
    viewport: { width, height: 700 },
  });
  return context.newPage();
}

for (const width of WIDTHS) {
  test.describe(`at ${width} px`, () => {
    let owner: TestUser;
    let staff: TestUser;
    let page: Page;

    test.beforeAll(async ({ browser }) => {
      owner = await createTestUser("owner");
      staff = await createTestUser("staff");
      page = await phone(browser, width);
    });

    test.afterAll(async () => {
      await page.context().close();
      await removeFixtures();
      await deleteCreatedUsers();
    });

    test("signed-out screens", async () => {
      await page.goto("/admin/login");
      await check(page, "login");

      await page.getByRole("button", { name: "Sign in" }).click();
      await page.locator(".field-error").first().waitFor();
      await check(page, "login-error");

      await page.goto("/admin/forgot-password");
      await check(page, "forgot-password");

      await page.goto("/admin/auth/confirm");
      await check(page, "link-bad");

      await page.goto("/admin/auth/confirm?code=not-used");
      await check(page, "link-good");
    });

    test("owner setup and code screens", async ({ browser }) => {
      await signInWithPassword(page, owner);
      await expect(page).toHaveURL(/\/admin\/mfa$/);
      await check(page, "mfa-start");

      await page.getByRole("button", { name: "Start setup" }).click();
      await page.getByTestId("totp-secret").waitFor();
      await check(page, "mfa-enrol");

      await page.goto("/admin/mfa");
      await enrolOwner(page, owner);

      const second = await phone(browser, width);
      await signInWithPassword(second, owner);
      await expect(second).toHaveURL(/\/admin\/mfa$/);
      await check(second, "mfa-verify");
      await second.context().close();
    });

    test("new password screen", async ({ browser }) => {
      const { data, error } = await authAdmin.generateLink({
        type: "recovery",
        email: staff.email,
      });
      if (error) throw error;
      const reset = await phone(browser, width);
      await reset.goto(
        `/admin/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`,
      );
      await reset.getByRole("button", { name: "Continue" }).click();
      await expect(reset).toHaveURL(/\/admin\/new-password$/);
      await check(reset, "new-password");
      await reset.context().close();
    });

    test("owner screens", async () => {
      await page.goto("/admin");
      await checkWithMenu(page, "home");
      await page.goto("/admin/property");
      await checkWithMenu(page, "property");
      await page.goto("/admin/house");
      await checkWithMenu(page, "house");
      await page.goto("/admin/booking");
      await checkWithMenu(page, "booking");
      await page.goto("/admin/account");
      await checkWithMenu(page, "account");
    });

    test("bookings, calendar, prices, guests, messages and reports", async () => {
      test.setTimeout(240_000);
      const room = await createFixtureRoom();
      const stay = await addBooking({
        roomId: room.id,
        checkIn: "2041-03-10",
        checkOut: "2041-03-14",
        name: "A guest with quite a long name indeed",
        email: "a.long.address.for.a.guest@example.test",
        notes: "Private note",
        totalCents: 123400,
      });
      await addPayment(stay, 23400);
      const event = await addExternal(room.airbnb, "2041-03-20", "2041-03-23");
      const message = await addMessage({
        name: "Someone",
        email: "someone@example.test",
        message: "A question about the house.",
      });

      for (const [label, path] of [
        ["bookings", "/admin/bookings"],
        ["bookings-past", "/admin/bookings?tab=past"],
        ["new-booking", "/admin/bookings/new"],
        ["booking", `/admin/bookings/${stay}`],
        ["change-dates", `/admin/bookings/${stay}/change`],
        ["cancel", `/admin/bookings/${stay}/cancel`],
        ["imported", `/admin/bookings/external/${event}`],
        ["calendar", "/admin/calendar?month=2041-03"],
        ["rates", "/admin/rates?month=2041-03"],
        ["seasons", "/admin/rates/seasons"],
        ["restrictions", "/admin/rates/restrictions"],
        ["fees", "/admin/rates/fees"],
        ["promos", "/admin/rates/promos"],
        ["guests", "/admin/guests"],
        ["messages", "/admin/messages"],
        ["message", `/admin/messages/${message}`],
        ["reports", "/admin/reports?year=2041&month=3"],
        ["reports-year", "/admin/reports?year=2041&month=all"],
      ]) {
        await page.goto(path);
        await check(page, label);
      }
      await removeFixtures();
    });

    test("rules screen in every state", async () => {
      await page.goto("/admin/rules");
      await checkWithMenu(page, "rules");

      await page.reload();
      await page.getByRole("radio", { name: /^Deposit/ }).check();
      await page.getByLabel(/^Deposit, as a percentage/).fill("30");
      await check(page, "rules-preview");
      await page.getByLabel(/^Deposit, as a percentage/).fill("");
      await page.getByLabel("No refunds, ever").uncheck();
      await page.getByRole("button", { name: "Add a line" }).click();
      await check(page, "rules-tiers");

      await page.getByRole("button", { name: "Save", exact: true }).click();
      await page.locator(".field-error").first().waitFor();
      await check(page, "rules-errors");
    });

    test("staff screens", async ({ browser }) => {
      const staffPage = await phone(browser, width);
      await signInWithPassword(staffPage, staff);
      await expect(staffPage).toHaveURL(/\/admin$/);
      await checkWithMenu(staffPage, "staff-home");

      await staffPage.goto("/admin/rules");
      await expect(staffPage).toHaveURL(/\/admin\/not-allowed$/);
      await checkWithMenu(staffPage, "not-allowed");

      await staffPage.goto("/admin/account/two-step");
      await check(staffPage, "two-step");
      await staffPage.context().close();
    });
  });
}
