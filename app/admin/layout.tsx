import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AdminLanguageProvider } from "@/components/admin/language-provider";
import { adminI18n, adminLanguage } from "@/lib/admin/i18n-server";
import "./admin.css";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await adminI18n();
  return {
    title: t.common.panelName,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  const lang = await adminLanguage();
  return (
    <html lang={lang}>
      <body className="admin">
        <AdminLanguageProvider lang={lang}>{children}</AdminLanguageProvider>
      </body>
    </html>
  );
}
