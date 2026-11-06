import { expect, test, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import {
  authAdmin,
  clearAttempts,
  countAttempts,
  createTestUser,
  db,
  deleteCreatedUsers,
  enrolOwner,
  latestMail,
  rememberUser,
  seedAttempts,
  signInOwner,
  signInWithPassword,
  sweepAbandonedUsers,
  testAddress,
  testEmail,
  totpCode,
  type TestUser,
} from "./admin-helpers";
import { createActivityValue } from "@/lib/admin/activity";
import { emailAtAddress } from "@/lib/admin/client-address";

// Next.js adds an empty alert region of its own to every page.
const alert = (page: Page) => page.locator('.notice[role="alert"]');

const PHONE = { width: 375, height: 812 };
const phone = (address = testAddress()) => ({
  viewport: PHONE,
  extraHTTPHeaders: { "x-forwarded-for": address },
});

test.describe.configure({ mode: "serial" });
// Yorgos mostly uses a phone.
test.use({
  viewport: PHONE,
  extraHTTPHeaders: { "x-forwarded-for": testAddress() },
});

const WRONG = "That email or password is not right.";
const LOCKED = /Too many tries/;

let owner: TestUser;
let staff: TestUser;
let stranger: TestUser;
let lockedOut: TestUser;
let resetter: TestUser;

test.beforeAll(async () => {
  await sweepAbandonedUsers();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");
  stranger = await createTestUser(null);
  lockedOut = await createTestUser("staff");
  resetter = await createTestUser("staff");
});

test.afterAll(async () => {
  await deleteCreatedUsers();
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
    email: testEmail(),
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
  const email = testEmail();
  for (let i = 0; i < 5; i += 1) {
    await signInWithPassword(page, { email, password: "wrong" });
    await alert(page).waitFor();
  }
  await expect(alert(page)).toHaveText(LOCKED);
});

test("attempts are stored apart from the audit log, with no readable email", async () => {
  const { rows } = await db.query(
    `select scope, key_hash from public.admin_attempts order by id desc limit 50`,
  );
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) {
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain("@");
  }
  const audit = await db.query(
    `select count(*)::int as n from public.audit_log where entity = 'admin_attempt'`,
  );
  expect(audit.rows[0].n).toBe(0);
});

test("a stranger's failures do not lock the real user out", async ({
  browser,
}) => {
  const victim = await createTestUser("staff");
  const attacker = await (await browser.newContext(phone())).newPage();
  for (let i = 0; i < 6; i += 1) {
    await signInWithPassword(attacker, {
      email: victim.email,
      password: "wrong",
    });
    await alert(attacker).waitFor();
  }
  await expect(alert(attacker)).toHaveText(LOCKED);

  const real = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(real, victim);
  await expect(real).toHaveURL(/\/admin$/);
});

test("changing the left of x-forwarded-for does not dodge the lock", async ({
  browser,
}) => {
  const hop = testAddress();
  const spoofed = testAddress();
  const email = testEmail();
  const page = await (await browser.newContext(phone())).newPage();
  for (let i = 0; i < 6; i += 1) {
    await page.setExtraHTTPHeaders({
      "x-forwarded-for": `${i === 0 ? spoofed : testAddress()}, ${hop}`,
      // Plain client input anywhere but Vercel, so it must change nothing.
      "x-vercel-forwarded-for": i === 0 ? spoofed : testAddress(),
    });
    await signInWithPassword(page, { email, password: "wrong" });
    await alert(page).waitFor();
  }
  await expect(alert(page)).toHaveText(LOCKED);
  expect(await countAttempts("login_pair", emailAtAddress(email, hop))).toBe(5);
  expect(await countAttempts("login_ip", hop)).toBe(6);
  expect(await countAttempts("login_ip", spoofed)).toBe(0);
});

test("a locked address is refused first and adds nothing else", async ({
  browser,
}) => {
  const address = testAddress();
  const user = await createTestUser("staff");
  await seedAttempts("login_ip", address, 20);

  const page = await (await browser.newContext(phone(address))).newPage();
  await signInWithPassword(page, user);
  await expect(alert(page)).toHaveText(LOCKED);

  expect(await countAttempts("login_ip", address)).toBe(20);
  expect(await countAttempts("login_email", user.email)).toBe(0);
  expect(
    await countAttempts("login_pair", emailAtAddress(user.email, address)),
  ).toBe(0);
});

