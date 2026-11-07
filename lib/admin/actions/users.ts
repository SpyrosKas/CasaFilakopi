"use server";

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
import { findAuthUser, listAuthUsers } from "@/lib/admin/users-data";
import { createAdminClient } from "@/lib/db/admin";
import { getPublicEnv } from "@/lib/env";

// T5.11. The first Owner is created by hand (runbook). After that, this is the
// only way in: signups are off. requireOwner runs first in every action, then
// callAdminRpc checks the role in the database before the secret key is used.

const v = later.admin.validation;

const roleSchema = z.enum(["owner", "staff"], { message: v.pick });

const inviteSchema = z.object({
  displayName: z.string().trim().min(1, v.required).max(80, v.tooLong),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email(v.email).max(254, v.email)),
  role: roleSchema,
});

const memberSchema = z.object({ id: z.uuid() });
const memberRoleSchema = z.object({ id: z.uuid(), role: roleSchema });

const confirmUrl = () =>
  `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/admin/auth/confirm`;

/** About a hundred years: Supabase has no "for ever". */
const BAN_FOR_EVER = "876000h";

/**
 * Someone removed earlier keeps their auth account, so they are let back in.
 * Anyone who already set a password chooses a new one; anyone who never
 * answered their first invitation gets it again.
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

  const { error: unban } = await db.auth.admin.updateUserById(user.id, {
    ban_duration: "none",
  });
  if (unban) return errorState(u.inviteFailed);

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

function refusal(
  error: unknown,
  u: AdminStrings["ops"]["users"],
  t: AdminStrings,
): ActionState {
  const message = (error as { message?: string }).message;
  if (message === "cannot_change_self") return errorState(u.notYourself);
  if (message === "admin_not_found") return errorState(u.notFound);
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

  try {
    await callAdminRpc(admin, "change_admin_role", {
      p_user_id: parsed.data.id,
      p_role: parsed.data.role,
    });
  } catch (error) {
    return refusal(error, u, t);
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

  try {
    await callAdminRpc(admin, "remove_admin", { p_user_id: parsed.data.id });
  } catch (error) {
    return refusal(error, u, t);
  }

  // The role row is gone, which already ends all access. Deleting the account
  // would rewrite issued_by on immutable invoices, so it is switched off.
  const { error } = await createAdminClient().auth.admin.updateUserById(
    parsed.data.id,
    { ban_duration: BAN_FOR_EVER },
  );
  if (error) throw error;

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

  await writeAudit(admin, {
    action: "two_step_reset",
    entity: "admin_user",
    entityId: id,
  });
  revalidatePath("/admin/users");
  return okState(u.done);
}
