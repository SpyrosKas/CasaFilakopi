"use server";

import { redirect } from "next/navigation";
import {
  LOCK_WINDOW_MINUTES,
  LOGIN_MIN_MS,
  RESET_MIN_MS,
} from "@/lib/admin/config";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import {
  clientAddress,
  holdUntil,
  claimAttempt,
  isLocked,
  recordAttempt,
  recordSuccess,
} from "@/lib/admin/rate-limit";
import {
  confirmLinkSchema,
  forgotPasswordSchema,
  loginSchema,
  newPasswordSchema,
} from "@/lib/admin/schemas";
import {
  clearActive,
  markActive,
  resolveAdminSession,
} from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { createAdminSessionClient } from "@/lib/admin/supabase";
import { getPublicEnv } from "@/lib/env";

export async function login(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const startedAt = Date.now();
  const parsed = loginSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { email, password } = parsed.data;
  const address = await clientAddress();
  const lockedMessage = errorState(t.login.locked(LOCK_WINDOW_MINUTES));

  try {
    // One try each, so the address is counted even if the email is locked.
    const allowed = await Promise.all([
      claimAttempt("login_email", email),
      claimAttempt("login_ip", address),
    ]);
    if (allowed.includes(false)) {
      await holdUntil(startedAt, LOGIN_MIN_MS);
      return lockedMessage;
    }

    const supabase = await createAdminSessionClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error && error.code !== "invalid_credentials") {
      await holdUntil(startedAt, LOGIN_MIN_MS);
      return errorState(t.login.busy);
    }

    // A real login with no admin profile gets the same answer as a wrong
    // password, so this page never says who has an account.
    let isAdmin = false;
    if (data.session) {
      await markActive(data.session.access_token);
      const { data: profile } = await supabase
        .from("admin_profiles")
        .select("id")
        .eq("id", data.user.id)
        .maybeSingle();
      isAdmin = Boolean(profile);
      if (!isAdmin) {
        await supabase.auth.signOut({ scope: "local" });
        await clearActive();
      }
    }

    if (!isAdmin) {
      const nowLocked = await isLocked("login_email", email);
      await holdUntil(startedAt, LOGIN_MIN_MS);
      return nowLocked ? lockedMessage : errorState(t.login.wrong);
    }

    await Promise.all([
      recordSuccess("login_email", email, data.user!.id),
      recordSuccess("login_ip", address, data.user!.id),
    ]);
  } catch {
    await holdUntil(startedAt, LOGIN_MIN_MS);
    return errorState(t.login.busy);
  }

  await holdUntil(startedAt, LOGIN_MIN_MS);
  redirect("/admin");
}

export async function logout(): Promise<void> {
  const supabase = await createAdminSessionClient();
  await supabase.auth.signOut({ scope: "local" });
  await clearActive();
  redirect("/admin/login?signed_out=1");
}

export async function requestPasswordReset(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const startedAt = Date.now();
  const parsed = forgotPasswordSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { email } = parsed.data;

  // Whatever happens below, the answer and its timing stay the same.
  try {
    if (!(await isLocked("reset_email", email))) {
      await recordAttempt("reset_email", email);
      const supabase = await createAdminSessionClient();
      // Taken from the environment, never the request, so a forged Host
      // header cannot put another site's address in the email.
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${getPublicEnv().NEXT_PUBLIC_SITE_URL}/admin/auth/confirm`,
      });
    }
  } catch {
    // Same answer: the owner can ask again.
  }

  await holdUntil(startedAt, RESET_MIN_MS);
  return okState(t.forgot.sent);
}

/** Runs on a button tap so mail scanners that open links cannot use them up. */
export async function confirmEmailLink(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = confirmLinkSchema.safeParse(formFields(formData));
  if (!parsed.success) return errorState(t.confirm.missing);

  const supabase = await createAdminSessionClient();
  const { data, error } =
    "code" in parsed.data
      ? await supabase.auth.exchangeCodeForSession(parsed.data.code)
      : await supabase.auth.verifyOtp({
          token_hash: parsed.data.tokenHash,
          type: parsed.data.type,
        });
  if (error || !data.session) return errorState(t.confirm.badLink);

  await markActive(data.session.access_token);
  redirect("/admin/new-password");
}

export async function setNewPassword(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await resolveAdminSession();
  const allowed =
    (session.state === "ready" || session.state === "needs_enrolment") &&
    session.fromEmailLink;
  if (!allowed) redirect("/admin/login");

  const parsed = newPasswordSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const { error } = await session.supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return errorState(t.newPassword.failed);

  // Anyone else signed in with the old password is signed out.
  await session.supabase.auth.signOut({ scope: "others" });
  redirect("/admin");
}
