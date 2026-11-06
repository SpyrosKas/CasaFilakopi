import type { ReactNode } from "react";
import { t } from "@/lib/admin/strings";

export default function PublicAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <main className="card">
      <p className="brand-line">{t.common.panelName}</p>
      {children}
    </main>
  );
}
