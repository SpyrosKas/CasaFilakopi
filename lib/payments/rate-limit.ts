import { attemptHash } from "@/lib/admin/activity";
import { pickClientAddress } from "@/lib/admin/client-address";
import type { PayDb } from "./deps";

// Tries are rows in admin_attempts, shared by every server, with the address
// only as a keyed hash. Row first and count second, so a burst cannot all pass.

export interface Limit {
  scope: string;
  max: number;
  windowMs: number;
}

const minutes = (count: number) => count * 60_000;

export const LIMITS = {
  /** A guest trying dates in the calendar. One hit per change of dates. */
  quote: { scope: "pay_quote", max: 60, windowMs: minutes(5) },
  availability: { scope: "pay_availability", max: 60, windowMs: minutes(5) },
  /** Each try takes the dates for 35 minutes, so this one is tight. */
  checkout: { scope: "pay_checkout", max: 8, windowMs: minutes(15) },
  /**
   * All guests together, counted only after Turnstile has passed, so a few
   * addresses cannot use it up and lock real guests out.
   */
  checkoutSite: { scope: "pay_checkout_site", max: 200, windowMs: minutes(15) },
  /** Wrong codes only, so a guest changing dates keeps their real one. */
  promo: { scope: "pay_promo", max: 10, windowMs: minutes(15) },
  status: { scope: "pay_status", max: 120, windowMs: minutes(10) },
  release: { scope: "pay_release", max: 30, windowMs: minutes(15) },
  balance: { scope: "pay_balance", max: 20, windowMs: minutes(15) },
  guestCancel: { scope: "pay_guest_cancel", max: 10, windowMs: minutes(15) },
  guestMessage: { scope: "pay_guest_message", max: 6, windowMs: minutes(60) },
} satisfies Record<string, Limit>;

export const requestAddress = (request: Request) =>
  pickClientAddress(
    (name) => request.headers.get(name),
    Boolean(process.env.VERCEL),
  );

async function countTries(
  db: PayDb,
  limit: Limit,
  key_hash: string,
): Promise<number> {
  const since = new Date(Date.now() - limit.windowMs).toISOString();
  const { count, error } = await db
    .from("admin_attempts")
    .select("id", { count: "exact", head: true })
    .eq("scope", limit.scope)
    .eq("key_hash", key_hash)
    .gt("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function addTry(db: PayDb, limit: Limit, key_hash: string) {
  const { error } = await db
    .from("admin_attempts")
    .insert({ scope: limit.scope, key_hash });
  if (error) throw new Error(error.message);
}

/** True when this try is over the limit. */
export async function isOverLimit(
  db: PayDb,
  limit: Limit,
  key: string,
  secret: string,
): Promise<boolean> {
  const hash = attemptHash(secret, key);
  // Already over: adds no row, so hammering does not fill the table.
  if ((await countTries(db, limit, hash)) >= limit.max) return true;
  await addTry(db, limit, hash);
  return (await countTries(db, limit, hash)) > limit.max;
}

/** For a limit counted only on failures: the check and the count are apart. */
export async function hasUsedUp(
  db: PayDb,
  limit: Limit,
  key: string,
  secret: string,
): Promise<boolean> {
  return (await countTries(db, limit, attemptHash(secret, key))) >= limit.max;
}

export const countFailure = (
  db: PayDb,
  limit: Limit,
  key: string,
  secret: string,
) => addTry(db, limit, attemptHash(secret, key));