test("the address limit counts wrong passwords across emails", async ({
  browser,
}) => {
  const address = testAddress();
  await seedAttempts("login_ip", address, 19);
  const page = await (await browser.newContext(phone(address))).newPage();
  await signInWithPassword(page, { email: testEmail(), password: "wrong" });
  await expect(alert(page)).toHaveText(WRONG);

  await signInWithPassword(page, { email: testEmail(), password: "wrong" });
  await expect(alert(page)).toHaveText(LOCKED);
});

test("a correct login does not wipe the address count", async ({ browser }) => {
  const address = testAddress();
  const user = await createTestUser("staff");
  await seedAttempts("login_ip", address, 3);
  const page = await (await browser.newContext(phone(address))).newPage();
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/admin$/);
  expect(await countAttempts("login_ip", address)).toBe(3);
});

test("the email ceiling stops a crowd, except on a known device", async ({
  browser,
}) => {
  const user = await createTestUser("staff");
  const known = await browser.newContext(phone());
  const knownPage = await known.newPage();
  await signInWithPassword(knownPage, user);
  await expect(knownPage).toHaveURL(/\/admin$/);
  await known.clearCookies({ name: /auth-token|cf_admin_activity/ });

  await seedAttempts("login_email", user.email, 50);

  const unknown = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(unknown, user);
  await expect(alert(unknown)).toHaveText(LOCKED);

  const forged = await browser.newContext(phone());
  await forged.addCookies([
    {
      name: "cf_admin_device",
      value: "A".repeat(43),
      url: test.info().project.use.baseURL!,
    },
  ]);
  const forgedPage = await forged.newPage();
  await signInWithPassword(forgedPage, user);
  await expect(alert(forgedPage)).toHaveText(LOCKED);

  await signInWithPassword(knownPage, user);
  await expect(knownPage).toHaveURL(/\/admin$/);
});

test("reset requests are limited by address first", async ({ page }) => {
  const address = testAddress();
  const email = testEmail();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": address });
  await seedAttempts("reset_ip", address, 10);

  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");

  expect(await countAttempts("reset_ip", address)).toBe(10);
  expect(await countAttempts("reset_email", email)).toBe(0);
});

test("one stranger using up reset links does not block the real user", async ({
  page,
}) => {
  const email = testEmail();
  const stranger = testAddress();
  const real = testAddress();
  await seedAttempts("reset_pair", emailAtAddress(email, stranger), 3);

  await page.setExtraHTTPHeaders({ "x-forwarded-for": real });
  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");

  expect(await countAttempts("reset_pair", emailAtAddress(email, real))).toBe(
    1,
  );
  expect(await countAttempts("reset_email", email)).toBe(1);
});

test("the security headers are sent and the page still works under them", async ({
  browser,
  request,
}) => {
  const res = await request.get("/admin/login");
  const csp = res.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("img-src 'self' data:");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(csp).toContain("base-uri 'none'");
  expect(csp).toContain("form-action 'self'");
  expect(csp).toContain(
    `connect-src 'self' ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin}`,
  );
  expect(res.headers()["strict-transport-security"]).toBe("max-age=31536000");

  const redirect = await request.get("/admin/rules", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["content-security-policy"]).toBe(csp);

  const user = await createTestUser("owner");
  const page = await (await browser.newContext(phone())).newPage();
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text())) {
      violations.push(message.text());
    }
  });
  page.on("pageerror", (error) => violations.push(error.message));

  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.getByRole("button", { name: "Start setup" }).click();
  const qr = page.getByAltText("QR code for your authenticator app");
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await page.goto("/admin/mfa");
  await enrolOwner(page, user);
  await page.goto("/admin/rules");
  await page.getByRole("button", { name: "Add a line" }).click();
  expect(violations).toEqual([]);
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

  const audit = await db.query(
    `select actor_id, entity_id from public.audit_log
     where action = 'mfa_enrolled' and entity_id = $1`,
    [owner.id],
  );
  expect(audit.rows).toEqual([{ actor_id: owner.id, entity_id: owner.id }]);
});

test("an abandoned setup can be started again", async ({ browser }) => {
  const fresh = await createTestUser("owner");
  const page = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(page, fresh);
  await page.getByRole("button", { name: "Start setup" }).click();
  await expect(page.getByTestId("totp-secret")).toBeVisible();
  await page.reload();
  await enrolOwner(page, fresh);
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
  const first = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(first, user);
  await enrolOwner(first, user);

  const page = await (await browser.newContext(phone())).newPage();
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
  const page = await (await browser.newContext(phone())).newPage();

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
});

