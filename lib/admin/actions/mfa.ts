"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { redirect } from "next/navigation";
import { isFreshSignIn } from "@/lib/admin/activity";
import { writeAudit } from "@/lib/admin/audit";
import { LOCK_WINDOW_MINUTES } from "@/lib/admin/config";
import {
  errorState,
  formFields,
  fromZodError,
  type ActionState,
} from "@/lib/admin/form-state";
import { claimAttempt, clearAttempts, isLocked } from "@/lib/admin/rate-limit";
import { enrolConfirmSchema, mfaVerifySchema } from "@/lib/admin/schemas";
import {
  clearActive,
  markActive,
  resolveAdminSession,
} from "@/lib/admin/session";

export interface EnrolState extends ActionState {
  enrolment?: {
    factorId: string;
    qrCode: string;
    secret: string;
    uri: string;
  };
}

/** Who may add a new factor: an Owner who must, or staff who choose to. */
async function enrollingSession() {
  const session = await resolveAdminSession();
  if (session.state === "anonymous" || session.state === "not_admin") {
    redirect("/admin/login");
  }
  if (session.state === "needs_verify" || session.hasTotp) redirect("/admin");

  // Adding a factor is the one step a session can take that outlives it, so a
  // session left open must prove the password again.
  if (!isFreshSignIn(session.signedInAt, Math.floor(Date.now() / 1000))) {
    await session.supabase.auth.signOut({ scope: "local" });
    await clearActive();
    redirect("/admin/login?expired=1");
  }
  return session;
}

export async function startEnrolment(): Promise<EnrolState> {
  const { t } = await adminI18n();

  const { supabase } = await enrollingSession();

  // A setup left half done blocks a new one, so it is cleared first.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  for (const factor of user?.factors ?? []) {
    if (factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Casa Filakopi",
    issuer: t.common.appName,
  });
  if (error || !data) return errorState(t.mfa.startFailed);

  return {
    status: "idle",
    enrolment: {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
      uri: data.totp.uri,
    },
  };
}

export async function finishEnrolment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const session = await enrollingSession();
  const parsed = enrolConfirmSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const { data, error } = await session.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error || !data) return errorState(t.mfa.enrolFailed);

  await writeAudit(session, {
    action: "mfa_enrolled",
    entity: "admin_user",
    entityId: session.userId,
    after: { factorId: parsed.data.factorId },
  });
  await markActive(data.access_token);
  redirect("/admin");
}

export async function verifyCode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const session = await resolveAdminSession();
  if (session.state !== "needs_verify") redirect("/admin");

  const parsed = mfaVerifySchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  // The password alone must not allow unlimited guesses at a 6-digit code.
  if (!(await claimAttempt("mfa_user", session.userId))) {
    return errorState(t.mfa.locked(LOCK_WINDOW_MINUTES));
  }

  const { data, error } = await session.supabase.auth.mfa.challengeAndVerify({
    factorId: session.factorId,
    code: parsed.data.code,
  });
  if (error || !data) {
    const locked = await isLocked("mfa_user", session.userId);
    return errorState(
      locked ? t.mfa.locked(LOCK_WINDOW_MINUTES) : t.mfa.wrongCode,
    );
  }

  await clearAttempts("mfa_user", session.userId);
  await markActive(data.access_token);
  redirect(parsed.data.next === "password" ? "/admin/new-password" : "/admin");
}
