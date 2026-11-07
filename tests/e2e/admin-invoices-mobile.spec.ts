import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  createTestUser,
  deleteCreatedUsers,
  enrolOwner,
  signInWithPassword,
  testAddress,
  type TestUser,
} from "./admin-helpers";
import {
  cleanUpInvoices,
  ensureInvoicing,
  freshMonth,
  issuedDocument,
  paidBooking,
  type Fixture,
} from "./invoice-helpers";

// Every invoice screen at phone and tablet widths, with the same checks as
// admin-mobile.spec.ts.

test.describe.configure({ mode: "serial" });

const WIDTHS = [320, 375, 768];
const MIN_TAP = 44;

interface LayoutProblem {
  kind: string;
  detail: string;
}

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
      const small = el.matches("input[type=radio], input[type=checkbox]");
      const target = small ? (el.closest("label") ?? el) : el;
      return { el: target, box: target.getBoundingClientRect() };
    })
    // checkVisibility also skips what is inside a closed <details>.
    .filter(({ el, box }) => box.width > 0 && el.checkVisibility());

  for (const { el, box } of targets) {
    if (box.height < minTap - 0.5 || box.width < minTap - 0.5) {
      problems.push({
        kind: "small target",
        detail: `${name(el)} ${Math.round(box.width)}x${Math.round(box.height)}`,
      });
    }
  }

  for (let i = 0; i < targets.length; i += 1) {
    for (let j = i + 1; j < targets.length; j += 1) {
      const [a, b] = [targets[i], targets[j]];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
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
  return problems;
}

async function check(page: Page, label: string) {
  await page.waitForLoadState("networkidle");
  // The bar sticks over the list while scrolling, on purpose. At the bottom of
  // the page it sits in its own place, where anything overlapping is a fault.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const problems = await page.evaluate(findLayoutProblems, MIN_TAP);
  const width = page.viewportSize()!.width;
  await page.screenshot({
    path: test.info().outputPath(`${width}-${label}.png`),
    fullPage: true,
  });
  expect(problems, `${label} at ${width} px`).toEqual([]);
}

async function phone(browser: Browser, width: number) {
  const context = await browser.newContext({
    viewport: { width, height: 700 },
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  return context.newPage();
}

let owner: TestUser;

test.beforeAll(async () => {
  await ensureInvoicing();
});

test.afterAll(async () => {
  await cleanUpInvoices();
  await deleteCreatedUsers();
});

for (const width of WIDTHS) {
  test.describe(`at ${width} px`, () => {
    const month = freshMonth(width);
    let page: Page;
    let first: Fixture;
    let second: Fixture;
    let missing: Fixture;
    let paymentId: string;

    test.beforeAll(async ({ browser }) => {
      owner = await createTestUser("owner");
      page = await phone(browser, width);
      await signInWithPassword(page, owner);
      await enrolOwner(page, owner);
      first = await issuedDocument(month, {
        guest: "Κωνσταντίνα Παπαδημητροπούλου-Αλεξανδροπούλου",
      });
      second = await issuedDocument(month);
      missing = await issuedDocument(month, { withPdf: false });
      paymentId = (await paidBooking()).paymentId;
    });

    test.afterAll(async () => {
      await page.context().close();
    });

    test("the list, closed and open", async () => {
      await page.goto(`/admin/invoices?month=${month}&guest=`);
      await check(page, "list-filters-open");

      await page.goto("/admin/invoices");
      await check(page, "list");
      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    });

    test("the rows are cards on a phone", async () => {
      await page.goto(`/admin/invoices?month=${month}`);
      const thead = page.locator(".inv-table thead");
      await expect(thead).toBeHidden();
      const box = await page
        .getByRole("checkbox", { name: `Select ${first.number}` })
        .evaluate((input) => {
          const rect = input.closest("label")!.getBoundingClientRect();
          return { width: rect.width, height: rect.height };
        });
      expect(box.width).toBeGreaterThanOrEqual(MIN_TAP);
      expect(box.height).toBeGreaterThanOrEqual(MIN_TAP);
    });

    test("the selection bar, with warnings", async () => {
      await page.goto(`/admin/invoices?month=${month}`);
      for (const fixture of [first, second, missing]) {
        await page
          .getByRole("checkbox", { name: `Select ${fixture.number}` })
          .check();
      }
      const bar = page.getByTestId("selection-bar");
      await expect(bar).toContainText("3 selected");
      await check(page, "selection-bar");

      await bar.getByRole("button", { name: "Download" }).click();
      await expect(bar.getByRole("alert")).toContainText(missing.number);
      await check(page, "selection-warning");

      await bar.getByRole("button", { name: "Mark as sent" }).first().click();
      await expect(
        bar.getByLabel("The accountant has these documents"),
      ).toBeVisible();
      await check(page, "selection-mark");

      await bar.getByRole("button", { name: "Clear" }).last().click();
    });

    test("the bar stays in view while the list scrolls", async () => {
      await page.goto(`/admin/invoices?month=${month}`);
      await page
        .getByRole("checkbox", { name: `Select ${first.number}` })
        .check();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.evaluate(() => window.scrollBy(0, 300));
      const bar = page.getByTestId("selection-bar");
      await expect(bar).toBeInViewport();
      await bar.getByRole("button", { name: "Clear" }).click();
    });

    test("a document, and one with its PDF missing", async () => {
      await page.goto(`/admin/invoices/${first.id}`);
      await check(page, "detail");
      await page.goto(`/admin/invoices/${missing.id}`);
      await check(page, "detail-missing");
    });

    test("issuing", async () => {
      await page.goto("/admin/invoices/issue");
      await check(page, "issue-list");

      await page.goto(`/admin/invoices/issue/${paymentId}`);
      await check(page, "issue-form");
      await page.getByRole("radio", { name: /^Invoice/ }).check();
      await page.getByRole("button", { name: "Issue the document" }).click();
      await page.locator(".field-error").first().waitFor();
      await check(page, "issue-errors");

      const unreadable = await paidBooking({ guest: "अनिता शर्मा" });
      await page.goto(`/admin/invoices/issue/${unreadable.paymentId}`);
      await expect(page.getByTestId("name-warning")).toBeVisible();
      await check(page, "issue-name-warning");
    });

    test("a credit note", async () => {
      await page.goto(`/admin/invoices/${first.id}/credit`);
      await check(page, "credit");
    });

    test("the accountant's month", async () => {
      await page.goto(`/admin/invoices/export?month=${month}`);
      await check(page, "export");
    });

    test("settings", async () => {
      await page.goto("/admin/invoices/settings");
      await check(page, "settings");
    });
  });
}
