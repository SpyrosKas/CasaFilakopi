import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import {
  authAdmin,
  createTestUser,
  db,
  deleteCreatedUsers,
  lockSharedSettings,
  releaseSharedSettings,
  enrolOwner,
  signInWithPassword,
  testAddress,
  totpCode,
  type TestUser,
} from "./admin-helpers";

// Server actions are public POST endpoints: a stolen password or a replayed
// request reaches them without any page. These tests capture real requests
// from a real Owner, then send the same bytes as other people. Each table also
// sends them as the Owner first, which proves the replay itself works and a
// refusal below means the guard refused, not that the request was malformed.

test.describe.configure({ mode: "serial" });

interface CapturedAction {
  action: string;
  contentType: string;
  body: Buffer;
}

const context = (browser: Browser) =>
  browser.newContext({
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
    viewport: { width: 375, height: 812 },
  });

/** Lets one form submit reach the network, keeps it, and stops it there. */
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

/** Where a server action sent the caller, whichever way Next.js answered. */
function redirectTarget(response: {
  headers(): Record<string, string>;
}): string {
  const headers = response.headers();
  const target = headers["x-action-redirect"] ?? headers.location ?? "";
  return target.split(";")[0];
}

const FORGED_PHONE = "+30 000 REPLAYED";
const FORGED_NAME = "Replayed house";
const FORGED_HOLD = 77;

async function storedValues() {
  const property = await db.query(`select phone from public.property`);
  const house = await db.query(
    `select name->>'en' as name from public.rooms
     where id = '00000000-0000-4000-8000-000000000001'`,
  );
  const booking = await db.query(
    `select value from public.settings where key = 'booking'`,
  );
  const payment = await db.query(
    `select value from public.settings where key = 'payment'`,
  );
  const policy = await db.query(
    `select tiers, is_non_refundable from public.cancellation_policies where is_default`,
  );
  return {
    phone: property.rows[0].phone,
    name: house.rows[0].name,
    booking: booking.rows[0].value,
    payment: payment.rows[0].value,
    policy: policy.rows[0],
  };
}

