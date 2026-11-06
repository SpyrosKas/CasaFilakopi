import type { ReactNode } from "react";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireAdmin } from "@/lib/admin/session";

/**
 * Hides the menu from anyone not signed in. It does not protect the pages:
 * each page and server action makes its own check, because a layout does not
 * re-run on every navigation.
 */
export default async function PanelLayout({
  children,
}: {
  children: ReactNode;
}) {
  const admin = await requireAdmin();
  return (
    <>
      <AdminNav isOwner={admin.role === "owner"} />
      <main className="page">{children}</main>
    </>
  );
}
