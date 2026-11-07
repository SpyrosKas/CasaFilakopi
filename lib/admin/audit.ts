import "server-only";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import type { Database, Json } from "@/lib/db/types";

// Database triggers record table changes (ADM-04). Use this helper for what
// they cannot see, such as a password change or a new second factor, which
// happen inside Supabase Auth. The caller must already know who the user is.

export async function writeAudit(
  admin: Pick<AdminContext, "userId">,
  entry: {
    action: string;
    entity: string;
    entityId?: string;
    before?: Json;
    after?: Json;
  },
): Promise<void> {
  const { error } = await createAdminClient()
    .from("audit_log")
    .insert({
      actor_id: admin.userId,
      action: entry.action,
      entity: entry.entity,
      entity_id: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  if (error) throw error;
}

type Functions = Database["public"]["Functions"];

/** Database functions that name the admin behind them. */
type ActorFunction = {
  [K in keyof Functions]: "p_actor" extends keyof Functions[K]["Args"]
    ? K
    : never;
}[keyof Functions];

/**
 * The secret key skips the MFA check inside RLS, so anything that uses it
 * asks the database first, through the user's own client.
 */
export async function assertAdminRole(admin: AdminContext): Promise<void> {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error) throw error;
  if (!role) throw new Error("not_authorised");
}

// The generated types cannot follow a generic function name.
function secretRpc() {
  return createAdminClient() as unknown as {
    rpc(
      name: string,
      params: unknown,
    ): PromiseLike<{ data: unknown; error: Error | null }>;
  };
}

/**
 * Calls a secret-key database function as an admin, after the role check. The
 * admin's id goes in as p_actor so the audit log names them.
 */
export async function callAdminRpc<K extends ActorFunction>(
  admin: AdminContext,
  fn: K,
  args: Omit<Functions[K]["Args"], "p_actor">,
): Promise<Functions[K]["Returns"]> {
  await assertAdminRole(admin);
  const { data, error } = await secretRpc().rpc(fn, {
    ...args,
    p_actor: admin.userId,
  });
  if (error) throw error;
  return data as Functions[K]["Returns"];
}

/** These three name the admin in a column of their own, not p_actor. */
const RECORDER_PARAM = {
  record_payment: "p_recorded_by",
  record_refund: "p_recorded_by",
  create_block: "p_created_by",
} as const;

type RecordingFunction = keyof typeof RECORDER_PARAM;

export async function callRecordingRpc<K extends RecordingFunction>(
  admin: AdminContext,
  fn: K,
  args: Omit<Functions[K]["Args"], (typeof RECORDER_PARAM)[K]>,
): Promise<Functions[K]["Returns"]> {
  await assertAdminRole(admin);
  const { data, error } = await secretRpc().rpc(fn, {
    ...args,
    [RECORDER_PARAM[fn]]: admin.userId,
  });
  if (error) throw error;
  return data as Functions[K]["Returns"];
}
