"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAdminI18n } from "@/components/admin/language-provider";
import { LanguageSwitch } from "@/components/admin/language-switch";
import { useHydrated } from "@/components/admin/use-hydrated";
import { logout } from "@/lib/admin/actions/auth";
import type { AdminStrings } from "@/lib/admin/strings";

type NavKey = keyof AdminStrings["nav"];

const TAB_LINKS: { href: string; key: NavKey }[] = [
  { href: "/admin", key: "home" },
  { href: "/admin/bookings", key: "bookings" },
  { href: "/admin/calendar", key: "calendar" },
  { href: "/admin/messages", key: "messages" },
];

const STAFF_LINKS: { href: string; key: NavKey }[] = [
  { href: "/admin/guests", key: "guests" },
  { href: "/admin/rates/restrictions", key: "restrictions" },
];

const OWNER_LINKS: { href: string; key: NavKey }[] = [
  { href: "/admin/reports", key: "reports" },
  { href: "/admin/rates", key: "rates" },
  { href: "/admin/content", key: "content" },
  { href: "/admin/property", key: "property" },
  { href: "/admin/house", key: "house" },
  { href: "/admin/booking", key: "booking" },
  { href: "/admin/rules", key: "rules" },
  { href: "/admin/invoices", key: "invoices" },
  { href: "/admin/integrations", key: "integrations" },
  { href: "/admin/email", key: "email" },
  { href: "/admin/users", key: "users" },
];

// The slash matters: /admin/bookings is not under /admin/booking.
const isHere = (pathname: string, href: string) =>
  pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));

export function AdminNav({ isOwner }: { isOwner: boolean }) {
  const { t } = useAdminI18n();

  const [open, setOpen] = useState(false);
  const isReady = useHydrated();
  const pathname = usePathname();

  const links = [
    ...STAFF_LINKS,
    ...(isOwner ? OWNER_LINKS : []),
    { href: "/admin/account", key: "account" as const },
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
                {t.nav[link.key]}
              </Link>
            </li>
          ))}
          <li className="menu-language">
            <form action={logout}>
              <button
                type="submit"
                className="menu-signout"
                disabled={!isReady}
              >
                {t.nav.signOut}
              </button>
            </form>
            <LanguageSwitch />
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
              {t.nav[link.key]}
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
