import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/admin/form";
import { setNewPassword } from "@/lib/admin/actions/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/admin/config";
import { resolveAdminSession } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

/** Only reachable from a reset or invite link, never by a signed-in admin. */
export default async function NewPasswordPage() {
  const session = await resolveAdminSession();
  if (session.state === "anonymous" || session.state === "not_admin") {
    redirect("/admin/login");
  }
  if (!session.fromEmailLink) redirect("/admin");
  // An account with TOTP proves it first, so a stolen mailbox is not enough.
  if (session.state === "needs_verify") redirect("/admin/mfa?next=password");

  return (
    <div className="stack">
      <h1>{t.newPassword.title}</h1>
      <p>{t.newPassword.intro(MIN_PASSWORD_LENGTH)}</p>
      <ActionForm
        action={setNewPassword}
        submitLabel={t.newPassword.submit}
        pendingLabel={t.newPassword.submitting}
      >
        <Field
          label={t.newPassword.password}
          name="password"
          type="password"
          autoComplete="new-password"
        />
        <Field
          label={t.newPassword.confirm}
          name="confirm"
          type="password"
          autoComplete="new-password"
        />
      </ActionForm>
    </div>
  );
}
