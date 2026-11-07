import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import ExcelJS from "exceljs";
import { strFromU8, unzipSync } from "fflate";
import { SELECTION_LIMIT } from "@/lib/invoicing/filters";
import { zipEntryName } from "@/lib/invoicing/format";
import { PROVISIONAL_NOTE } from "@/lib/invoicing/workbook";
import { pdfText } from "../pdf-text";
import { columnOf, readWorkbook, rowStarting } from "../read-xlsx";
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
  addPayment,
  BOOKING_TOTAL,
  bulkDocuments,
  cancelWithRefund,
  cleanUpInvoices,
  ensureInvoicing,
  freshMonth,
  invoiceRow,
  issuedDocument,
  paidBooking,
  setBreakdown,
  setStatus,
  storage,
  VAT_BREAKDOWN,
  type Fixture,
} from "./invoice-helpers";
import { locales, publicPaths } from "./helpers";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 375, height: 812 } });

const squeezed = (text: string) => text.replace(/\s+/g, "");

const context = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    viewport: { width: 375, height: 812 },
  });

interface CapturedAction {
  action: string;
  contentType: string;
  body: Buffer;
}

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

function replay(
  request: APIRequestContext,
  path: string,
  { action, contentType, body }: CapturedAction,
) {
  return request.post(path, {
    headers: {
      "next-action": action,
      "content-type": contentType,
      origin: test.info().project.use.baseURL!,
    },
    data: body,
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

/** Posts ids exactly as the selection bar's form does. */
function postIds(request: APIRequestContext, ids: string[]) {
  const form = new URLSearchParams(ids.map((id) => ["id", id]));
  return request.post("/admin/invoices/export/download", {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    data: form.toString(),
    maxRedirects: 0,
  });
}

const bytesOf = async (download: Download) =>
  readFileSync(await download.path());

async function save(page: Page, click: () => Promise<void>) {
  const pending = page.waitForEvent("download");
  await click();
  return pending;
}

const entry = (document: { number: string; id: string }) =>
  zipEntryName(document.number, document.id);

const ExcelValueType = ExcelJS.ValueType;

/** The Documents sheet of the Excel file inside a downloaded ZIP. */
async function sheetIn(files: Record<string, Uint8Array>) {
  const name = Object.keys(files).find((file) => file.endsWith(".xlsx"))!;
  return (await readWorkbook(files[name])).getWorksheet("Documents")!;
}

/** The first column of every document row, without the header or totals. */
function documentNumbers(sheet: ExcelJS.Worksheet): string[] {
  const numbers: string[] = [];
  sheet.eachRow((row, index) => {
    const value = String(row.getCell(1).value);
    if (index > 1 && value !== "Σύνολο / Total") numbers.push(value);
  });
  return numbers;
}

/**
 * Takes the shared lock, and hands back what puts the setting as it was. Only
 * the tests that write the setting need this, so the rest can run in parallel.
 */
async function borrowSettings(): Promise<() => Promise<void>> {
  await lockSharedSettings();
  const { rows } = await db.query(
    `select value from public.settings where key = 'invoicing'`,
  );
  return async () => {
    await db.query(
      `update public.settings set value = $1::jsonb where key = 'invoicing'`,
      [JSON.stringify(rows[0].value)],
    );
    await releaseSharedSettings();
  };
}

let owner: TestUser;
let staff: TestUser;
let page: Page;
let staffContext: BrowserContext;
let aal1Context: BrowserContext;

test.beforeAll(async ({ browser }) => {
  await ensureInvoicing();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");

  page = await (await context(browser)).newPage();
  await signInWithPassword(page, owner);
  await enrolOwner(page, owner);

  staffContext = await context(browser);
  const staffPage = await staffContext.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);

  aal1Context = await context(browser);
  const aal1Page = await aal1Context.newPage();
  await signInWithPassword(aal1Page, owner);
  await expect(aal1Page).toHaveURL(/\/admin\/mfa$/);
});

test.afterAll(async () => {
  await cleanUpInvoices();
  await deleteCreatedUsers();
});

async function issueFromAdmin(booking: { reference: string }) {
  await page.goto(`/admin/invoices/issue?q=${booking.reference}`);
  await page
    .getByRole("link", { name: new RegExp(`^Choose ${booking.reference}`) })
    .click();
  await expect(page).toHaveURL(/\/admin\/invoices\/issue\/[0-9a-f-]{36}$/);
}

const documentId = () => page.url().split("/").at(-1)!.split("?")[0];

test.describe("issuing", () => {
  let booking: Awaited<ReturnType<typeof paidBooking>>;
  let id: string;

  test("the Owner issues a receipt and the PDF is in the bucket", async () => {
    booking = await paidBooking({ guest: "Μαρία Παπαδοπούλου" });
    await issueFromAdmin(booking);
    await expect(page.getByText("Διαμονή / Accommodation")).toBeVisible();
    await page.getByRole("button", { name: "Issue the document" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    id = documentId();

    const row = await invoiceRow(id);
    expect(row).toMatchObject({
      doc_type: "receipt",
      status: "issued",
      is_provisional: true,
      total_cents: BOOKING_TOTAL,
      fee_cents: 400,
      issued_by: owner.id,
      payment_id: booking.paymentId,
    });
    expect(row.pdf_path).toMatch(new RegExp(`^\\d{4}/\\d{2}/${id}\\.pdf$`));
    const { data, error } = await storage.download(row.pdf_path);
    expect(error).toBeNull();
    expect(data!.size).toBeGreaterThan(1000);
  });

  test("the stored PDF carries the mark and the Greek, as text", async () => {
    const row = await invoiceRow(id);
    const { data } = await storage.download(row.pdf_path);
    const text = squeezed(
      await pdfText(new Uint8Array(await data!.arrayBuffer())),
    );
    for (const wanted of [
      "PROVISIONAL, NOT A TAX DOCUMENT",
      "ΠΡΟΣΩΡΙΝΟ, ΟΧΙ ΦΟΡΟΛΟΓΙΚΟ ΠΑΡΑΣΤΑΤΙΚΟ",
      "Μαρία Παπαδοπούλου",
      "Διαμονή / Accommodation",
      booking.reference,
    ]) {
      expect(text).toContain(squeezed(wanted));
    }
  });

  test("the payment leaves the list, and cannot get a second document", async () => {
    await page.goto(`/admin/invoices/issue?q=${booking.reference}`);
    await expect(page.getByRole("link", { name: /^Choose / })).toHaveCount(0);

    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await expect(page).toHaveURL(new RegExp(`/admin/invoices/${id}$`));
    await expect(
      page.getByRole("button", { name: "Issue the document" }),
    ).toHaveCount(0);
    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where payment_id = $1`,
      [booking.paymentId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("Open PDF gives a working, short-lived signed link", async () => {
    const response = await page
      .context()
      .request.get(`/admin/invoices/${id}/pdf`, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const url = response.headers().location;
    expect(url).toContain("/storage/v1/object/sign/invoices/");

    const file = await fetch(url);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toContain("application/pdf");
    // Local storage may send no header at all. It must never allow caching.
    expect(file.headers.get("cache-control") ?? "").not.toMatch(
      /public|max-age=[1-9]/,
    );

    const token = new URL(url).searchParams.get("token")!;
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString(),
    );
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
  });

  test("a signed link really stops working when it expires", async () => {
    const row = await invoiceRow(id);
    const { data, error } = await storage.createSignedUrl(row.pdf_path, 1);
    expect(error).toBeNull();
    expect((await fetch(data!.signedUrl)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect((await fetch(data!.signedUrl)).status).toBeGreaterThanOrEqual(400);
  });

  test("the bucket cannot be read without a signed link", async () => {
    const row = await invoiceRow(id);
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const response = await fetch(
      `${base}/storage/v1/object/public/invoices/${row.pdf_path}`,
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  test("an invoice needs company details, and shows them", async () => {
    const company = await paidBooking();
    await issueFromAdmin(company);
    await page.getByRole("radio", { name: /^Invoice/ }).check();
    await page.getByRole("button", { name: "Issue the document" }).click();
    await expect(page.locator(".field-error").first()).toBeVisible();
    expect(
      (
        await db.query(
          `select count(*)::int as n from public.invoices where payment_id = $1`,
          [company.paymentId],
        )
      ).rows[0].n,
    ).toBe(0);

    await page.getByLabel("Company name").fill("ΔΟΚΙΜΗ Α.Ε.");
    await page.getByLabel("VAT number").fill("123456789");
    await page.getByLabel("Address").fill("Αθήνα 1");
    await page.getByLabel("Tax office").fill("Α' Αθηνών");
    await page.getByRole("button", { name: "Issue the document" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    const row = await invoiceRow(documentId());
    expect(row.doc_type).toBe("invoice");
    expect(row.customer).toMatchObject({
      companyName: "ΔΟΚΙΜΗ Α.Ε.",
      vatNumber: "123456789",
      taxOffice: "Α' Αθηνών",
    });
  });

  test("a deposit is one line, flagged for the accountant", async () => {
    const deposit = await paidBooking({ kind: "deposit", amountCents: 12000 });
    await issueFromAdmin(deposit);
    await expect(page.getByText(/For the accountant to confirm/)).toBeVisible();
    await page.getByRole("button", { name: "Issue the document" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    const { rows } = await db.query(
      `select kind, total_cents from public.invoice_lines where invoice_id = $1`,
      [documentId()],
    );
    expect(rows).toEqual([
      { kind: "deposit", total_cents: 11888 },
      { kind: "fee", total_cents: 112 },
    ]);
  });

  test("a lost PDF shows, and comes back byte for byte", async () => {
    const row = await invoiceRow(id);
    const { data } = await storage.download(row.pdf_path);
    const before = Buffer.from(await data!.arrayBuffer());

    await storage.remove([row.pdf_path]);
    await db.query(`select public.attach_invoice_pdf($1, null)`, [id]);

    await page.goto(`/admin/invoices?booking=${booking.reference}`);
    await expect(page.locator(".inv-badge-bad")).toHaveText("PDF missing");
    await expect(page.getByRole("link", { name: /Download PDF/ })).toHaveCount(
      0,
    );

    const numberBefore = (await invoiceRow(id)).number;
    await page.goto(`/admin/invoices/${id}`);
    await expect(page.getByTestId("pdf-missing")).toBeVisible();
    await page.getByRole("button", { name: "Make the PDF again" }).click();
    await expect(page.getByText("The PDF is ready.")).toBeVisible();

    const after = await invoiceRow(id);
    expect(after.number).toBe(numberBefore);
    const again = await storage.download(after.pdf_path);
    const bytes = Buffer.from(await again.data!.arrayBuffer());
    const sha = (value: Buffer) =>
      createHash("sha256").update(value).digest("hex");
    expect(sha(bytes)).toBe(sha(before));

    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where payment_id = $1`,
      [booking.paymentId],
    );
    expect(rows[0].n).toBe(1);
  });

  test("a file that vanished from the bucket offers the same repair", async () => {
    const issued = await issuedDocument(freshMonth(1));
    await storage.remove([issued.pdfPath!]);
    await page.goto(`/admin/invoices/${issued.id}/pdf`);
    await expect(page).toHaveURL(/\?pdf=missing$/);
    await page.getByRole("button", { name: "Make the PDF again" }).click();
    await expect(page.getByText("The PDF is ready.")).toBeVisible();
    expect((await storage.download(issued.pdfPath!)).error).toBeNull();
  });
});

test.describe("credit notes", () => {
  let original: Fixture;

  test.beforeAll(async () => {
    original = await issuedDocument(freshMonth(2));
  });

  test("the database refuses more than the document", async () => {
    await page.goto(`/admin/invoices/${original.id}/credit`);
    await page.getByLabel(/^Amount to credit/).fill("999999");
    await page.getByLabel("Reason").fill("Too much");
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      "more than is left to credit",
    );
    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where credits_invoice_id = $1`,
      [original.id],
    );
    expect(rows[0].n).toBe(0);
  });

  test("a reason is required", async () => {
    await page.goto(`/admin/invoices/${original.id}/credit`);
    await page.getByLabel(/^Amount to credit/).fill("10");
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page.locator(".field-error")).toBeVisible();
  });

  test("a part credit links both ways and has its own PDF", async () => {
    await page.goto(`/admin/invoices/${original.id}/credit`);
    await page.getByLabel(/^Amount to credit/).fill("100,50");
    await page.getByLabel("Reason").fill("Μερική επιστροφή");
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);

    const creditId = documentId();
    expect(creditId).not.toBe(original.id);
    const credit = await invoiceRow(creditId);
    expect(credit).toMatchObject({
      doc_type: "credit_note",
      credits_invoice_id: original.id,
      total_cents: 10050,
      reason: "Μερική επιστροφή",
      is_provisional: true,
    });

    await expect(
      page.getByRole("link", { name: original.number }),
    ).toBeVisible();
    await page.getByRole("link", { name: original.number }).click();
    await expect(page).toHaveURL(new RegExp(original.id));
    await expect(page.getByText(/Credited so far: 100,50 €/)).toBeVisible();

    const { data } = await storage.download(credit.pdf_path);
    const text = squeezed(
      await pdfText(new Uint8Array(await data!.arrayBuffer())),
    );
    expect(text).toContain(squeezed("ΠΙΣΤΩΤΙΚΟ / CREDIT NOTE"));
    expect(text).toContain(original.number);
    expect(text).toContain(squeezed("Μερική επιστροφή"));
    expect(text).toContain(squeezed("PROVISIONAL, NOT A TAX DOCUMENT"));
  });

  test("the rest can be credited, then nothing is left", async () => {
    await page.goto(`/admin/invoices/${original.id}/credit`);
    await expect(page.getByLabel(/^Amount to credit/)).toHaveValue("327,50");
    await page.getByLabel("Reason").fill("Ακύρωση");
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);

    await page.goto(`/admin/invoices/${original.id}`);
    await expect(
      page.getByRole("link", { name: "Issue a credit note" }),
    ).toHaveCount(0);
    await page.goto(`/admin/invoices/${original.id}/credit`);
    await expect(page.getByText("already been fully credited")).toBeVisible();
  });

  test("an issued document cannot be changed behind the screens", async () => {
    await expect(
      db.query(`update public.invoices set total_cents = 1 where id = $1`, [
        original.id,
      ]),
    ).rejects.toThrow("issued_invoice_immutable");
  });
});

test.describe("the list", () => {
  const month = freshMonth(3);
  const otherMonth = freshMonth(4);
  let first: Fixture;
  let second: Fixture;
  let elsewhere: Fixture;

  test.beforeAll(async () => {
    first = await issuedDocument(month, { guest: "Αλέξης Φίλτρου" });
    second = await issuedDocument(month, { guest: "Beta Filter" });
    elsewhere = await issuedDocument(otherMonth, { guest: "Αλέξης Άλλος" });
  });

  const shows = (fixture: Fixture) => page.getByTestId(`row-${fixture.number}`);

  test("by month, with totals and the filter in the address", async () => {
    await page.goto("/admin/invoices");
    await page.getByText("Search and filter").click();
    await page.getByLabel("Month").fill(month);
    await page.getByRole("button", { name: "Show results" }).click();
    await expect(page).toHaveURL(new RegExp(`month=${month}`));
    await expect(shows(first)).toBeVisible();
    await expect(shows(second)).toBeVisible();
    await expect(shows(elsewhere)).toHaveCount(0);
    const totals = page.getByTestId("totals");
    await expect(totals).toContainText("856,00 €");
  });

  test("a shared link opens the same view", async () => {
    await page.goto(`/admin/invoices?month=${otherMonth}`);
    await expect(shows(elsewhere)).toBeVisible();
    await expect(shows(first)).toHaveCount(0);
  });

  test("by guest, ignoring Greek accents", async () => {
    await page.goto(`/admin/invoices?month=${month}&guest=ΦΙΛΤΡΟΥ`);
    await expect(shows(first)).toBeVisible();
    await expect(shows(second)).toHaveCount(0);
  });

  test("by booking and by transaction", async () => {
    await page.goto(`/admin/invoices?booking=${first.reference}`);
    await expect(shows(first)).toBeVisible();
    await expect(shows(second)).toHaveCount(0);

    await page.goto(`/admin/invoices?transaction=${second.intent}`);
    await expect(shows(second)).toBeVisible();
    await expect(shows(first)).toHaveCount(0);
  });

  test("by date range, type, method and sent", async () => {
    await page.goto(
      `/admin/invoices?from=${month}-14&to=${month}-16&type=receipt&method=card&sent=no`,
    );
    await expect(shows(first)).toBeVisible();

    for (const query of [
      `from=${month}-20`,
      `to=${month}-10&month=${month}`,
      `month=${month}&type=invoice`,
      `month=${month}&method=cash`,
      `month=${month}&sent=yes`,
    ]) {
      await page.goto(`/admin/invoices?${query}`);
      await expect(shows(first), query).toHaveCount(0);
    }
  });

  test("a bad filter still opens the list", async () => {
    const response = await page.goto(
      "/admin/invoices?month=nope&page=-1&type=x",
    );
    expect(response!.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});

test.describe("downloading", () => {
  const month = freshMonth(5);
  let first: Fixture;
  let second: Fixture;
  let third: Fixture;

  test.beforeAll(async () => {
    first = await issuedDocument(month);
    second = await issuedDocument(month);
    third = await issuedDocument(month, { withPdf: false });
  });

  const tick = (fixture: Fixture) =>
    page.getByRole("checkbox", { name: `Select ${fixture.number}` });
  const bar = () => page.getByTestId("selection-bar");
  const clear = async () => {
    if (await bar().isVisible()) {
      await bar().getByRole("button", { name: "Clear" }).click();
    }
  };

  test("one document from the list, named by its number", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    const download = await save(page, () =>
      page.getByRole("link", { name: `Download PDF ${first.number}` }).click(),
    );
    expect(download.suggestedFilename()).toBe(`${first.number}.pdf`);
    expect(squeezed(await pdfText(await bytesOf(download)))).toContain(
      squeezed("PROVISIONAL, NOT A TAX DOCUMENT"),
    );
  });

  test("one document from its own page", async () => {
    await page.goto(`/admin/invoices/${first.id}`);
    const download = await save(page, () =>
      page.getByRole("link", { name: "Download PDF" }).click(),
    );
    expect(download.suggestedFilename()).toBe(`${first.number}.pdf`);
  });

  test("the bar counts and adds up, and Clear empties it", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await expect(bar()).toHaveCount(0);
    await tick(first).check();
    await expect(bar()).toContainText("1 selected");
    await expect(bar()).toContainText("428,00 €");
    await tick(second).check();
    await expect(bar()).toContainText("2 selected");
    await expect(bar()).toContainText("856,00 €");
    await tick(second).uncheck();
    await expect(bar()).toContainText("1 selected");
    await bar().getByRole("button", { name: "Clear" }).click();
    await expect(bar()).toHaveCount(0);
  });

  test("one selected downloads as its PDF", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(second).check();
    const download = await save(page, () =>
      bar().getByRole("button", { name: "Download" }).click(),
    );
    expect(download.suggestedFilename()).toBe(`${second.number}.pdf`);
    await clear();
  });

  test("several selected download as a ZIP of just those", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(first).check();
    await tick(second).check();
    const download = await save(page, () =>
      bar().getByRole("button", { name: "Download" }).click(),
    );
    expect(download.suggestedFilename()).toMatch(
      /^casa-filakopi-invoices-selection-.+\.zip$/,
    );

    const files = unzipSync(await bytesOf(download));
    const names = Object.keys(files);
    expect(names).toContain(entry(first));
    expect(names).toContain(entry(second));
    expect(names).toHaveLength(3);
    expect(names.find((name) => name.endsWith(".xlsx"))).toMatch(
      /^casa-filakopi-invoices-selection-.+\.xlsx$/,
    );
    expect(names.some((name) => name.endsWith(".csv"))).toBe(false);

    const sheet = await sheetIn(files);
    expect(documentNumbers(sheet).sort()).toEqual(
      [first.number, second.number].sort(),
    );

    // Downloading never marks anything as sent.
    expect((await invoiceRow(first.id)).exported_at).toBeNull();
    await clear();
  });

  test("a missing PDF is named first, and stays in the ZIP's records", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(first).check();
    await tick(third).check();
    await bar().getByRole("button", { name: "Download" }).click();
    await expect(bar().getByRole("alert")).toContainText("These have no PDF");
    await expect(bar().getByRole("alert")).toContainText(third.number);

    const download = await save(page, () =>
      bar().getByRole("button", { name: "Download anyway" }).click(),
    );
    const files = unzipSync(await bytesOf(download));
    expect(Object.keys(files)).toContain(entry(first));
    expect(Object.keys(files)).not.toContain(entry(third));
    expect(strFromU8(files["PDF-MISSING.txt"])).toContain(third.number);
    const sheet = await sheetIn(files);
    expect(
      rowStarting(sheet, third.number).getCell(columnOf(sheet, "PDF")).value,
    ).toContain("PDF missing");
    expect(
      rowStarting(sheet, first.number).getCell(columnOf(sheet, "PDF")).value,
    ).toBe(entry(first));
    await clear();
  });

  test("selecting only a missing PDF offers no empty download", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(third).check();
    await bar().getByRole("button", { name: "Download" }).click();
    await expect(bar().getByText("has no PDF yet")).toBeVisible();
    await expect(
      bar().getByRole("button", { name: "Download anyway" }),
    ).toHaveCount(0);
    await clear();
  });

  test("Mark as sent is its own step, and needs the tick", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(first).check();
    await tick(third).check();
    await bar().getByRole("button", { name: "Mark as sent" }).click();
    await bar()
      .locator("form")
      .getByRole("button", { name: "Mark as sent" })
      .click();
    await expect(bar().getByText("Please tick this box first.")).toBeVisible();
    expect((await invoiceRow(first.id)).exported_at).toBeNull();

    await bar().getByLabel("The accountant has these documents").check();
    await bar()
      .locator("form")
      .getByRole("button", { name: "Mark as sent" })
      .click();
    await expect(bar().getByText(/1 document marked as sent/)).toBeVisible();
    await expect(bar().getByText(/1 document with no PDF/)).toBeVisible();
    expect((await invoiceRow(first.id)).exported_at).not.toBeNull();
    expect((await invoiceRow(third.id)).exported_at).toBeNull();
    await clear();
  });

  test("a document already sent is warned about, but allowed", async () => {
    const sentAt = (await invoiceRow(first.id)).exported_at;
    await page.goto(`/admin/invoices?month=${month}`);
    await expect(page.getByTestId(`row-${first.number}`)).toContainText(
      "Sent to accountant",
    );
    await tick(first).check();
    await tick(second).check();
    await bar().getByRole("button", { name: "Download" }).click();
    await expect(
      bar().getByText("Already sent to the accountant"),
    ).toBeVisible();
    await expect(bar()).toContainText(first.number);

    const download = await save(page, () =>
      bar().getByRole("button", { name: "Download anyway" }).click(),
    );
    expect(Object.keys(unzipSync(await bytesOf(download)))).toContain(
      entry(first),
    );

    // Marking again changes the new one and keeps the first date.
    await bar().getByRole("button", { name: "Mark as sent" }).first().click();
    await bar().getByLabel("The accountant has these documents").check();
    await bar()
      .locator("form")
      .getByRole("button", { name: "Mark as sent" })
      .click();
    await expect(bar().getByText(/1 document marked as sent/)).toBeVisible();
    expect((await invoiceRow(first.id)).exported_at).toEqual(sentAt);
    expect((await invoiceRow(second.id)).exported_at).not.toBeNull();
    await clear();
  });

  test("a selection survives moving between pages", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await tick(first).check();
    await page.goto(`/admin/invoices?month=${month}&type=receipt`);
    await expect(bar()).toContainText("1 selected");
    await clear();
  });
});

test.describe("select all", () => {
  const month = freshMonth(6);
  const crowded = freshMonth(7);
  const rows: Fixture[] = [];

  test.beforeAll(async () => {
    // More than one page. Only some have a PDF, to keep the run quick.
    for (let i = 0; i < 27; i += 1) {
      rows.push(await issuedDocument(month, { withPdf: i < 2 }));
    }
    await bulkDocuments(crowded, SELECTION_LIMIT + 1);
  });

  test("covers every page of results, not just this one", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    await expect(page.getByText("Page 1 of 2")).toBeVisible();
    await page.getByRole("button", { name: "Select this page" }).click();
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("25 selected");

    await page
      .getByRole("button", { name: "Select all 27 matching this filter" })
      .click();
    await expect(bar).toContainText("27 selected");
    await expect(bar).toContainText("11.556,00 €");

    await bar.getByRole("button", { name: "Download" }).click();
    const download = await save(page, () =>
      bar.getByRole("button", { name: "Download anyway" }).click(),
    );
    const files = unzipSync(await bytesOf(download));
    const sheet = await sheetIn(files);
    expect(documentNumbers(sheet)).toHaveLength(27);
    const totals = rowStarting(sheet, "Σύνολο / Total");
    expect(totals.getCell(columnOf(sheet, "Σύνολο / Total")).result).toBe(
      11556,
    );
    expect(strFromU8(files["PDF-MISSING.txt"])).toContain(rows[26].number);
    expect(Object.keys(files).filter((n) => n.endsWith(".pdf"))).toHaveLength(
      2,
    );
    await bar.getByRole("button", { name: "Clear" }).click();
  });

  test("the limit gives a plain message and selects nothing", async () => {
    await page.goto(`/admin/invoices?month=${crowded}`);
    await page
      .getByRole("button", {
        name: `Select all ${SELECTION_LIMIT + 1} matching this filter`,
      })
      .click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      `${SELECTION_LIMIT} is the most at one time`,
    );
    await expect(page.getByTestId("selection-bar")).toHaveCount(0);
  });

  test("the server holds the limit too", async () => {
    const ids = Array.from({ length: SELECTION_LIMIT + 1 }, () => randomUUID());
    const response = await postIds(page.context().request, ids);
    expect(response.status()).toBe(400);
  });
});

test.describe("the accountant's month", () => {
  const month = freshMonth(8);
  let first: Fixture;
  let second: Fixture;
  let missing: Fixture;

  test.beforeAll(async () => {
    first = await issuedDocument(month, { guest: "=cmd|Χρήστης" });
    second = await issuedDocument(month);
    missing = await issuedDocument(month, { withPdf: false });
  });

  test("warns about the missing PDF by name", async () => {
    await page.goto(`/admin/invoices/export?month=${month}`);
    await expect(page.getByText("3 documents this month.")).toBeVisible();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      missing.number,
    );
  });

  test("the ZIP has the right files and a real Excel file", async () => {
    await page.goto(`/admin/invoices/export?month=${month}`);
    await expect(page.getByText(/an Excel file/)).toBeVisible();
    await expect(page.getByText(/csv/i)).toHaveCount(0);
    const download = await save(page, () =>
      page.getByRole("link", { name: "Download ZIP" }).click(),
    );
    expect(download.suggestedFilename()).toBe(
      `casa-filakopi-invoices-${month}.zip`,
    );

    const files = unzipSync(await bytesOf(download));
    expect(Object.keys(files).sort()).toEqual(
      [
        entry(first),
        entry(second),
        "PDF-MISSING.txt",
        `casa-filakopi-invoices-${month}.xlsx`,
      ].sort(),
    );

    const workbook = await readWorkbook(
      files[`casa-filakopi-invoices-${month}.xlsx`],
    );
    const sheet = workbook.getWorksheet("Documents")!;
    expect(documentNumbers(sheet)).toHaveLength(3);

    // A guest's name that looks like a formula stays exactly as typed.
    const hostile = rowStarting(sheet, first.number).getCell(
      columnOf(sheet, "Πελάτης / Customer"),
    );
    expect(hostile.type).toBe(ExcelValueType.String);
    expect(hostile.value).toBe("=cmd|Χρήστης");

    // Real numbers and dates, not text.
    const line = rowStarting(sheet, second.number);
    const amount = line.getCell(columnOf(sheet, "Σύνολο / Total"));
    expect(amount.type).toBe(ExcelValueType.Number);
    expect(amount.value).toBe(428);
    const date = line.getCell(columnOf(sheet, "Ημερομηνία / Date"));
    expect(date.type).toBe(ExcelValueType.Date);
    expect((date.value as Date).toISOString().slice(0, 7)).toBe(month);

    // The totals are the database's own figures.
    const { rows } = await db.query(
      `select sum(net_cents)::int as net, sum(vat_cents)::int as vat,
         sum(fee_cents)::int as fee, sum(total_cents)::int as total
       from public.invoices where id = any($1::uuid[])`,
      [[first.id, second.id, missing.id]],
    );
    const totals = rowStarting(sheet, "Σύνολο / Total");
    for (const [title, cents] of [
      ["Καθαρό / Net", rows[0].net],
      ["ΦΠΑ / VAT", rows[0].vat],
      ["Τέλη εκτός ΦΠΑ / Fees outside VAT", rows[0].fee],
      ["Σύνολο / Total", rows[0].total],
    ] as const) {
      expect(totals.getCell(columnOf(sheet, title)).result, title).toBe(
        cents / 100,
      );
    }

    // The Summary agrees, and says what the file covers.
    const summary = workbook.getWorksheet("Summary")!;
    const cover: unknown[] = [];
    summary.eachRow((row) => cover.push(row.getCell(1).value));
    expect(cover).toContain(`Μήνας / Month: ${month}`);
    expect(cover).toContain(PROVISIONAL_NOTE);
    expect(rowStarting(summary, "Απόδειξη / Receipt").getCell(6).value).toBe(
      rows[0].total / 100,
    );

    // The same PDF as in the bucket.
    const stored = await storage.download(first.pdfPath!);
    expect(
      Buffer.compare(
        Buffer.from(await stored.data!.arrayBuffer()),
        Buffer.from(files[entry(first)]),
      ),
    ).toBe(0);
  });

  test("downloading marks nothing; marking is a separate step", async () => {
    expect((await invoiceRow(first.id)).exported_at).toBeNull();

    await page.goto(`/admin/invoices/export?month=${month}`);
    await page.getByLabel("The accountant has these documents").check();
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText(/2 documents marked as sent/)).toBeVisible();

    expect((await invoiceRow(first.id)).exported_at).not.toBeNull();
    expect((await invoiceRow(second.id)).exported_at).not.toBeNull();
    expect((await invoiceRow(missing.id)).exported_at).toBeNull();

    await page.goto(`/admin/invoices?month=${month}&sent=yes`);
    await expect(page.getByTestId(`row-${first.number}`)).toBeVisible();
    await expect(page.getByTestId(`row-${missing.number}`)).toHaveCount(0);
  });

  test("an empty month says so", async () => {
    await page.goto(`/admin/invoices/export?month=${freshMonth(9)}`);
    await expect(page.getByText("No documents were issued")).toBeVisible();
  });
});

test.describe("settings", () => {
  let restore: () => Promise<void>;

  test.beforeAll(async () => {
    restore = await borrowSettings();
  });

  test.afterAll(async () => {
    await restore();
  });

  test("warns that details are dummy, and shows fixed items read-only", async () => {
    await page.goto("/admin/invoices/settings");
    await expect(page.getByTestId("dummy-warning")).toBeVisible();
    await expect(page.getByText("Off. The accountant uploads")).toBeVisible();
    await expect(
      page.getByText(/every document is marked provisional/),
    ).toBeVisible();
    await expect(page.locator('[name="isProvisional"]')).toHaveCount(0);
    await expect(page.locator('[name="myDataMode"]')).toHaveCount(0);
  });

  test("details save, and old documents keep theirs", async () => {
    const old = await issuedDocument(freshMonth(10));
    const before = await invoiceRow(old.id);

    await page.goto("/admin/invoices/settings");
    await page.getByLabel("Business name").fill("Filakopi Test Ltd");
    await page.getByLabel("VAT number").fill("123456789");
    await page.getByLabel("Tax office").fill("Milos");
    await page.getByLabel("Address").fill("1 Harbour Road");
    await page.getByRole("radio", { name: "Invoice" }).check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByTestId("dummy-warning")).toHaveCount(0);

    const { rows } = await db.query(
      `select value from public.settings where key = 'invoicing'`,
    );
    expect(rows[0].value).toMatchObject({
      isProvisional: true,
      myDataMode: "off",
      defaultDocType: "invoice",
    });
    expect(rows[0].value.issuer.legalName).toBe("Filakopi Test Ltd");
    expect((await invoiceRow(old.id)).issuer).toEqual(before.issuer);
  });

  test("a forged form cannot switch off provisional or myDATA", async () => {
    await page.goto("/admin/invoices/settings");
    await page.evaluate(() => {
      const form = document.querySelector("form")!;
      for (const [name, value] of [
        ["isProvisional", "false"],
        ["myDataMode", "direct"],
      ]) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.append(input);
      }
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const { rows } = await db.query(
      `select value from public.settings where key = 'invoicing'`,
    );
    expect(rows[0].value.isProvisional).toBe(true);
    expect(rows[0].value.myDataMode).toBe("off");
  });
});

test.describe("who can do what", () => {
  const actions: Record<string, CapturedAction> = {};
  const paths: Record<string, string> = {};
  let unissued: Awaited<ReturnType<typeof paidBooking>>;
  let document: Fixture;
  let lost: Fixture;
  const counts = async () => {
    const { rows } = await db.query(
      `select
         (select count(*)::int from public.invoices where payment_id = $1) as issued,
         (select count(*)::int from public.invoices where credits_invoice_id = $2) as credits,
         (select exported_at from public.invoices where id = $2) as exported,
         (select pdf_path from public.invoices where id = $3) as lost_pdf,
         (select value from public.settings where key = 'invoicing') as settings`,
      [unissued.paymentId, document.id, lost.id],
    );
    return rows[0];
  };

  let restore: () => Promise<void>;

  test.afterAll(async () => {
    await restore();
  });

  test.beforeAll(async () => {
    restore = await borrowSettings();
    unissued = await paidBooking();
    const month = freshMonth(11);
    document = await issuedDocument(month);
    lost = await issuedDocument(month, { withPdf: false });

    await issueFromAdmin(unissued);
    paths.issue = page.url().replace(/^https?:\/\/[^/]+/, "");
    actions.issue = await capture(page, () =>
      page.getByRole("button", { name: "Issue the document" }).click(),
    );

    paths.credit = `/admin/invoices/${document.id}/credit`;
    await page.goto(paths.credit);
    await page.getByLabel(/^Amount to credit/).fill("1");
    await page.getByLabel("Reason").fill("Replay");
    actions.credit = await capture(page, () =>
      page.getByRole("button", { name: "Issue the credit note" }).click(),
    );

    paths.regenerate = `/admin/invoices/${lost.id}`;
    await page.goto(paths.regenerate);
    actions.regenerate = await capture(page, () =>
      page.getByRole("button", { name: "Make the PDF again" }).click(),
    );

    paths.settings = "/admin/invoices/settings";
    await page.goto(paths.settings);
    await page.getByLabel("Business name").fill("Replayed Ltd");
    actions.settings = await capture(page, () =>
      page.getByRole("button", { name: "Save", exact: true }).click(),
    );

    paths.markSent = `/admin/invoices/export?month=${month}`;
    await page.goto(paths.markSent);
    await page.getByLabel("The accountant has these documents").check();
    actions.markSent = await capture(page, () =>
      page.getByRole("button", { name: "Mark as sent" }).click(),
    );

    paths.selectAll = `/admin/invoices?month=${month}`;
    await page.goto(paths.selectAll);
    actions.selectAll = await capture(page, () =>
      page.getByRole("button", { name: /^Select all/ }).click(),
    );

    paths.review = paths.selectAll;
    await page.goto(paths.review);
    await page
      .getByRole("checkbox", { name: `Select ${document.number}` })
      .check();
    actions.review = await capture(page, () =>
      page
        .getByTestId("selection-bar")
        .getByRole("button", { name: "Download" })
        .click(),
    );
    await page.reload();
    await page
      .getByTestId("selection-bar")
      .getByRole("button", { name: "Clear" })
      .click();
  });

  for (const name of [
    "issue",
    "credit",
    "regenerate",
    "settings",
    "markSent",
    "selectAll",
    "review",
  ]) {
    test(`replaying ${name} is refused for Staff and for a password alone`, async () => {
      const before = await counts();

      const asStaff = await replay(
        staffContext.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(asStaff)).toBe("/admin/not-allowed");

      const asAal1 = await replay(
        aal1Context.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(asAal1)).toBe("/admin/mfa");

      expect(await counts()).toEqual(before);
    });
  }

  test("the same bytes work for the Owner, so the refusals mean something", async () => {
    const request = page.context().request;
    const before = await counts();

    expect(
      (await replay(request, paths.settings, actions.settings)).status(),
    ).toBe(200);
    expect(
      (await replay(request, paths.markSent, actions.markSent)).status(),
    ).toBe(200);

    const after = await counts();
    expect(after.settings.issuer.legalName).toBe("Replayed Ltd");
    expect(after.exported).not.toBeNull();
    expect(before.exported).toBeNull();
  });

  test("Staff and a password alone cannot reach a page or a file", async () => {
    const targets = [
      "/admin/invoices",
      "/admin/invoices/issue",
      "/admin/invoices/export",
      "/admin/invoices/settings",
      `/admin/invoices/${document.id}`,
      `/admin/invoices/${document.id}/pdf`,
      `/admin/invoices/${document.id}/pdf?download=1`,
      `/admin/invoices/export/download?month=2026-11`,
    ];
    for (const path of targets) {
      const asStaff = await staffContext.request.get(path, { maxRedirects: 0 });
      expect(redirectTarget(asStaff), path).toContain("/admin/not-allowed");
      const asAal1 = await aal1Context.request.get(path, { maxRedirects: 0 });
      expect(redirectTarget(asAal1), path).toContain("/admin/mfa");
    }
  });

  test("Staff and a password alone cannot post a selection", async () => {
    const asStaff = await postIds(staffContext.request, [document.id]);
    expect(redirectTarget(asStaff)).toContain("/admin/not-allowed");
    const asAal1 = await postIds(aal1Context.request, [document.id]);
    expect(redirectTarget(asAal1)).toContain("/admin/mfa");
  });

  test("the menu shows Invoices to the Owner only", async () => {
    await page.goto("/admin");
    await expect(
      page
        .getByRole("main")
        .getByRole("link", { name: "Invoices and receipts" }),
    ).toBeVisible();
    const staffPage = await staffContext.newPage();
    await staffPage.goto("/admin");
    await expect(
      staffPage.getByRole("link", { name: "Invoices and receipts" }),
    ).toHaveCount(0);
    await staffPage.close();
  });

  test("forged ids are refused, whole", async () => {
    const request = page.context().request;
    const stranger = randomUUID();

    for (const ids of [
      [stranger],
      [document.id, stranger],
      ["not-an-id"],
      [document.id, "' or 1=1 --"],
      [],
    ]) {
      const response = await postIds(request, ids);
      expect(response.status(), ids.join()).toBe(400);
      expect(await response.text()).toContain("could not be found");
    }
  });

  test("a body that is not a form is refused, not a server error", async () => {
    const response = await page
      .context()
      .request.post("/admin/invoices/export/download", {
        headers: { "content-type": "application/json" },
        data: JSON.stringify({ id: [document.id] }),
      });
    expect(response.status()).toBe(400);
  });

  test("a draft is not a document, so its id is refused", async () => {
    const { rows } = await db.query(
      `insert into public.invoices (booking_id, doc_type)
       values ($1, 'receipt') returning id`,
      [unissued.bookingId],
    );
    const response = await postIds(page.context().request, [rows[0].id]);
    expect(response.status()).toBe(400);
  });

  test("a stale selection tells the Owner, and does nothing", async () => {
    await page.goto(paths.selectAll);
    await page.evaluate((id) => {
      sessionStorage.setItem(
        "cf-invoice-selection",
        JSON.stringify([[id, 100]]),
      );
    }, randomUUID());
    await page.reload();
    const bar = page.getByTestId("selection-bar");
    await bar.getByRole("button", { name: "Download" }).click();
    await expect(bar.getByRole("alert")).toContainText("could not be found");
    await bar.getByRole("button", { name: "Clear" }).click();
  });

  test("with no session, every page, file and action goes to sign in", async ({
    browser,
  }) => {
    const anonymous = await context(browser);
    const request = anonymous.request;
    for (const path of [
      "/admin/invoices",
      "/admin/invoices/issue",
      "/admin/invoices/export",
      "/admin/invoices/settings",
      `/admin/invoices/${document.id}`,
      `/admin/invoices/${document.id}/credit`,
      `/admin/invoices/${document.id}/pdf`,
      `/admin/invoices/${document.id}/pdf?download=1`,
      `/admin/invoices/export/download?month=2026-11`,
    ]) {
      const response = await request.get(path, { maxRedirects: 0 });
      expect(redirectTarget(response), path).toContain("/admin/login");
    }

    const posted = await postIds(request, [document.id]);
    expect(redirectTarget(posted)).toContain("/admin/login");

    const before = await counts();
    for (const name of Object.keys(actions)) {
      const response = await replay(request, paths[name], actions[name]);
      expect(redirectTarget(response), name).toContain("/admin/login");
    }
    expect(await counts()).toEqual(before);
    await anonymous.close();
  });
});

test.describe("documents with awkward numbers", () => {
  const month = freshMonth(12);
  let alpha: Fixture;
  let tau: Fixture;

  test.beforeAll(async () => {
    // Both come out as ___-000001 if Greek is stripped from a name.
    alpha = await issuedDocument(month, {
      number: "ΑΠΥ-000001",
      withPdf: false,
    });
    tau = await issuedDocument(month, {
      number: "ΤΠΥ-000001",
      withPdf: false,
    });
  });

  const makePdf = async (id: string) => {
    await page.goto(`/admin/invoices/${id}`);
    await page.getByRole("button", { name: "Make the PDF again" }).click();
    await expect(page.getByText("The PDF is ready.")).toBeVisible();
  };

  test("each gets its own file, under its own id", async () => {
    await makePdf(alpha.id);
    await makePdf(tau.id);

    const [a, b] = [await invoiceRow(alpha.id), await invoiceRow(tau.id)];
    const [year, part] = month.split("-");
    expect(a.pdf_path).toBe(`${year}/${part}/${alpha.id}.pdf`);
    expect(b.pdf_path).toBe(`${year}/${part}/${tau.id}.pdf`);

    for (const [row, number] of [
      [a, alpha.number],
      [b, tau.number],
    ]) {
      const { data } = await storage.download(row.pdf_path);
      const text = squeezed(
        await pdfText(new Uint8Array(await data!.arrayBuffer())),
      );
      expect(text).toContain(number);
    }
  });

  test("a ZIP holds both, each with its own contents and a Greek name", async () => {
    const response = await postIds(page.context().request, [alpha.id, tau.id]);
    const files = unzipSync(await response.body());
    expect(Object.keys(files)).toContain(entry(alpha));
    expect(Object.keys(files)).toContain(entry(tau));
    expect(entry(alpha)).toContain("ΑΠΥ-000001");
    expect(entry(alpha)).not.toBe(entry(tau));

    const text = squeezed(await pdfText(files[entry(tau)]));
    expect(text).toContain(tau.number);
    expect(text).not.toContain(alpha.number);
  });

  test("one document saves under its Greek number, both ways", async () => {
    await page.goto(`/admin/invoices?month=${month}`);
    const fromLink = await save(page, () =>
      page.getByRole("link", { name: `Download PDF ${alpha.number}` }).click(),
    );
    expect(fromLink.suggestedFilename()).toBe(`${alpha.number}.pdf`);

    const posted = await postIds(page.context().request, [tau.id]);
    expect(posted.headers()["content-disposition"]).toContain(
      `filename*=UTF-8''${encodeURIComponent(`${tau.number}.pdf`)}`,
    );
  });

  test("the PDF is not linked blindly to a file already at its path", async () => {
    const other = await issuedDocument(month, { withPdf: false });
    const path = `${month.replace("-", "/")}/${other.id}.pdf`;
    const stranger = await storage.download(
      (await invoiceRow(tau.id)).pdf_path,
    );
    await storage.upload(path, await stranger.data!.arrayBuffer(), {
      contentType: "application/pdf",
    });

    await page.goto(`/admin/invoices/${other.id}`);
    await page.getByRole("button", { name: "Make the PDF again" }).click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      "could not be made",
    );
    expect((await invoiceRow(other.id)).pdf_path).toBeNull();
    await storage.remove([path]);
  });
});

test.describe("VAT from the booking to the accountant", () => {
  let wholeId: string;
  let depositId: string;
  let balanceId: string;
  let creditId: string;
  let whole: Awaited<ReturnType<typeof paidBooking>>;
  let deposit: Awaited<ReturnType<typeof paidBooking>>;

  const issuePayment = async (paymentId: string) => {
    await page.goto(`/admin/invoices/issue/${paymentId}`);
    await page.getByRole("button", { name: "Issue the document" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    return documentId();
  };

  const figures = async (id: string) => {
    const row = await invoiceRow(id);
    return {
      total: row.total_cents,
      net: row.net_cents,
      vat: row.vat_cents,
      fee: row.fee_cents,
    };
  };

  const textOf = async (id: string) => {
    const { data } = await storage.download((await invoiceRow(id)).pdf_path);
    return squeezed(await pdfText(new Uint8Array(await data!.arrayBuffer())));
  };

  test.beforeAll(async () => {
    whole = await paidBooking({ breakdown: VAT_BREAKDOWN });
    wholeId = await issuePayment(whole.paymentId);

    deposit = await paidBooking({
      breakdown: VAT_BREAKDOWN,
      kind: "deposit",
      amountCents: 29740,
    });
    depositId = await issuePayment(deposit.paymentId);
    balanceId = await issuePayment(
      await addPayment(deposit.bookingId, "balance", 69392),
    );

    await page.goto(`/admin/invoices/${wholeId}/credit`);
    await page.getByLabel(/^Amount to credit/).fill("297,40");
    await page.getByLabel("Reason").fill("Μερική επιστροφή");
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    creditId = documentId();
  });

  test("the database holds the worked example", async () => {
    expect(await figures(wholeId)).toEqual({
      total: 99132,
      net: 86400,
      vat: 11232,
      fee: 1500,
    });
    expect(await figures(depositId)).toEqual({
      total: 29740,
      net: 25920,
      vat: 3370,
      fee: 450,
    });
    expect(await figures(balanceId)).toEqual({
      total: 69392,
      net: 60480,
      vat: 7862,
      fee: 1050,
    });
    expect(await figures(creditId)).toEqual({
      total: 29740,
      net: 25920,
      vat: 3370,
      fee: 450,
    });
  });

  test("the PDF says the same", async () => {
    const text = await textOf(wholeId);
    for (const wanted of [
      "864,00 €",
      "112,32 €",
      "15,00 €",
      "991,32 €",
      "13%",
      "Ανάλυση ΦΠΑ / VAT breakdown",
    ]) {
      expect(text).toContain(squeezed(wanted));
    }
    expect(text).not.toContain(squeezed("For the accountant to confirm"));

    const share = await textOf(depositId);
    for (const wanted of ["259,20 €", "33,70 €", "4,50 €", "297,40 €"]) {
      expect(share).toContain(squeezed(wanted));
    }
    expect(share).toContain(squeezed("For the accountant to confirm"));
    expect(share).toContain(squeezed("Προς επιβεβαίωση από τον λογιστή"));
    expect(share).toContain(squeezed("Τέλος ανθεκτικότητας"));
  });

  test("the Excel file says the same, signed, with the right transaction", async () => {
    const response = await postIds(page.context().request, [
      wholeId,
      depositId,
      balanceId,
      creditId,
    ]);
    const files = unzipSync(await response.body());
    const sheet = await sheetIn(files);
    const cells = (number: string) => {
      const line = rowStarting(sheet, number);
      const at = (header: string) =>
        line.getCell(columnOf(sheet, header)).value ?? "";
      return {
        net: at("Καθαρό / Net"),
        vat: at("ΦΠΑ / VAT"),
        fee: at("Τέλη εκτός ΦΠΑ / Fees outside VAT"),
        total: at("Σύνολο / Total"),
        rates: at("Συντελεστές ΦΠΑ / VAT rates"),
        transaction: at("Συναλλαγή / Transaction"),
        note: at("Σημείωση / Note"),
      };
    };
    const number = async (id: string) =>
      (await invoiceRow(id)).document_number as string;

    expect(cells(await number(wholeId))).toEqual({
      net: 864,
      vat: 112.32,
      fee: 15,
      total: 991.32,
      rates: "13%",
      transaction: whole.intent,
      note: "",
    });
    const share = cells(await number(depositId));
    expect(share).toMatchObject({
      net: 259.2,
      vat: 33.7,
      fee: 4.5,
      total: 297.4,
      transaction: deposit.intent,
    });
    expect(share.note).toContain("To be confirmed by the accountant");

    // A credit note takes its original's Stripe reference, and is negative.
    const credit = cells(await number(creditId));
    expect(credit).toMatchObject({
      net: -259.2,
      vat: -33.7,
      fee: -4.5,
      total: -297.4,
      transaction: whole.intent,
    });
    expect(credit.note).toContain("To be confirmed by the accountant");

    // The free-text payment note never reaches the export.
    const everything = JSON.stringify(sheet.getSheetValues());
    expect(everything).not.toContain("free text note");

    // The totals row matches the database, with the credit note taken off.
    const { rows } = await db.query(
      `select
         sum(case when doc_type = 'credit_note' then -total_cents else total_cents end)::int as total,
         sum(case when doc_type = 'credit_note' then -vat_cents else vat_cents end)::int as vat
       from public.invoices where id = any($1::uuid[])`,
      [[wholeId, depositId, balanceId, creditId]],
    );
    const totals = rowStarting(sheet, "Σύνολο / Total");
    expect(totals.getCell(columnOf(sheet, "Σύνολο / Total")).result).toBe(
      rows[0].total / 100,
    );
    expect(totals.getCell(columnOf(sheet, "ΦΠΑ / VAT")).result).toBe(
      rows[0].vat / 100,
    );
  });

  test("the Summary shows the filter a selection was made under", async () => {
    const number = (await invoiceRow(wholeId)).document_number as string;
    await page.goto(
      `/admin/invoices?booking=${encodeURIComponent(whole.reference)}`,
    );
    await page.getByRole("button", { name: /^Select all/ }).click();
    const bar = page.getByTestId("selection-bar");
    await expect(bar).toContainText("2 selected");
    const download = await save(page, () =>
      bar.getByRole("button", { name: "Download" }).click(),
    );
    const files = unzipSync(await bytesOf(download));
    const name = Object.keys(files).find((n) => n.endsWith(".xlsx"))!;
    const workbook = await readWorkbook(files[name]);
    const cover: unknown[] = [];
    workbook
      .getWorksheet("Summary")!
      .eachRow((row) => cover.push(row.getCell(1).value));
    expect(cover).toContain("Επιλεγμένα παραστατικά / Selected documents: 2");
    expect(cover).toContain(
      `Φίλτρο / Filter, Κράτηση / Booking: ${whole.reference}`,
    );
    expect(documentNumbers(workbook.getWorksheet("Documents")!)).toContain(
      number,
    );
    await bar.getByRole("button", { name: "Clear" }).click();
  });
});

test.describe("issuing, the harder cases", () => {
  const issueButton = () =>
    page.getByRole("button", { name: "Issue the document" });

  test("a stale credit note form is refused, plainly", async () => {
    const original = await issuedDocument(freshMonth(13));
    const second = await page.context().newPage();
    for (const tab of [page, second]) {
      await tab.goto(`/admin/invoices/${original.id}/credit`);
      await tab.getByLabel(/^Amount to credit/).fill("10");
      await tab.getByLabel("Reason").fill("Repeated");
    }
    await page.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);

    await second.getByRole("button", { name: "Issue the credit note" }).click();
    await expect(second.locator('.notice[role="alert"]')).toContainText(
      "Another credit note went through",
    );
    await second.close();

    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where credits_invoice_id = $1`,
      [original.id],
    );
    expect(rows[0].n).toBe(1);
  });

  test("a double submit shows the document and says what was not applied", async () => {
    const booking = await paidBooking();
    const second = await page.context().newPage();
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await second.goto(`/admin/invoices/issue/${booking.paymentId}`);

    await issueButton().click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    const id = documentId();

    await second.getByRole("radio", { name: /^Invoice/ }).check();
    await second.getByLabel("Company name").fill("Too Late Ltd");
    await second.getByLabel("VAT number").fill("123456789");
    await second.getByLabel("Address").fill("Athens 1");
    await second.getByLabel("Tax office").fill("Athens");
    await second.getByRole("button", { name: "Issue the document" }).click();
    await expect(second).toHaveURL(
      new RegExp(`/admin/invoices/${id}\\?notice=already_issued$`),
    );
    await expect(second.locator('.notice[role="alert"]')).toContainText(
      "were not applied",
    );
    await second.close();

    const row = await invoiceRow(id);
    expect(row.doc_type).toBe("receipt");
    expect(row.customer.companyName).toBeUndefined();
  });

  test("a price that cannot be read stops the document", async () => {
    const booking = await paidBooking();
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await setBreakdown(booking.bookingId, { nights: [] });

    // The form was open when the price went bad.
    await issueButton().click();
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      "cannot be read",
    );

    // Opened now, there is no form to submit at all.
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await expect(page.locator('.notice[role="alert"]')).toContainText(
      "cannot be read",
    );
    await expect(issueButton()).toHaveCount(0);

    const { rows } = await db.query(
      `select count(*)::int as n from public.invoices where booking_id = $1`,
      [booking.bookingId],
    );
    expect(rows[0].n).toBe(0);
  });

  test("money kept on a cancelled booking can be issued, for what was kept", async () => {
    const booking = await paidBooking();
    await cancelWithRefund(booking, 30000);

    await page.goto(`/admin/invoices/issue?q=${booking.reference}`);
    const link = page.getByRole("link", {
      name: new RegExp(`^Choose ${booking.reference}`),
    });
    await expect(link).toContainText("128,00 €");
    await expect(link).toContainText("ended without a stay");
    await link.click();

    await expect(page.getByText(/question 7/)).toBeVisible();
    await issueButton().click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    const row = await invoiceRow(documentId());
    expect(row.total_cents).toBe(12800);

    const { data } = await storage.download(row.pdf_path);
    expect(
      squeezed(await pdfText(new Uint8Array(await data!.arrayBuffer()))),
    ).toContain(squeezed("For the accountant to confirm"));
  });

  test("a no-show with the money kept is listed too", async () => {
    const booking = await paidBooking();
    await setStatus(booking.bookingId, "no_show");
    await page.goto(`/admin/invoices/issue?q=${booking.reference}`);
    await expect(page.getByRole("link", { name: /^Choose / })).toContainText(
      "428,00 €",
    );
  });

  test("a booking refunded in full has nothing to issue", async () => {
    const booking = await paidBooking();
    await cancelWithRefund(booking, BOOKING_TOTAL);
    await page.goto(`/admin/invoices/issue?q=${booking.reference}`);
    await expect(page.getByRole("link", { name: /^Choose / })).toHaveCount(0);
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await expect(page.getByRole("button", { name: /Issue/ })).toHaveCount(0);
  });

  test("a name the PDF cannot show is warned about, and can be replaced", async () => {
    const booking = await paidBooking({ guest: "अनिता शर्मा" });
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await expect(page.getByTestId("name-warning")).toBeVisible();

    await page.getByLabel("Name on the document").fill("अनिता");
    await issueButton().click();
    await expect(page.locator(".field-error")).toContainText("cannot show");

    await page.getByLabel("Name on the document").fill("Anita Sharma");
    await issueButton().click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);

    const row = await invoiceRow(documentId());
    expect(row.customer.name).toBe("Anita Sharma");
    const { data } = await storage.download(row.pdf_path);
    expect(
      squeezed(await pdfText(new Uint8Array(await data!.arrayBuffer()))),
    ).toContain("AnitaSharma");

    // The booking still finds it under the guest's own name.
    await page.goto(
      `/admin/invoices?guest=${encodeURIComponent("अनिता")}&booking=${booking.reference}`,
    );
    await expect(page.locator(".inv-table tbody tr")).toHaveCount(1);
  });

  test("the same name, left as it is, still makes a PDF", async () => {
    const booking = await paidBooking({ guest: "अनिता शर्मा" });
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await issueButton().click();
    await expect(page).toHaveURL(/\/admin\/invoices\/[0-9a-f-]{36}$/);
    const row = await invoiceRow(documentId());
    expect(row.pdf_path).not.toBeNull();
    const { data } = await storage.download(row.pdf_path);
    expect(
      squeezed(await pdfText(new Uint8Array(await data!.arrayBuffer()))),
    ).toContain(squeezed("PROVISIONAL, NOT A TAX DOCUMENT"));
  });

  test("a guest's name cannot be typed as an unprintable company", async () => {
    const booking = await paidBooking();
    await page.goto(`/admin/invoices/issue/${booking.paymentId}`);
    await page.getByRole("radio", { name: /^Invoice/ }).check();
    await page.getByLabel("Company name").fill("शर्मा Ltd");
    await page.getByLabel("VAT number").fill("123456789");
    await page.getByLabel("Address").fill("Athens 1");
    await page.getByLabel("Tax office").fill("Athens");
    await issueButton().click();
    await expect(page.locator(".field-error")).toContainText("cannot show");
  });

  test("Mark as sent checks the file itself, not just the stored path", async () => {
    const month = freshMonth(14);
    const gone = await issuedDocument(month);
    const kept = await issuedDocument(month);
    await storage.remove([gone.pdfPath!]);

    await page.goto(`/admin/invoices/export?month=${month}`);
    await page.getByLabel("The accountant has these documents").check();
    await page.getByRole("button", { name: "Mark as sent" }).click();
    await expect(page.getByText(/1 document marked as sent/)).toBeVisible();
    await expect(page.getByText(/1 document with no PDF/)).toBeVisible();
    expect((await invoiceRow(gone.id)).exported_at).toBeNull();
    expect((await invoiceRow(kept.id)).exported_at).not.toBeNull();
  });
});

test.describe("guests", () => {
  for (const locale of locales) {
    for (const path of publicPaths) {
      test(`nothing on /${locale}${path} offers a document`, async ({
        page: visitor,
      }) => {
        await visitor.goto(`/${locale}${path}`);
        const offers = visitor.locator(
          [
            'a[href*="invoice" i]',
            'a[href*="receipt" i]',
            'a[href*="/admin"]',
            'a[href$=".pdf" i]',
            "a[download]",
            'form[action*="invoice" i]',
          ].join(", "),
        );
        await expect(offers).toHaveCount(0);
        await expect(
          visitor.getByRole("link", {
            name: /invoice|receipt|τιμολόγιο|απόδειξη/i,
          }),
        ).toHaveCount(0);
        await expect(
          visitor.getByRole("button", {
            name: /invoice|receipt|τιμολόγιο|απόδειξη/i,
          }),
        ).toHaveCount(0);
      });
    }
  }
});
