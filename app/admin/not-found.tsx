import Link from "next/link";
import { adminI18n } from "@/lib/admin/i18n-server";

export default async function AdminNotFound() {
  const { t } = await adminI18n();
  return (
    <main className="card">
      <p className="brand-line">{t.common.panelName}</p>
      <h1>{t.notFound.title}</h1>
      <p>{t.notFound.intro}</p>
      <Link href="/admin" prefetch={false} className="button">
        {t.notAllowed.back}
      </Link>
    </main>
  );
}
