import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { ActionForm, Field } from "@/components/admin/form";
import { requestPasswordReset } from "@/lib/admin/actions/auth";

export default async function ForgotPasswordPage() {
  const { t } = await adminI18n();

  return (
    <div className="stack">
      <h1>{t.forgot.title}</h1>
      <p>{t.forgot.intro}</p>
      <ActionForm
        action={requestPasswordReset}
        submitLabel={t.forgot.submit}
        pendingLabel={t.forgot.submitting}
      >
        <Field
          label={t.login.email}
          name="email"
          type="email"
          autoComplete="username"
        />
      </ActionForm>
      <p>
        <Link href="/admin/login" className="text-link" prefetch={false}>
          {t.forgot.back}
        </Link>
      </p>
    </div>
  );
}