test("Staff can turn on the optional second step", async ({ browser }) => {
  const user = await createTestUser("staff");
  const page = await (await browser.newContext(phone())).newPage();
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
  const next = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(next, user);
  await expect(next).toHaveURL(/\/admin\/mfa$/);
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

test("a correctly signed cookie ends the session once it is too old", async ({
  browser,
}) => {
  const user = await createTestUser("staff");
  const context = await browser.newContext(phone());
  const page = await context.newPage();
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/admin$/);

  const { rows } = await db.query(
    `select id from auth.sessions where user_id = $1 order by created_at desc limit 1`,
    [user.id],
  );
  const activity = (await context.cookies()).find(
    (cookie) => cookie.name === "cf_admin_activity",
  )!;
  const signedAt = (secondsAgo: number) =>
    createActivityValue(
      rows[0].id,
      Math.floor(Date.now() / 1000) - secondsAgo,
      process.env.SUPABASE_SECRET_KEY!,
    );

  // Just inside the limit still works, which proves the signature is right.
  await context.addCookies([{ ...activity, value: signedAt(59 * 60) }]);
  await page.goto("/admin/account");
  await expect(page).toHaveURL(/\/admin\/account$/);

  await context.addCookies([{ ...activity, value: signedAt(61 * 60) }]);
  await page.goto("/admin/account");
  await expect(page).toHaveURL(/\/admin\/login\?expired=1$/);
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
  await page.getByLabel("Email").fill(testEmail());
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");
});

test("a reset link sets a new password and old sessions end", async ({
  browser,
}) => {
  const oldContext = await browser.newContext(phone());
  const oldPage = await oldContext.newPage();
  await signInWithPassword(oldPage, resetter);
  await expect(oldPage).toHaveURL(/\/admin$/);

  const { data, error } = await authAdmin.generateLink({
    type: "recovery",
    email: resetter.email,
  });
  if (error) throw error;

  const page = await (await browser.newContext(phone())).newPage();
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

  const audit = await db.query(
    `select actor_id from public.audit_log
     where action = 'password_changed' and entity_id = $1`,
    [resetter.id],
  );
  expect(audit.rows).toEqual([{ actor_id: resetter.id }]);

  // The old session was signed out, and the old password is gone.
  await oldPage.goto("/admin/account");
  await expect(oldPage).toHaveURL(/\/admin\/login/);
  const third = await (await browser.newContext(phone())).newPage();
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

  const page = await (await browser.newContext(phone())).newPage();
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

  const check = await (await browser.newContext(phone())).newPage();
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

test("an invite link sets a password and lets the new person in", async ({
  browser,
}) => {
  const email = testEmail();
  const { data, error } = await authAdmin.generateLink({
    type: "invite",
    email,
  });
  if (error) throw error;
  rememberUser(data.user.id, email);
  await db.query(
    `insert into public.admin_profiles (id, role, display_name) values ($1, 'staff', 'Invited')`,
    [data.user.id],
  );

  // The exact link in supabase/templates/invite.html.
  const page = await (await browser.newContext(phone())).newPage();
  await page.goto(
    `/admin/auth/confirm?token_hash=${data.properties.hashed_token}&type=invite`,
  );
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/new-password$/);

  const password = "a generated invite test value";
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Type it again").fill(password);
  await page.getByRole("button", { name: "Save my new password" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  const next = await (await browser.newContext(phone())).newPage();
  await signInWithPassword(next, { email, password });
  await expect(next).toHaveURL(/\/admin$/);
});

// Local Supabase allows 2 emails an hour across all worktrees. If that is used
// up this test fails, on purpose: a reset flow that sends no mail must not
// pass. The rest of the flow is also covered through generateLink above.
test("the reset email itself arrives and its link works", async ({ page }) => {
  await page.goto("/admin/forgot-password");
  await page.getByLabel("Email").fill(resetter.email);
  await page.getByRole("button", { name: "Send the link" }).click();
  await expect(page.getByRole("status")).toContainText("If that email has");

  await expect
    .poll(() => latestMail(resetter.email), {
      timeout: 5000,
      message: "No reset email. Is the local limit of 2 an hour used up?",
    })
    .not.toBeNull();
  const mail = (await latestMail(resetter.email))!;
  const link = /href="([^"]+)"/.exec(mail)?.[1]?.replaceAll("&amp;", "&");
  expect(link).toBeTruthy();

  // Works before and after LEAD's template goes live: the new template links
  // straight to the page, the old one goes through Supabase first. Supabase's
  // default site address differs from this port, so only the query is kept.
  let query = new URL(link!).search;
  if (link!.includes("/auth/v1/verify")) {
    const verified = await fetch(link!, { redirect: "manual" });
    query = new URL(verified.headers.get("location")!).search;
  }
  expect(query).toMatch(/code=|token_hash=/);

  await page.goto(`/admin/auth/confirm${query}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin\/new-password$/);
});
