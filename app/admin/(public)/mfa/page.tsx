import { redirect } from "next/navigation";
import { EnrolForm } from "@/components/admin/enrol-form";
import { ActionForm, Field } from "@/components/admin/form";
import { logout } from "@/lib/admin/actions/auth";
import { verifyCode } from "@/lib/admin/actions/mfa";
import { resolveAdminSession } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

export default async function MfaPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const session = await resolveAdminSession();
  if (session.state === "anonymous" || session.state === "not_admin") {
    redirect("/admin/login");
  }
  if (session.state === "ready") redirect("/admin");
  const { next } = await searchParams;

  const signOut = (
    <form action={logout}>
      <button type="submit" className="button button-quiet">
        {t.mfa.signOutInstead}
      </button>
    </form>
  );

  if (session.state === "needs_enrolment") {
    return (
      <div className="stack">
        <EnrolForm intro={t.mfa.enrolIntroOwner} />
        {signOut}
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{t.mfa.verifyTitle}</h1>
      <p>{t.mfa.verifyIntro}</p>
      <ActionForm
        action={verifyCode}
        submitLabel={t.mfa.verifySubmit}
        pendingLabel={t.mfa.verifying}
      >
        {next === "password" && (
          <input type="hidden" name="next" value="password" />
        )}
        <Field
          label={t.mfa.code}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </ActionForm>
      {signOut}
    </div>
  );
}
