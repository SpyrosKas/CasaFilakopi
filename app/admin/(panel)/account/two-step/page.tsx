import { adminI18n } from "@/lib/admin/i18n-server";
import { redirect } from "next/navigation";
import { EnrolForm } from "@/components/admin/enrol-form";
import { requireAdmin } from "@/lib/admin/session";

/** Optional TOTP for Staff. Owners are sent through /admin/mfa instead. */
export default async function TwoStepPage() {
  const { t } = await adminI18n();

  const admin = await requireAdmin();
  if (admin.hasTotp) redirect("/admin/account");
  return <EnrolForm intro={t.mfa.enrolIntroStaff} />;
}