async function factorCount(userId: string): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from auth.mfa_factors where user_id = $1`,
    [userId],
  );
  return rows[0].n;
}

async function passwordHash(userId: string): Promise<string> {
  const { rows } = await db.query(
    `select encrypted_password from auth.users where id = $1`,
    [userId],
  );
  return rows[0].encrypted_password;
}

let owner: TestUser;
let staff: TestUser;
let staffWithTotp: TestUser;
let ownerPage: Page;
let staffContext: BrowserContext;
let staffTotpContext: BrowserContext;
let ownerAal1Context: BrowserContext;
let anonymous: BrowserContext;
let removedAdminContext: BrowserContext;
let before: Awaited<ReturnType<typeof storedValues>>;

const actions: Record<string, CapturedAction> = {};
const paths: Record<string, string> = {
  rules: "/admin/rules",
  property: "/admin/property",
  house: "/admin/house",
  booking: "/admin/booking",
};

test.beforeAll(async ({ browser }) => {
  await lockSharedSettings();
  before = await storedValues();
  owner = await createTestUser("owner");
  staff = await createTestUser("staff");
  staffWithTotp = await createTestUser("staff");

  // A real Owner, past MFA.
  ownerPage = await (await context(browser)).newPage();
  await signInWithPassword(ownerPage, owner);
  await enrolOwner(ownerPage, owner);

  // Plain Staff.
  staffContext = await context(browser);
  const staffPage = await staffContext.newPage();
  await signInWithPassword(staffPage, staff);
  await expect(staffPage).toHaveURL(/\/admin$/);

  // Staff who turned MFA on, past MFA.
  staffTotpContext = await context(browser);
  const totpPage = await staffTotpContext.newPage();
  await signInWithPassword(totpPage, staffWithTotp);
  await expect(totpPage).toHaveURL(/\/admin$/);
  await totpPage.goto("/admin/account/two-step");
  await totpPage.getByRole("button", { name: "Start setup" }).click();
  const secret = (await totpPage.getByTestId("totp-secret").textContent())!;
  await totpPage.getByLabel("6-digit code").fill(totpCode(secret.trim()));
  await totpPage.getByRole("button", { name: "Finish setup" }).click();
  await expect(totpPage).toHaveURL(/\/admin$/);

  // The same Owner with only a stolen password: stopped at the code screen.
  ownerAal1Context = await context(browser);
  const aal1Page = await ownerAal1Context.newPage();
  await signInWithPassword(aal1Page, owner);
  await expect(aal1Page).toHaveURL(/\/admin\/mfa$/);

  anonymous = await context(browser);

  // Anonymous requests stop at proxy.ts, before any action runs. A valid login
  // whose admin profile was removed gets past it, so this is what proves each
  // action's own check turns away someone who is not an admin.
  const removedAdmin = await createTestUser("staff");
  removedAdminContext = await context(browser);
  const removedPage = await removedAdminContext.newPage();
  await signInWithPassword(removedPage, removedAdmin);
  await expect(removedPage).toHaveURL(/\/admin$/);
  await db.query(`delete from public.admin_profiles where id = $1`, [
    removedAdmin.id,
  ]);

  // Real requests, each carrying a change that is easy to spot if it lands.
  const save = () =>
    ownerPage.getByRole("button", { name: "Save", exact: true }).click();

  await ownerPage.goto("/admin/property");
  await ownerPage.getByLabel("Phone").fill(FORGED_PHONE);
  actions.property = await capture(ownerPage, save);

  await ownerPage.goto("/admin/house");
  await ownerPage.getByLabel("Name in English").fill(FORGED_NAME);
  actions.house = await capture(ownerPage, save);

  await ownerPage.goto("/admin/booking");
  await ownerPage
    .getByLabel("Minutes a guest has to finish paying")
    .fill(String(FORGED_HOLD));
  actions.booking = await capture(ownerPage, save);

  await ownerPage.goto("/admin/rules");
  await ownerPage.getByRole("radio", { name: /^Full payment/ }).check();
  await ownerPage.getByLabel("No refunds, ever").check();
  actions.rules = await capture(ownerPage, save);
});

test.afterAll(async () => {
  await db.query(`update public.property set phone = $1`, [before.phone]);
  await db.query(
    `update public.rooms set name = jsonb_set(name, '{en}', to_jsonb($1::text))
     where id = '00000000-0000-4000-8000-000000000001'`,
    [before.name],
  );
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'booking'`,
    [JSON.stringify(before.booking)],
  );
  await db.query(
    `update public.settings set value = $1::jsonb where key = 'payment'`,
    [JSON.stringify(before.payment)],
  );
  await db.query(
    `update public.cancellation_policies set tiers = $1::jsonb, is_non_refundable = $2 where is_default`,
    [JSON.stringify(before.policy.tiers), before.policy.is_non_refundable],
  );
  await deleteCreatedUsers();
  await releaseSharedSettings();
});

for (const name of Object.keys(paths)) {
  test.describe(`the ${name} action`, () => {
    test("is refused for Staff, and the database agrees", async () => {
      const response = await replay(
        staffContext.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(response)).toBe("/admin/not-allowed");
      expect(await storedValues()).toEqual(before);
    });

    test("is refused for an Owner with only a password", async () => {
      const response = await replay(
        ownerAal1Context.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(response)).toBe("/admin/mfa");
      expect(await storedValues()).toEqual(before);
    });

    test("is refused for a login that is no longer an admin", async () => {
      const response = await replay(
        removedAdminContext.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(response)).toBe("/admin/login");
      expect(await storedValues()).toEqual(before);
    });

    test("is refused with no session, on its own page or an open one", async () => {
      for (const path of [paths[name], "/admin/login"]) {
        await replay(anonymous.request, path, actions[name]);
        expect(await storedValues()).toEqual(before);
      }
      const response = await replay(
        anonymous.request,
        paths[name],
        actions[name],
      );
      expect(redirectTarget(response)).toBe("/admin/login");
    });
  });
}

test("the same bytes work for the real Owner, so the refusals above mean something", async () => {
  const request = ownerPage.context().request;
  for (const name of Object.keys(paths)) {
    const response = await replay(request, paths[name], actions[name]);
    expect(response.status(), name).toBe(200);
  }
  const after = await storedValues();
  expect(after.phone).toBe(FORGED_PHONE);
  expect(after.name).toBe(FORGED_NAME);
  expect(after.booking.holdMinutes).toBe(FORGED_HOLD);
  expect(after.payment.mode).toBe("full");
  expect(after.policy.is_non_refundable).toBe(true);
});

