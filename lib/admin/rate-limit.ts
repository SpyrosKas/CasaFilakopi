import "server-only";
import { headers } from "next/headers";
import { attemptHash } from "@/lib/admin/activity";
import { pickClientAddress } from "@/lib/admin/client-address";
import {
  ATTEMPT_LIMITS,
  LOCK_WINDOW_MINUTES,
  type AttemptKind,
} from "@/lib/admin/config";
import { createAdminClient } from "@/lib/db/admin";
import { getServerEnv } from "@/lib/env.server";

// Lockout (ADM-03). Attempts are rows in admin_attempts, not memory, because
// the app runs on many short-lived servers. Each try adds its row before the
// check that lets it through, so a burst of guesses at once cannot all pass.
// Emails and addresses are stored only as keyed hashes.

const hashOf = (value: string) =>
  attemptHash(getServerEnv().SUPABASE_SECRET_KEY, value);

async function countAttempts(
  kind: AttemptKind,
  value: string,
): Promise<number> {
  const windowStart = new Date(
    Date.now() - LOCK_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const { count, error } = await createAdminClient()
    .from("admin_attempts")
    .select("id", { count: "exact", head: true })
    .eq("scope", kind)
    .eq("key_hash", hashOf(value))
    .gt("created_at", windowStart);
  if (error) throw error;

  return count ?? 0;
}

/** Whether this value has used up its tries. */
export async function isLocked(
  kind: AttemptKind,
  value: string,
): Promise<boolean> {
  return (await countAttempts(kind, value)) >= ATTEMPT_LIMITS[kind];
}

/**
 * Takes one try. Returns its id, or null if it may not go ahead. Already
 * locked values add no row, so hammering a lock does not fill the table.
 */
export async function claimAttempt(
  kind: AttemptKind,
  value: string,
): Promise<number | null> {
  if (await isLocked(kind, value)) return null;

  const { data, error } = await createAdminClient()
    .from("admin_attempts")
    .insert({ scope: kind, key_hash: hashOf(value) })
    .select("id")
    .single();
  if (error) throw error;

  const allowed = (await countAttempts(kind, value)) <= ATTEMPT_LIMITS[kind];
  return allowed ? data.id : null;
}

/** Hands back one try that turned out to be genuine. */
export async function releaseAttempt(id: number | null): Promise<void> {
  if (id === null) return;
  const { error } = await createAdminClient()
    .from("admin_attempts")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/** Clears a count. Only after a correct password or code. */
export async function clearAttempts(
  kind: AttemptKind,
  value: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("admin_attempts")
    .delete()
    .eq("scope", kind)
    .eq("key_hash", hashOf(value));
  if (error) throw error;
}

export async function clientAddress(): Promise<string> {
  const list = await headers();
  return pickClientAddress(
    (name) => list.get(name),
    Boolean(process.env.VERCEL),
  );
}

/** Waits until the answer has taken at least this long. */
export async function holdUntil(startedAt: number, minMs: number) {
  const left = minMs - (Date.now() - startedAt);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}
