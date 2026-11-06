"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/admin/actions/auth";
import { t } from "@/lib/admin/strings";

const OWNER_LINKS = [
  { href: "/admin/property", label: t.nav.property },
  { href: "/admin/house", label: t.nav.house },
  { href: "/admin/booking", label: t.nav.booking },
  { href: "/admin/rules", label: t.nav.rules },
];

export function AdminNav({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    { href: "/admin", label: t.nav.home },
    ...(isOwner ? OWNER_LINKS : []),
    { href: "/admin/account", label: t.nav.account },
  ];

  return (
    <header className="topbar">
      <div className="topbar-row">
        <Link href="/admin" className="brand" prefetch={false}>
          {t.common.appName}
        </Link>
        <button
          type="button"
          className="menu-button"
          aria-expanded={open}
          aria-controls="admin-menu"
          onClick={() => setOpen(!open)}
        >
          {open ? t.common.closeMenu : t.common.menu}
        </button>
      </div>
      <nav id="admin-menu" className={open ? "menu menu-open" : "menu"}>
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={false}
                aria-current={pathname === link.href ? "page" : undefined}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          ))}
          <li>
            <form action={logout}>
              <button type="submit" className="menu-signout">
                {t.nav.signOut}
              </button>
            </form>
          </li>
        </ul>
      </nav>
    </header>
  );
}