test.describe("adding a second factor", () => {
  let startEnrolment: CapturedAction;

  test.beforeAll(async ({ browser }) => {
    const fresh = await createTestUser("owner");
    const page = await (await context(browser)).newPage();
    await signInWithPassword(page, fresh);
    await expect(page).toHaveURL(/\/admin\/mfa$/);
    startEnrolment = await capture(page, () =>
      page.getByRole("button", { name: "Start setup" }).click(),
    );
    await page.context().close();
  });

  test("the captured request does work for an Owner with no factor", async ({
    browser,
  }) => {
    const fresh = await createTestUser("owner");
    const freshContext = await context(browser);
    const page = await freshContext.newPage();
    await signInWithPassword(page, fresh);
    await expect(page).toHaveURL(/\/admin\/mfa$/);

    const response = await replay(
      freshContext.request,
      "/admin/mfa",
      startEnrolment,
    );
    expect(response.status()).toBe(200);
    expect(await factorCount(fresh.id)).toBe(1);
  });

  test("an Owner with only a password cannot add one", async () => {
    const response = await replay(
      ownerAal1Context.request,
      "/admin/mfa",
      startEnrolment,
    );
    expect(redirectTarget(response)).toBe("/admin");
    expect(await factorCount(owner.id)).toBe(1);
  });

  test("an Owner past MFA cannot quietly add a second one", async () => {
    const response = await replay(
      ownerPage.context().request,
      "/admin/mfa",
      startEnrolment,
    );
    expect(redirectTarget(response)).toBe("/admin");
    expect(await factorCount(owner.id)).toBe(1);
  });

  test("Staff with a factor cannot add a second one", async () => {
    const response = await replay(
      staffTotpContext.request,
      "/admin/mfa",
      startEnrolment,
    );
    expect(redirectTarget(response)).toBe("/admin");
    expect(await factorCount(staffWithTotp.id)).toBe(1);
  });

  test("nobody without an admin session can start one", async () => {
    for (const request of [anonymous.request, removedAdminContext.request]) {
      const response = await replay(request, "/admin/mfa", startEnrolment);
      expect(redirectTarget(response)).toBe("/admin/login");
    }
  });
});

test.describe("setting a new password", () => {
  let setPassword: CapturedAction;
  let resetUser: TestUser;

  test.beforeAll(async ({ browser }) => {
    resetUser = await createTestUser("staff");
    const { data, error } = await authAdmin.generateLink({
      type: "recovery",
      email: resetUser.email,
    });
    if (error) throw error;

    const page = await (await context(browser)).newPage();
    await page.goto(
      `/admin/auth/confirm?token_hash=${data.properties.hashed_token}&type=recovery`,
    );
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page).toHaveURL(/\/admin\/new-password$/);
    const password = "a generated replay test value";
    await page.getByLabel("New password", { exact: true }).fill(password);
    await page.getByLabel("Type it again").fill(password);
    setPassword = await capture(page, () =>
      page.getByRole("button", { name: "Save my new password" }).click(),
    );
  });

  test("a normal Staff session cannot use it", async () => {
    const hash = await passwordHash(staff.id);
    const response = await replay(
      staffContext.request,
      "/admin/new-password",
      setPassword,
    );
    expect(redirectTarget(response)).toBe("/admin/login");
    expect(await passwordHash(staff.id)).toBe(hash);
  });

  test("an Owner with only a password cannot use it", async () => {
    const hash = await passwordHash(owner.id);
    const response = await replay(
      ownerAal1Context.request,
      "/admin/new-password",
      setPassword,
    );
    expect(redirectTarget(response)).toBe("/admin/login");
    expect(await passwordHash(owner.id)).toBe(hash);
  });

  test("nobody without an admin session can use it", async () => {
    for (const request of [anonymous.request, removedAdminContext.request]) {
      const response = await replay(
        request,
        "/admin/new-password",
        setPassword,
      );
      expect(redirectTarget(response)).toBe("/admin/login");
    }
  });
});
