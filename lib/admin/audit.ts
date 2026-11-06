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
 * Calls a secret-key database function as an admin. The secret key skips the
 * MFA check inside RLS, so the role is checked through the user's own client
 * first. The admin's id goes in as p_actor so the audit log names them.
 */
export async function callAdminRpc<K extends ActorFunction>(
  admin: AdminContext,
  fn: K,
  args: Omit<Functions[K]["Args"], "p_actor">,
): Promise<Functions[K]["Returns"]> {
  const { data: role, error: roleError } =
    await admin.supabase.rpc("current_admin_role");
  if (roleError) throw roleError;
  if (!role) throw new Error("not_authorised");

  // The generated types cannot follow a generic function name.
  const db = createAdminClient() as unknown as {
    rpc(
      name: string,
      params: unknown,
    ): PromiseLike<{ data: unknown; error: Error | null }>;
  };
  const { data, error } = await db.rpc(fn, {
    ...args,
    p_actor: admin.userId,
  });
  if (error) throw error;
  return data as Functions[K]["Returns"];
}
