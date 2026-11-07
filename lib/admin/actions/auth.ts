"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createDeviceValue, isKnownDevice } from "@/lib/admin/activity";
import { writeAudit } from "@/lib/admin/audit";
import { emailAtAddress } from "@/lib/admin/client-address";
import {
  ADMIN_COOKIE_OPTIONS,
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_SECONDS,
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
  claimAttempt,
  clearAttempts,
  clientAddress,
  holdUntil,
  isLocked,
  releaseAttempt,
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
import { createAdminSessionClient } from "@/lib/admin/supabase";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

async function isKnownDeviceFor(email: string): Promise<boolean> {
  const value = (await cookies()).get(DEVICE_COOKIE)?.value;
  return isKnownDevice(value, email, getServerEnv().SUPABASE_SECRET_KEY);
}

async function rememberDevice(email: string): Promise<void> {
  (await cookies()).set(
    DEVICE_COOKIE,
    createDeviceValue(email, getServerEnv().SUPABASE_SECRET_KEY),
    { ...ADMIN_COOKIE_OPTIONS, maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS },
  );
}

export async function login(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const startedAt = Date.now();
  const parsed = loginSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { email, password } = parsed.data;
  const address = await clientAddress();
  const pair = emailAtAddress(email, address);
  const refuse = async () => {
    await holdUntil(startedAt, LOGIN_MIN_MS);
    return errorState(t.login.locked(LOCK_WINDOW_MINUTES));
  };

  try {
    // In this order, so a locked address stops here and adds nothing else.
    const addressClaim = await claimAttempt("login_ip", address);
    if (addressClaim === null) return await refuse();
    if ((await claimAttempt("login_pair", pair)) === null) {
      return await refuse();
    }
    const emailClaim = await claimAttempt("login_email", email);
    if (emailClaim === null && !(await isKnownDeviceFor(email))) {
      return await refuse();
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
      if (await isLocked("login_pair", pair)) return await refuse();
      await holdUntil(startedAt, LOGIN_MIN_MS);
      return errorState(t.login.wrong);
    }

    // Only this email and address start again. The other counts lose this
    // one try, so a real login cannot wipe a stranger's failures.
    await Promise.all([
      clearAttempts("login_pair", pair),
      releaseAttempt(addressClaim),
      releaseAttempt(emailClaim),
    ]);
    await rememberDevice(email);
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
  const { say, t } = await adminI18n();

  const startedAt = Date.now();
  const parsed = forgotPasswordSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { email } = parsed.data;

  // Whatever happens below, the answer and its timing stay the same.
  try {
    // In this order, so a locked address stops here. The email's own limit
    // sits higher than the address's, so one stranger cannot use it up and
    // stop the real owner asking for a link.
    const address = await clientAddress();
    const allowed =
      (await claimAttempt("reset_ip", address)) !== null &&
      (await claimAttempt("reset_pair", emailAtAddress(email, address))) !==
        null &&
      (await claimAttempt("reset_email", email)) !== null;

    if (allowed) {
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
  const { t } = await adminI18n();

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
  const { say, t } = await adminI18n();

  const session = await resolveAdminSession();
  const allowed =
    (session.state === "ready" || session.state === "needs_enrolment") &&
    session.fromEmailLink;
  if (!allowed) redirect("/admin/login");

  const parsed = newPasswordSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const { error } = await session.supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) return errorState(t.newPassword.failed);

  await writeAudit(session, {
    action: "password_changed",
    entity: "admin_user",
    entityId: session.userId,
  });

  // Anyone else signed in with the old password is signed out.
  await session.supabase.auth.signOut({ scope: "others" });
  redirect("/admin");
}
