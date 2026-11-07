import "server-only";
import type { User } from "@supabase/supabase-js";
import { assertAdminRole } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";

type Client = ReturnType<typeof createAdminClient>;

const PER_PAGE = 200;

/** Reads every auth user, however few: Supabase has no lookup by email. */
export async function listAuthUsers(db: Client): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; ; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PER_PAGE) return users;
  }
}

export const findAuthUser = (users: User[], email: string) =>
  users.find((user) => user.email?.toLowerCase() === email.toLowerCase());

/** One admin's role and email, read fresh for a check. */
export async function findMember(
  db: Client,
  id: string,
): Promise<{ role: "owner" | "staff"; email: string } | null> {
  const { data, error } = await db
    .from("admin_profiles")
    .select("role")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { data: found, error: authError } = await db.auth.admin.getUserById(id);
  if (authError) throw authError;
  return { role: data.role, email: found.user.email ?? "" };
}

export interface AdminMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  hasTwoStep: boolean;
}

export async function loadMembers(admin: AdminContext): Promise<AdminMember[]> {
  await assertAdminRole(admin);
  const db = createAdminClient();
  const { data, error } = await db
    .from("admin_profiles")
    .select("id, role, display_name")
    .order("created_at");
  if (error) throw error;

  const users = new Map(
    (await listAuthUsers(db)).map((user) => [user.id, user]),
  );
  return data.map((row) => {
    const user = users.get(row.id);
    return {
      id: row.id,
      name: row.display_name,
      email: user?.email ?? "",
      role: row.role,
      hasTwoStep: (user?.factors ?? []).some(
        (factor) =>
          factor.factor_type === "totp" && factor.status === "verified",
      ),
    };
  });
}
