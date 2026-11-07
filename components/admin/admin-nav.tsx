"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { logout } from "@/lib/admin/actions/auth";
import { t } from "@/lib/admin/strings";

const TAB_LINKS = [
  { href: "/admin", label: t.nav.home },
  { href: "/admin/bookings", label: t.nav.bookings },
  { href: "/admin/calendar", label: t.nav.calendar },
  { href: "/admin/messages", label: t.nav.messages },
];

const STAFF_LINKS = [
  { href: "/admin/guests", label: t.nav.guests },
  { href: "/admin/rates/restrictions", label: t.nav.restrictions },
];

const OWNER_LINKS = [
  { href: "/admin/reports", label: t.nav.reports },
  { href: "/admin/rates", label: t.nav.rates },
  { href: "/admin/property", label: t.nav.property },
  { href: "/admin/house", label: t.nav.house },
  { href: "/admin/booking", label: t.nav.booking },
  { href: "/admin/rules", label: t.nav.rules },
  { href: "/admin/invoices", label: t.nav.invoices },
  { href: "/admin/integrations", label: t.nav.integrations },
  { href: "/admin/email", label: t.nav.email },
];

// The slash matters: /admin/bookings is not under /admin/booking.
const isHere = (pathname: string, href: string) =>
  pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));

export function AdminNav({ isOwner }: { isOwner: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const links = [
    ...STAFF_LINKS,
    ...(isOwner ? OWNER_LINKS : []),
    { href: "/admin/account", label: t.nav.account },
  ];
  // /admin/rates/restrictions sits under /admin/rates, so the longest match wins.
  const here = links
    .filter((link) => isHere(pathname, link.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="tabbar" aria-label={t.nav.label} data-pinned>
      <Link href="/admin" className="tabbar-brand" prefetch={false}>
        {t.common.appName}
      </Link>
      <div id="admin-menu" className={open ? "menu menu-open" : "menu"}>
        <ul>
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                prefetch={false}
                aria-current={link.href === here ? "page" : undefined}
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
      </div>
      <ul className="tabbar-row">
        {TAB_LINKS.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              prefetch={false}
              className="tab"
              aria-current={isHere(pathname, link.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          </li>
        ))}
        <li className="tabbar-more">
          <button
            type="button"
            className="menu-button"
            aria-expanded={open}
            aria-controls="admin-menu"
            onClick={() => setOpen(!open)}
          >
            {open ? t.common.closeMenu : t.common.menu}
          </button>
        </li>
      </ul>
    </nav>
  );
}
