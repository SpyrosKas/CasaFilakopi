import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, type Browser, type Page } from "@playwright/test";
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

export async function createTestUser(
  role: "owner" | "staff" | null,
): Promise<TestUser> {
  const email = `admin-e2e-${randomUUID()}@example.test`;
  const password = randomBytes(18).toString("base64url");
  const { data, error } = await auth.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw error;
  if (role) {
    await db.query(
      `insert into public.admin_profiles (id, role, display_name) values ($1, $2, 'Test')`,
      [data.user.id, role],
    );
  }
  return { id: data.user.id, email, password };
}

export async function deleteTestUser(user: TestUser): Promise<void> {
  await auth.deleteUser(user.id);
}

/** Removes the lockout rows these tests add, so reruns start clean. */
export async function clearAttempts(): Promise<void> {
  await db.query(`delete from public.audit_log where entity = 'admin_attempt'`);
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
  const context = await browser.newContext({ viewport });
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
