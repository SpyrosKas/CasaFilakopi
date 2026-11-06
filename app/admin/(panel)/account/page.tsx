import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

export default async function AccountPage() {
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
    </div>
  );
}
