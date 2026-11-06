import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  authAdmin,
  clearAttempts,
  createTestUser,
  db,
  deleteTestUser,
  enrolOwner,
  latestMail,
  signInOwner,
  signInWithPassword,
  totpCode,
  type TestUser,
} from "./admin-helpers";

// Next.js adds an empty alert region of its own to every page.
const alert = (page: Page) => page.locator('.notice[role="alert"]');

const PHONE = { width: 375, height: 812 };
test.describe.configure({ mode: "serial" });
// Yorgos mostly uses a phone.
test.use({ viewport: PHONE });

const WRONG = "That email or password is not right.";
const LOCKED = /Too many tries/;

let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
let lockedOut: TestUser;
let resetter: TestUser;

test.beforeAll(async () => {
  await clearAttempts();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");
  stranger = await createTestUser(null);
  lockedOut = await createTestUser("staff");
  resetter = await createTestUser("staff");
});

test.afterAll(async () => {
  for (const user of [owner, staff, stranger, lockedOut, resetter]) {
    await deleteTestUser(user);
  }
  await clearAttempts();
});

test("pages are closed without a session", async ({ page }) => {
  for (const path of [
    "/admin",
    "/admin/rules",
    "/admin/property",
    "/admin/mfa",
    "/admin/new-password",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/login$/);
  }
});

test("admin pages tell search engines to stay away", async ({ request }) => {
  const res = await request.get("/admin/login");
  expect(res.headers()["x-robots-tag"]).toContain("noindex");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  const html = await res.text();
  expect(html).toMatch(/<meta name="robots" content="noindex/);
});

test("there is no way to sign up", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("link", { name: /sign up/i })).toHaveCount(0);
  await page.goto("/admin/signup");
  await expect(page).toHaveURL(/\/admin\/login$/);

  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  const { error } = await anon.auth.signUp({
    email: "no-signups@example.test",
    password: "a-generated-test-value",
  });
  expect(error?.code).toBe("signup_disabled");
});

test("wrong password and unknown email get the same message", async ({
  page,
}) => {
  await signInWithPassword(page, { email: staff.email, password: "wrong" });
  await expect(alert(page)).toHaveText(WRONG);

  await signInWithPassword(page, {
    email: "nobody-here@example.test",
    password: "wrong",
  });
  await expect(alert(page)).toHaveText(WRONG);
});

test("a real user with no admin profile is refused the same way", async ({
  page,
  context,
}) => {
  await signInWithPassword(page, stranger);
  await expect(alert(page)).toHaveText(WRONG);
  const cookies = await context.cookies();
  expect(cookies.filter((c) => c.name.includes("auth-token"))).toEqual([]);
});

test("login locks after repeated failures, even for the right password", async ({
  page,
}) => {
  for (let i = 0; i < 4; i += 1) {
    await signInWithPassword(page, {
      email: lockedOut.email,
      password: "wrong",
    });
    await expect(alert(page)).toHaveText(WRONG);
  }
  await signInWithPassword(page, {
    email: lockedOut.email,
    password: "wrong",
  });
  await expect(alert(page)).toHaveText(LOCKED);

  await signInWithPassword(page, lockedOut);
  await expect(alert(page)).toHaveText(LOCKED);
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("an unknown email locks the same way, so locks reveal nothing", async ({
  page,
}) => {
  const email = "never-existed@example.test";
  for (let i = 0; i < 5; i += 1) {
    await signInWithPassword(page, { email, password: "wrong" });
    await alert(page).waitFor();
  }
  await expect(alert(page)).toHaveText(LOCKED);
});

test("attempts are stored with no readable email", async () => {
  const { rows } = await db.query(
    `select entity_id from public.audit_log where entity = 'admin_attempt'`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.entity_id).toMatch(/^[a-z_]+:[0-9a-f]{64}$/);
  }
});

test("Owner is forced through MFA and reaches nothing until done", async ({
  page,
}) => {
  await signInWithPassword(page, owner);
  await expect(page).toHaveURL(/\/admin\/mfa$/);

  for (const path of ["/admin", "/admin/rules", "/admin/property"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/mfa$/);
  }

  await enrolOwner(page, owner);
  await expect(page.getByRole("heading", { name: /Hello/ })).toBeVisible();

  const { data } = await authAdmin.mfa.listFactors({ userId: owner.id });
  expect(data?.factors.filter((f) => f.status === "verified")).toHaveLength(1);
});

test("an abandoned setup can be started again", async ({ browser }) => {
  const fresh = await createTestUser("owner");
  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(page, fresh);
  await page.getByRole("button", { name: "Start setup" }).click();
  await expect(page.getByTestId("totp-secret")).toBeVisible();
  await page.reload();
  await enrolOwner(page, fresh);
  await deleteTestUser(fresh);
});

test("Owner signs in with password and a real code, then signs out", async ({
  page,
}) => {
  await signInWithPassword(page, owner);
  await expect(page).toHaveURL(/\/admin\/mfa$/);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page)).toContainText("did not work");

  await page.goto("/admin/rules");
  await expect(page).toHaveURL(/\/admin\/mfa$/);

  await page.getByLabel("6-digit code").fill(totpCode(owner.totpSecret!));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/admin/rules");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Payment and cancellation",
  );

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  await expect(page.getByText("You are signed out.")).toBeVisible();

  await page.goto("/admin/rules");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("wrong codes lock the code step", async ({ browser }) => {
  const user = await createTestUser("owner");
  const first = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(first, user);
  await enrolOwner(first, user);

  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(page, user);
  for (let i = 0; i < 5; i += 1) {
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(alert(page)).toHaveText(
      i < 4 ? /did not work/ : /Too many wrong codes/,
    );
  }
  await page.getByLabel("6-digit code").fill(totpCode(user.totpSecret!));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page)).toHaveText(/Too many wrong codes/);
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await deleteTestUser(user);
});

