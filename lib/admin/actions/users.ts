"use server";

import { randomBytes } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertAdminRole, callAdminRpc, writeAudit } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { adminI18n } from "@/lib/admin/i18n-server";
import { later } from "@/lib/admin/later";
import type { AdminStrings } from "@/lib/admin/strings";
import { createAdminSessionClient } from "@/lib/admin/supabase";
import {
  findAuthUser,
  findMember,
  listAuthUsers,
} from "@/lib/admin/users-data";
import { createAdminClient } from "@/lib/db/admin";
import { getPublicEnv } from "@/lib/env";

// T5.11. The first Owner is created by hand (runbook). After that, this is the
// only way in: signups are off. requireOwner runs first in every action, then
// the role is checked in the database before the secret key is used. Anything
// that makes or unmakes an Owner needs that person's email typed in full.

const v = later.admin.validation;

const roleSchema = z.enum(["owner", "staff"], { message: v.pick });

const inviteSchema = z
  .object({
    displayName: z.string().trim().min(1, v.required).max(80, v.tooLong),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email(v.email).max(254, v.email)),
    role: roleSchema,
    confirmEmail: z.string().trim().toLowerCase().optional(),
  })
  .refine((form) => form.role !== "owner" || form.confirmEmail === form.email, {
    path: ["confirmEmail"],
    message: later.admin.ops.users.typeMismatch,
  });

const memberSchema = z.object({
  id: z.uuid(),
  confirmEmail: z.string().optional(),
});
const memberRoleSchema = memberSchema.extend({ role: roleSchema });

const confirmUrl = () =>
  `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/admin/auth/confirm`;

/** About a hundred years: Supabase has no "for ever". */
const BAN_FOR_EVER = "876000h";

const typed = (value: string | undefined, email: string) =>
  value?.trim().toLowerCase() === email.toLowerCase();

const auditUser = (admin: AdminContext, action: string, id: string) =>
  writeAudit(admin, { action, entity: "admin_user", entityId: id });

/**
 * Someone removed earlier keeps their auth account, and with it an old password
 * and any authenticator. They are let back in with the password replaced by a
 * random one and every old session ended, so they must choose a new password
 * from the email. Anyone who never answered their first invitation gets it
 * again. An authenticator they had stays until an Owner resets it.
 */
async function readmit(
  admin: AdminContext,
  user: User,
  input: z.output<typeof inviteSchema>,
  u: AdminStrings["ops"]["users"],
): Promise<ActionState> {
  const db = createAdminClient();
  const { data: profile, error } = await db
    .from("admin_profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();
  if (error) throw error;
  if (profile) return errorState(u.alreadyAdmin);

  await auditUser(admin, "admin_unbanned", user.id);
  const { error: unban } = await db.auth.admin.updateUserById(user.id, {
    ban_duration: "none",
    password: randomBytes(32).toString("base64url"),
  });
  if (unban) return errorState(u.inviteFailed);

  await callAdminRpc(admin, "delete_auth_sessions", { p_user_id: user.id });
  await callAdminRpc(admin, "add_admin", {
    p_user_id: user.id,
    p_role: input.role,
    p_display_name: input.displayName,
  });

  const { error: mail } = user.email_confirmed_at
    ? await (
        await createAdminSessionClient()
      ).auth.resetPasswordForEmail(input.email, { redirectTo: confirmUrl() })
    : await db.auth.admin.inviteUserByEmail(input.email, {
        redirectTo: confirmUrl(),
      });
  return mail ? errorState(u.inviteFailed) : okState(u.invited(input.email));
}

export async function inviteAdmin(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t, say } = await adminI18n();
  const u = t.ops.users;
  const admin = await requireOwner();
  const parsed = inviteSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const input = parsed.data;

  await assertAdminRole(admin);
  const db = createAdminClient();
  const known = findAuthUser(await listAuthUsers(db), input.email);
  if (known) {
    const result = await readmit(admin, known, input, u);
    revalidatePath("/admin/users");
    return result;
  }

  const { data, error } = await db.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: confirmUrl(),
  });
  if (error) return errorState(u.inviteFailed);

  try {
    await callAdminRpc(admin, "add_admin", {
      p_user_id: data.user.id,
      p_role: input.role,
      p_display_name: input.displayName,
    });
  } catch (failure) {
    // An account with no role cannot do anything, but it should not linger.
    await db.auth.admin.deleteUser(data.user.id);
    throw failure;
  }

  revalidatePath("/admin/users");
  return okState(u.invited(input.email));
}

