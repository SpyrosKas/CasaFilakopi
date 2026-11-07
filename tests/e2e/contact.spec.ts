import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  db,
  hashOf,
  MAILPIT_URL,
  seedAttempts,
  testAddress,
} from "./admin-helpers";
import { skipCookieBanner } from "./helpers";
import { findOverflow } from "./layout-checks";

// The contact form through the real route, queue and Mailpit (T3.24). Each test
// has its own address and network address, so nothing here reaches other tests.

const emails = new Set<string>();
const addresses = new Set<string>();

function visitor() {
  const email = `contact-e2e-${randomUUID()}@example.test`;
  emails.add(email);
  return { email, name: `Guest ${randomUUID().slice(0, 8)}` };
}

async function openForm(browser: Browser, path: string, width = 1280) {
  const address = testAddress();
  addresses.add(address);
  const context = await browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": address },
    viewport: { width, height: 800 },
    baseURL: test.info().project.use.baseURL,
  });
  const page = await context.newPage();
  await skipCookieBanner(page);
  await page.goto(path);
  return { page, address };
}

interface MailSummary {
  ID: string;
  Subject: string;
}

async function findMail(query: string): Promise<MailSummary[]> {
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(query)}`,
  );
  const { messages } = (await search.json()) as { messages?: MailSummary[] };
  return messages ?? [];
}

async function waitForMail(query: string): Promise<MailSummary> {
  await expect
    .poll(async () => (await findMail(query)).length, { timeout: 20_000 })
    .toBeGreaterThan(0);
  return (await findMail(query))[0];
}

const readMail = async (id: string) =>
  (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as {
    Subject: string;
    Text: string;
    HTML: string;
    ReplyTo: { Address: string }[];
    From: { Address: string; Name: string };
    To: { Address: string }[];
  };

const fill = async (
  page: Page,
  values: { name: string; email: string },
  labels: { name: string; email: string; message: string; consent: RegExp },
  message: string,
) => {
  await page.getByLabel(labels.name).fill(values.name);
  await page.getByLabel(labels.email).fill(values.email);
  await page.getByLabel(labels.message).fill(message);
  await page.getByLabel(labels.consent).check();
};

const english = {
  name: "Your name",
  email: "Your email",
  message: "Your message",
  consent: /I agree/,
};
const greek = {
  name: "Το όνομά σας",
  email: "Το email σας",
  message: "Το μήνυμά σας",
  consent: /Συμφωνώ/,
};

test.afterAll(async () => {
  const list = [...emails];
  const { rows } = await db.query(
    `select id from public.contact_messages where email = any($1)`,
    [list],
  );
  const ids = rows.map((row) => row.id);
  await db.query(
    `delete from public.email_logs where contact_message_id = any($1::uuid[])`,
    [ids],
  );
  await db.query(`delete from public.consent_log where subject = any($1)`, [
    ids,
  ]);
  await db.query(`delete from public.contact_messages where id = any($1)`, [
    ids,
  ]);
  await db.query(
    `delete from public.admin_attempts where scope = 'contact_form' and key_hash = any($1)`,
    [[...addresses].map(hashOf)],
  );
});

test("a message reaches the host and the guest, in English", async ({
  browser,
}) => {
  const { page } = await openForm(browser, "/en/contact");
  const guest = visitor();

  await fill(page, guest, english, "Is the house free in July?\nThanks <b>");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("Thank you");

  const { rows } = await db.query(
    `select id, message, locale, status from public.contact_messages where email = $1`,
    [guest.email],
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].message).toContain("Is the house free");

  const reply = await readMail((await waitForMail(`to:"${guest.email}"`)).ID);
  expect(reply.Subject).toContain("We received your message");
  expect(reply.From.Address).toBe("bookings@mail.miloscasa.com");
  expect(reply.From.Name).toBe("Casa Filakopi");
  expect(reply.ReplyTo[0].Address).toBe("host@miloscasa.com");
  // The auto-reply repeats nothing typed, so it cannot carry someone's spam.
  expect(reply.Text).not.toContain(guest.name);
  expect(reply.Text).not.toContain("Is the house free");

  const host = await readMail(
    (await waitForMail(`subject:"${guest.name}"`)).ID,
  );
  expect(host.To[0].Address).toBe("host@miloscasa.com");
  expect(host.ReplyTo[0].Address).toBe(guest.email);
  expect(host.Text).toContain("Is the house free in July?");
  expect(host.HTML).toContain("Thanks &lt;b&gt;");

  const logs = await db.query(
    `select template_key, status from public.email_logs where contact_message_id = $1`,
    [rows[0].id],
  );
  expect(logs.rows.map((row) => row.status)).toEqual(["sent", "sent"]);

  const consent = await db.query(
    `select granted from public.consent_log where kind = 'contact_form' and subject = $1`,
    [rows[0].id],
  );
  expect(consent.rows).toEqual([{ granted: true }]);
  await page.context().close();
});

test("a Greek message gets a Greek reply", async ({ browser }) => {
  const { page } = await openForm(browser, "/el/contact");
  const guest = visitor();

  await fill(page, guest, greek, "Καλημέρα, είναι διαθέσιμο;");
  await page.getByRole("button", { name: "Αποστολή μηνύματος" }).click();
  await expect(page.getByRole("status")).toContainText("Σας ευχαριστούμε");

  const reply = await readMail((await waitForMail(`to:"${guest.email}"`)).ID);
  expect(reply.Subject).toContain("Λάβαμε το μήνυμά σας");
  expect(reply.Text).toContain("Γεια σας");
  await page.context().close();
});

test("one address gets one auto-reply a day", async ({ browser }) => {
  const guest = visitor();
  for (const message of ["First", "Second"]) {
    const { page } = await openForm(browser, "/en/contact");
    await fill(page, guest, english, message);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("status")).toContainText("Thank you");
    await page.context().close();
  }

  const saved = await db.query(
    `select id from public.contact_messages where email = $1`,
    [guest.email],
  );
  expect(saved.rows).toHaveLength(2);
  await waitForMail(`to:"${guest.email}"`);
  await expect
    .poll(async () => (await findMail(`subject:"${guest.name}"`)).length)
    .toBe(2);
  expect(await findMail(`to:"${guest.email}"`)).toHaveLength(1);
});

test("explains what is wrong, and keeps what was typed", async ({
  browser,
}) => {
  const { page } = await openForm(browser, "/en/contact");
  await page.getByLabel(english.name).fill("Alex");
  await page.getByLabel(english.email).fill("not-an-email");
  await page.getByLabel(english.message).fill("Hello");
  await page.getByRole("button", { name: "Send message" }).click();

  await expect(page.getByText("Please type a valid email")).toBeVisible();
  await expect(page.getByText("Please tick this box")).toBeVisible();
  await expect(page.getByLabel(english.message)).toHaveValue("Hello");
  await page.context().close();
});

test("the honeypot stores nothing and shows no sign", async ({ browser }) => {
  const { page } = await openForm(browser, "/en/contact");
  const guest = visitor();
  await fill(page, guest, english, "Buy things");
  await page.locator("#contact-website").evaluate((input) => {
    (input as HTMLInputElement).value = "https://spam.example";
  });
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status")).toContainText("Thank you");

  const { rows } = await db.query(
    `select id from public.contact_messages where email = $1`,
    [guest.email],
  );
  expect(rows).toEqual([]);
  await page.context().close();
});

test("the hidden field cannot be reached by people", async ({ browser }) => {
  const { page } = await openForm(browser, "/en/contact");
  const trap = page.locator("#contact-website");
  await expect(trap).toHaveAttribute("tabindex", "-1");
  const box = await trap.boundingBox();
  expect(box!.x + box!.width).toBeLessThan(0);
  await page.context().close();
});

test("a busy address is told to wait, and keeps its text", async ({
  browser,
}) => {
  const { page, address } = await openForm(browser, "/en/contact");
  await seedAttempts("contact_form", address, 5);
  const guest = visitor();

  await fill(page, guest, english, "One more");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.locator(".contact-problem")).toContainText(
    "several messages",
  );
  await expect(page.getByLabel(english.message)).toHaveValue("One more");

  const { rows } = await db.query(
    `select id from public.contact_messages where email = $1`,
    [guest.email],
  );
  expect(rows).toEqual([]);

  const stored = await db.query(
    `select key_hash from public.admin_attempts where scope = 'contact_form' and key_hash = $1`,
    [hashOf(address)],
  );
  expect(stored.rows[0].key_hash).not.toContain(address);
  await page.context().close();
});

test("works at 320 px in both languages", async ({ browser }) => {
  for (const [path, labels, button] of [
    ["/en/contact", english, "Send message"],
    ["/el/contact", greek, "Αποστολή μηνύματος"],
  ] as const) {
    const { page } = await openForm(browser, path, 320);
    const guest = visitor();

    expect(await findOverflow(page)).toEqual([]);
    await fill(page, guest, labels, "Hello from a small phone");
    const send = page.getByRole("button", { name: button });
    await send.scrollIntoViewIfNeeded();
    const box = await send.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);

    await send.click();
    await expect(page.getByRole("status")).toBeVisible();
    expect(await findOverflow(page)).toEqual([]);
    await page.context().close();
  }
});

test("the page contacts no one else while Turnstile is not set up", async ({
  browser,
}) => {
  const { page } = await openForm(browser, "/en/contact");
  const outside: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("cloudflare")) outside.push(request.url());
  });
  await page.getByLabel(english.name).focus();
  await page.waitForTimeout(300);
  expect(outside).toEqual([]);
  await expect(page.locator("script[src*='turnstile']")).toHaveCount(0);
  await page.context().close();
});