test("Staff get in without MFA and are blocked from owner pages", async ({
  page,
}) => {
  await signInWithPassword(page, staff);
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole("button", { name: "Menu" }).click();
  await expect(
    page.getByRole("link", { name: "Payment and cancellation" }),
  ).toHaveCount(0);

  for (const path of [
    "/admin/property",
    "/admin/house",
    "/admin/booking",
    "/admin/rules",
  ]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/admin\/not-allowed$/);
    await expect(
      page.getByRole("heading", { name: "This page is for the owner" }),
    ).toBeVisible();
  }
});

test("a mistyped admin address gives a normal not-found page", async ({
  page,
}) => {
  await signInWithPassword(page, staff);
  await expect(page).toHaveURL(/\/admin$/);
  const res = await page.goto("/admin/no-such-page");
  expect(res?.status()).toBe(404);
});

test("a burst of guesses at once cannot beat the lockout", async ({
  browser,
}) => {
  const target = await createTestUser("staff");
  const page = await (await browser.newContext({ viewport: PHONE })).newPage();

  // Fifteen tries at the same moment through the real form, in one browser.
  const attempts = await Promise.all(
    Array.from({ length: 15 }, async () => {
      const tab = await page.context().newPage();
      await signInWithPassword(tab, { email: target.email, password: "wrong" });
      return tab;
    }),
  );
  await Promise.all(attempts.map((tab) => alert(tab).waitFor()));
  const wrong = await Promise.all(
    attempts.map(async (tab) => (await alert(tab).textContent()) === WRONG),
  );
  expect(wrong.filter(Boolean).length).toBeLessThanOrEqual(5);

  await signInWithPassword(page, target);
  await expect(alert(page)).toHaveText(LOCKED);
  await deleteTestUser(target);
});

