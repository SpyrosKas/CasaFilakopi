import Link from "next/link";
import { requireAdmin } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";

export default async function AdminHomePage() {
  const admin = await requireAdmin();
  const isOwner = admin.role === "owner";

  const links = isOwner
    ? [
        { href: "/admin/property", label: t.nav.property },
        { href: "/admin/house", label: t.nav.house },
        { href: "/admin/booking", label: t.nav.booking },
        { href: "/admin/rules", label: t.nav.rules },
        { href: "/admin/account", label: t.nav.account },
      ]
    : [{ href: "/admin/account", label: t.nav.account }];

  return (
    <div className="stack">
      <h1>{t.home.title(admin.displayName)}</h1>
      <p>{isOwner ? t.home.intro : t.home.staffIntro}</p>
      <ul className="link-list">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
