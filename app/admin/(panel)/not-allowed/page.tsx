import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";

export default async function NotAllowedPage() {
  const { t } = await adminI18n();

  await requireAdmin();
  return (
    <div className="stack">
      <h1>{t.notAllowed.title}</h1>
      <p>{t.notAllowed.intro}</p>
      <Link href="/admin" className="button" prefetch={false}>
        {t.notAllowed.back}
      </Link>
    </div>
  );
}