test("Staff can turn on the optional second step", async ({ browser }) => {
  const user = await createTestUser("staff");
  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/account");
  await page.getByRole("link", { name: "Turn it on" }).click();
  await page.getByRole("button", { name: "Start setup" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())!.trim();
  await page.getByLabel("6-digit code").fill(totpCode(secret));
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // From now on this account needs its code too.
  const next = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(next, user);
  await expect(next).toHaveURL(/\/admin\/mfa$/);
  await deleteTestUser(user);
});

test("a session with a missing or forged activity cookie ends", async ({
  page,
  context,
}) => {
  await signInWithPassword(page, staff);
  await expect(page).toHaveURL(/\/admin$/);

  const activity = (await context.cookies()).find(
    (cookie) => cookie.name === "cf_admin_activity",
  )!;
  await context.addCookies([
    { ...activity, value: `${Math.floor(Date.now() / 1000)}.forged` },
  ]);
  await page.goto("/admin/account");
  await expect(page).toHaveURL(/\/admin\/login\?expired=1$/);
  await expect(page.getByText(/session ended/)).toBeVisible();

  // The session itself was ended, not only hidden.
  const names = (await context.cookies()).map((cookie) => cookie.name);
  expect(names.some((name) => name.includes("auth-token"))).toBe(false);
});

test("session cookies cannot be read by page scripts", async ({
  page,
  context,
}) => {
  await signInWithPassword(page, staff);
  await expect(page).toHaveURL(/\/admin$/);
  const cookies = await context.cookies();
  const session = cookies.filter(
    (c) => c.name.includes("auth-token") || c.name === "cf_admin_activity",
  );
  expect(session.length).toBeGreaterThanOrEqual(2);
  for (const cookie of session) {
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Lax");
  }
});

test("password reset answers the same for any email", async ({ page }) => {
  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill("nobody-here@example.test");
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");
});

test("a reset link sets a new password and old sessions end", async ({
  browser,
}) => {
  const oldContext = await browser.newContext({ viewport: PHONE });
  const oldPage = await oldContext.newPage();
  await signInWithPassword(oldPage, resetter);
  await expect(oldPage).toHaveURL(/\/admin$/);

  const { data, error } = await authAdmin.generateLink({
    type: "recovery",
    email: resetter.email,
  });
  if (error) throw error;

  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await page.goto(
    `/admin/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/new-password$/);

  await page.getByLabel("New password", { exact: true }).fill("too short");
  await page.getByLabel("Type it again").fill("too short");
  await page.getByRole("button", { name: "Save my new password" }).click();
  await expect(page.getByText(/at least 12 characters/).last()).toBeVisible();

  const password = `${resetter.password}-new`;
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Save my new password" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  // The old session was signed out, and the old password is gone.
  await oldPage.goto("/admin/account");
  await expect(oldPage).toHaveURL(/\/admin\/login/);
  const third = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInWithPassword(third, resetter);
  await expect(alert(third)).toHaveText(WRONG);
  await signInWithPassword(third, { ...resetter, password });
  await expect(third).toHaveURL(/\/admin$/);
  resetter.password = password;
});

test("an Owner with MFA must pass it before setting a new password", async ({
  browser,
}) => {
  const { data, error } = await authAdmin.generateLink({
    type: "recovery",
    email: owner.email,
  });
  if (error) throw error;

  const page = await (await browser.newContext({ viewport: PHONE })).newPage();
  await page.goto(
    `/admin/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/mfa\?next=password$/);

  await page.getByLabel("6-digit code").fill(totpCode(owner.totpSecret!));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/new-password$/);

  const password = `${owner.password}-new`;
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Save my new password" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  owner.password = password;

  const check = await (await browser.newContext({ viewport: PHONE })).newPage();
  await signInOwner(check, owner);
});

test("a normal session cannot change the password without a link", async ({
  page,
}) => {
  await signInWithPassword(page, staff);
  await expect(page).toHaveURL(/\/admin$/);
  await page.goto("/admin/new-password");
  await expect(page).toHaveURL(/\/admin$/);
});

test("a used or broken reset link gets a plain message", async ({ page }) => {
  await page.goto("/admin/auth/confirm");
  await expect(alert(page)).toContainText("expired");
  await page.goto("/admin/auth/confirm?token_hash=nonsense&type=recovery");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(alert(page)).toContainText("expired");
});

test("the reset email itself arrives and its link works", async ({ page }) => {
  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill(staff.email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");

  // Local Supabase allows very few emails an hour, shared across worktrees.
  await expect
    .poll(() => latestMail(staff.email), { timeout: 5000 })
    .not.toBeNull()
    .catch(() => {
      test.skip(true, "Local Supabase email limit reached");
    });
  const mail = (await latestMail(staff.email))!;
  const link = /href="([^"]+)"/.exec(mail)?.[1]?.replaceAll("&amp;", "&");
  expect(link).toContain("/auth/v1/verify");

  // config.toml does not allow this port as a redirect, so Supabase goes to
  // its default site address. Only the path differs from production.
  const verified = await fetch(link!, { redirect: "manual" });
  const code = new URL(verified.headers.get("location")!).searchParams.get(
    "code",
  );
  expect(code).toBeTruthy();

  await page.goto(`/admin/auth/confirm?code=${code}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/new-password$/);
});
