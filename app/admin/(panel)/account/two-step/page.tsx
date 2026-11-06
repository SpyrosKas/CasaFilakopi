import { redirect } from "next/navigation";
import { EnrolForm } from "@/components/admin/enrol-form";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

/** Optional TOTP for Staff. Owners are sent through /admin/mfa instead. */
export default async function TwoStepPage() {
  const admin = await requireAdmin();
  if (admin.hasTotp) redirect("/admin/account");
  return <EnrolForm intro={t.mfa.enrolIntroStaff} />;
}
