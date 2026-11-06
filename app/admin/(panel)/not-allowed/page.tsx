import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

export default async function NotAllowedPage() {
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
