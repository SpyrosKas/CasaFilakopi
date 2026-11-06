import "server-only";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { deriveKey } from "@/lib/admin/activity";
import {
  ATTEMPT_LIMITS,
  LOCK_WINDOW_MINUTES,
  type AttemptKind,
} from "@/lib/admin/config";
import { createAdminClient } from "@/lib/db/admin";
import { getServerEnv } from "@/lib/env.server";

// Lockout (ADM-03). Attempts are rows in audit_log, not memory, because the
// app runs on many short-lived servers. Each try adds its row before the check
// that lets it through, so a burst of guesses at once cannot all pass. The
// Owner can see these rows in the audit log. Emails and addresses are stored
// only as keyed hashes.

const ENTITY = "admin_attempt";

function keyFor(kind: AttemptKind, value: string): string {
  const key = deriveKey(
    getServerEnv().SUPABASE_SECRET_KEY,
    "admin-attempts-v1",
  );
  const hash = createHmac("sha256", key).update(value).digest("hex");
  return `${kind}:${hash}`;
}

/** Tries used so far, counted since the last success. */
async function countAttempts(
  kind: AttemptKind,
  value: string,
): Promise<number> {
  const db = createAdminClient();
  const entityId = keyFor(kind, value);
  const windowStart = new Date(
    Date.now() - LOCK_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const { data: lastSuccess, error: successError } = await db
    .from("audit_log")
    .select("created_at")
    .eq("entity", ENTITY)
    .eq("entity_id", entityId)
    .eq("action", "attempt_ok")
    .gte("created_at", windowStart)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (successError) throw successError;

  const { count, error } = await db
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("entity", ENTITY)
    .eq("entity_id", entityId)
    .eq("action", "attempt_failed")
    .gt("created_at", lastSuccess?.created_at ?? windowStart);
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
 * Takes one try, and says whether it may go ahead. The row stays unless
 * recordSuccess follows. Already locked values add no row, so hammering a
 * locked account does not fill the table.
 */
export async function claimAttempt(
  kind: AttemptKind,
  value: string,
): Promise<boolean> {
  if (await isLocked(kind, value)) return false;
  await recordAttempt(kind, value);
  return (await countAttempts(kind, value)) <= ATTEMPT_LIMITS[kind];
}

export async function recordAttempt(
  kind: AttemptKind,
  value: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      action: "attempt_failed",
      entity: ENTITY,
      entity_id: keyFor(kind, value),
    });
  if (error) throw error;
}

/** Clears the count. Only after a correct password or code. */
export async function recordSuccess(
  kind: AttemptKind,
  value: string,
  actorId: string,
): Promise<void> {
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      actor_id: actorId,
      action: "attempt_ok",
      entity: ENTITY,
      entity_id: keyFor(kind, value),
    });
  if (error) throw error;
}

/** The caller's address. Vercel sets this header, so a browser cannot. */
export async function clientAddress(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip") || "unknown";
}

/** Waits until the answer has taken at least this long. */
export async function holdUntil(startedAt: number, minMs: number) {
  const left = minMs - (Date.now() - startedAt);
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
}
