import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, Field } from "@/components/admin/form";
import { login } from "@/lib/admin/actions/auth";
import { resolveAdminSession } from "@/lib/admin/session";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expired?: string; signed_out?: string }>;
}) {
  const { t } = await adminI18n();

  const session = await resolveAdminSession();
  if (session.state !== "anonymous" && session.state !== "not_admin") {
    redirect("/admin");
  }
  const { expired, signed_out: signedOut } = await searchParams;

  return (
    <div className="stack">
      <h1>{t.login.title}</h1>
      {expired && <p className="notice notice-info">{t.login.expired}</p>}
      {signedOut && <p className="notice notice-info">{t.login.signedOut}</p>}
      <ActionForm
        action={login}
        submitLabel={t.login.submit}
        pendingLabel={t.login.submitting}
      >
        <Field
          label={t.login.email}
          name="email"
          type="email"
          autoComplete="username"
        />
        <Field
          label={t.login.password}
          name="password"
          type="password"
          autoComplete="current-password"
        />
      </ActionForm>
      <p>
        <Link
          href="/admin/forgot-password"
          className="text-link"
          prefetch={false}
        >
          {t.login.forgot}
        </Link>
      </p>
      <p className="hint">{t.login.noPublicSignup}</p>
    </div>
  );
}
