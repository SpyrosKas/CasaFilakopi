import { LanguageSwitch } from "@/components/admin/language-switch";
import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";

export default async function AccountPage() {
  const { t } = await adminI18n();

  const admin = await requireAdmin();
  const a = t.account;

  return (
    <div className="stack">
      <h1>{a.title}</h1>
      <dl className="facts">
        <dt>{a.name}</dt>
        <dd>{admin.displayName}</dd>
        <dt>{a.email}</dt>
        <dd>{admin.email}</dd>
        <dt>{a.role}</dt>
        <dd>{admin.role === "owner" ? a.roleOwner : a.roleStaff}</dd>
        <dt>{a.twoStep}</dt>
        <dd>{admin.hasTotp ? a.twoStepOn : a.twoStepOff}</dd>
      </dl>
      {!admin.hasTotp && (
        <Link
          href="/admin/account/two-step"
          className="button"
          prefetch={false}
        >
          {a.twoStepSetup}
        </Link>
      )}
      <p className="hint">{a.password}</p>
      <div className="language-row">
        <span>{t.common.language}</span>
        <LanguageSwitch />
      </div>
    </div>
  );
}
