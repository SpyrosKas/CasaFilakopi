import { LanguageSwitch } from "@/components/admin/language-switch";
import { adminI18n } from "@/lib/admin/i18n-server";
import type { ReactNode } from "react";

export default async function PublicAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { t } = await adminI18n();

  return (
    <main className="card">
      <div className="brand-row">
        <p className="brand-line">{t.common.panelName}</p>
        <LanguageSwitch />
      </div>
      {children}
    </main>
  );
}
