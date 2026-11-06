"use server";

import { redirect } from "next/navigation";
import { LOCK_WINDOW_MINUTES } from "@/lib/admin/config";
import {
  errorState,
  formFields,
  fromZodError,
  type ActionState,
} from "@/lib/admin/form-state";
import { claimAttempt, isLocked, recordSuccess } from "@/lib/admin/rate-limit";
import { enrolConfirmSchema, mfaVerifySchema } from "@/lib/admin/schemas";
import { markActive, resolveAdminSession } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

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
  return session;
}

export async function startEnrolment(): Promise<EnrolState> {
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
  const session = await enrollingSession();
  const parsed = enrolConfirmSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const { data, error } = await session.supabase.auth.mfa.challengeAndVerify({
    factorId: parsed.data.factorId,
    code: parsed.data.code,
  });
  if (error || !data) return errorState(t.mfa.enrolFailed);

  await markActive(data.access_token);
  redirect("/admin");
}

export async function verifyCode(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const session = await resolveAdminSession();
  if (session.state !== "needs_verify") redirect("/admin");

  const parsed = mfaVerifySchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

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

  await recordSuccess("mfa_user", session.userId, session.userId);
  await markActive(data.access_token);
  redirect(parsed.data.next === "password" ? "/admin/new-password" : "/admin");
}