function refusal(error: unknown, u: AdminStrings["ops"]["users"]): ActionState {
  const message = (error as { message?: string }).message;
  if (message === "cannot_change_self") return errorState(u.notYourself);
  if (message === "admin_not_found") return errorState(u.notFound);
  if (message === "last_owner") return errorState(u.lastOwner);
  throw error;
}

export async function changeAdminRole(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t } = await adminI18n();
  const u = t.ops.users;
  const admin = await requireOwner();
  const parsed = memberRoleSchema.safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.common.somethingWrong);
  const { id, role, confirmEmail } = parsed.data;

  await assertAdminRole(admin);
  const member = await findMember(createAdminClient(), id);
  if (!member) return errorState(u.notFound);
  if (!typed(confirmEmail, member.email)) return errorState(u.typeMismatch);

  try {
    await callAdminRpc(admin, "change_admin_role", {
      p_user_id: id,
      p_role: role,
    });
  } catch (error) {
    return refusal(error, u);
  }
  revalidatePath("/admin/users");
  return okState(u.done);
}

export async function removeAdmin(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t } = await adminI18n();
  const u = t.ops.users;
  const admin = await requireOwner();
  const parsed = memberSchema.safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.common.somethingWrong);
  const { id, confirmEmail } = parsed.data;
  if (id === admin.userId) return errorState(u.notYourself);

  await assertAdminRole(admin);
  const db = createAdminClient();
  const member = await findMember(db, id);
  if (!member) return errorState(u.notFound);
  if (member.role === "owner" && !typed(confirmEmail, member.email)) {
    return errorState(u.typeMismatch);
  }

  // Ban first, so no new session can start while the old ones are ended.
  // Deleting the account would rewrite issued_by on immutable invoices.
  await auditUser(admin, "admin_banned", id);
  const { error } = await db.auth.admin.updateUserById(id, {
    ban_duration: BAN_FOR_EVER,
  });
  if (error) throw error;

  try {
    await callAdminRpc(admin, "delete_auth_sessions", { p_user_id: id });
    await callAdminRpc(admin, "remove_admin", { p_user_id: id });
  } catch (failure) {
    await auditUser(admin, "admin_unbanned", id);
    await db.auth.admin.updateUserById(id, { ban_duration: "none" });
    return refusal(failure, u);
  }

  revalidatePath("/admin/users");
  return okState(u.done);
}

/** For a lost phone: one Owner clears another's authenticator (runbook). */
export async function resetTwoStep(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t } = await adminI18n();
  const u = t.ops.users;
  const admin = await requireOwner();
  const parsed = memberSchema.safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.common.somethingWrong);
  const { id } = parsed.data;
  if (id === admin.userId) return errorState(u.notYourself);

  await assertAdminRole(admin);
  await auditUser(admin, "two_step_reset", id);

  const mfa = createAdminClient().auth.admin.mfa;
  const { data, error } = await mfa.listFactors({ userId: id });
  if (error) throw error;
  for (const factor of data.factors) {
    const { error: removed } = await mfa.deleteFactor({
      userId: id,
      id: factor.id,
    });
    if (removed) throw removed;
  }
  await callAdminRpc(admin, "delete_auth_sessions", { p_user_id: id });

  revalidatePath("/admin/users");
  return okState(u.done);
}
