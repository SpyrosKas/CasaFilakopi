import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { attemptHash } from "@/lib/admin/activity";
import { emailAtAddress } from "@/lib/admin/client-address";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

// Test users live only for the run, with generated values, and go through the
// local admin API. Nothing here can reach a hosted project: DB_URL is fixed.

process.loadEnvFile(".env.local");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(supabaseUrl)) {
  throw new Error("Admin end-to-end tests run against local Supabase only");
}

const auth = createClient(supabaseUrl, process.env.SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
}).auth.admin;

export { auth as authAdmin };

export const db = new pg.Pool({
  connectionString: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  max: 4,
});

export const MAILPIT_URL = "http://127.0.0.1:54324";

export interface TestUser {
  id: string;
  email: string;
  password: string;
  totpSecret?: string;
}

let settingsLock: pg.PoolClient | null = null;

/**
 * Spec files that write the one shared row of settings, property or the house
 * take turns, across workers and across runs. Call first in beforeAll, and
 * pair with releaseSharedSettings in afterAll.
 */
export async function lockSharedSettings(): Promise<void> {
  test.setTimeout(240_000);
  settingsLock = await db.connect();
  await settingsLock.query(`select pg_advisory_lock(hashtext('admin-e2e'))`);
}

export async function releaseSharedSettings(): Promise<void> {
  await settingsLock?.query(`select pg_advisory_unlock(hashtext('admin-e2e'))`);
  settingsLock?.release();
  settingsLock = null;
}

const createdUsers = new Set<string>();
const usedEmails = new Set<string>();
const usedAddresses = new Set<string>();

/** An email nobody else in any run can be using. */
export function testEmail(): string {
  const email = `admin-e2e-${randomUUID()}@example.test`;
  usedEmails.add(email);
  return email;
}

/**
 * A network address of its own, sent as x-forwarded-for. Lockouts in one test
 * then cannot reach another test, another file or another run.
 */
export function testAddress(): string {
  const part = () => randomBytes(1)[0];
  const address = `10.${part()}.${part()}.${part()}`;
  usedAddresses.add(address);
  return address;
}

export function rememberUser(id: string, email: string): void {
  createdUsers.add(id);
  usedEmails.add(email);
}

export async function createTestUser(
  role: "owner" | "staff" | null,
): Promise<TestUser> {
  const email = testEmail();
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await auth.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  createdUsers.add(data.user.id);
  if (role) {
    await db.query(
      `insert into public.admin_profiles (id, role, display_name) values ($1, $2, 'Test')`,
      [data.user.id, role],
    );
  }
  return { id: data.user.id, email, password };
}

/** Call in afterAll, so a user made inside a failing test still goes. */
export async function deleteCreatedUsers(): Promise<void> {
  for (const id of createdUsers) {
    await auth.deleteUser(id);
    createdUsers.delete(id);
  }
}

/** Catches users left by a run that was killed before its afterAll. */
export async function sweepAbandonedUsers(): Promise<void> {
  await db.query(
    `delete from auth.users
     where email like 'admin-e2e-%' and created_at < now() - interval '2 hours'`,
  );
}

export const hashOf = (value: string) =>
  attemptHash(process.env.SUPABASE_SECRET_KEY!, value);

/** Puts tries on a count directly, to test a limit without hundreds of logins. */
export async function seedAttempts(
  scope: string,
  value: string,
  count: number,
): Promise<void> {
  await db.query(
    `insert into public.admin_attempts (scope, key_hash)
     select $1, $2 from generate_series(1, $3::int)`,
    [scope, hashOf(value), count],
  );
}

export async function countAttempts(
  scope: string,
  value: string,
): Promise<number> {
  const { rows } = await db.query(
    `select count(*)::int as n from public.admin_attempts where scope = $1 and key_hash = $2`,
    [scope, hashOf(value)],
  );
  return rows[0].n;
}

/**
 * Removes only the rows this worker's own emails and addresses could have
 * made, so a run alongside this one keeps its counts.
 */
export async function clearAttempts(): Promise<void> {
  const emails = [...usedEmails];
  const addresses = [...usedAddresses];
  const values = [
    ...emails,
    ...addresses,
    ...emails.flatMap((email) =>
      addresses.map((address) => emailAtAddress(email, address)),
    ),
  ];
  await db.query(
    `delete from public.admin_attempts where key_hash = any($1::text[])`,
    [values.map(hashOf)],
  );
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  let bits = "";
  for (const char of input.replace(/=+$/, "")) {
    bits += BASE32.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** A real RFC 6238 code, as an authenticator app would show. */
export function totpCode(secret: string, atMs = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 30_000)));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

export async function signInWithPassword(
  page: Page,
  user: Pick<TestUser, "email" | "password">,
): Promise<void> {
  await page.goto("/admin/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Takes a new Owner through the forced TOTP setup. Stores the key on user. */
export async function enrolOwner(page: Page, user: TestUser): Promise<void> {
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.getByRole("button", { name: "Start setup" }).click();
  const secret = await page.getByTestId("totp-secret").textContent();
  user.totpSecret = secret!.trim();
  await page.getByLabel("6-digit code").fill(totpCode(user.totpSecret));
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export async function signInOwner(page: Page, user: TestUser): Promise<void> {
  await signInWithPassword(page, user);
  await expect(page).toHaveURL(/\/admin\/mfa$/);
  await page.getByLabel("6-digit code").fill(totpCode(user.totpSecret!));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

export async function newOwnerPage(
  browser: Browser,
  user: TestUser,
  viewport?: { width: number; height: number },
): Promise<Page> {
  const context = await browser.newContext({
    viewport,
    extraHTTPHeaders: { "x-forwarded-for": testAddress() },
  });
  const page = await context.newPage();
  await signInWithPassword(page, user);
  await enrolOwner(page, user);
  return page;
}

/** The newest message for one address, or null. */
export async function latestMail(email: string): Promise<string | null> {
  const search = await fetch(
    `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`,
  );
  const { messages } = (await search.json()) as {
    messages?: { ID: string }[];
  };
  if (!messages?.length) return null;
  const message = await fetch(
    `${MAILPIT_URL}/api/v1/message/${messages[0].ID}`,
  );
  const { Text, HTML } = (await message.json()) as {
    Text: string;
    HTML: string;
  };
  return `${Text}\n${HTML}`;
}
