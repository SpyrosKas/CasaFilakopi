"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useAdminI18n } from "@/components/admin/language-provider";
import { LanguageSwitch } from "@/components/admin/language-switch";
import { LinkPending } from "@/components/admin/link-pending";
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

type NavLink = { href: string; key: NavKey; ownerOnly?: boolean };
type GroupKey = keyof AdminStrings["navGroups"];

/**
 * The menu behind "Menu", in groups so Yorgos finds a screen by what it is
 * for. Staff see only the links without ownerOnly, and a group with none left
 * is not shown.
 */
const MENU_GROUPS: { key: GroupKey; links: NavLink[] }[] = [
  {
    key: "guests",
    links: [
      { href: "/admin/guests", key: "guests" },
      { href: "/admin/invoices", key: "invoices", ownerOnly: true },
      { href: "/admin/reports", key: "reports", ownerOnly: true },
    ],
  },
  {
    key: "prices",
    links: [
      { href: "/admin/rates", key: "rates", ownerOnly: true },
      { href: "/admin/rates/restrictions", key: "restrictions" },
      { href: "/admin/booking", key: "booking", ownerOnly: true },
      { href: "/admin/rules", key: "rules", ownerOnly: true },
    ],
  },
  {
    key: "website",
    links: [
      { href: "/admin/content", key: "content", ownerOnly: true },
      { href: "/admin/house", key: "house", ownerOnly: true },
      { href: "/admin/property", key: "property", ownerOnly: true },
    ],
  },
  {
    key: "setup",
    links: [
      { href: "/admin/integrations", key: "integrations", ownerOnly: true },
      { href: "/admin/email", key: "email", ownerOnly: true },
      { href: "/admin/users", key: "users", ownerOnly: true },
      { href: "/admin/account", key: "account" },
    ],
  },
];

// The slash matters: /admin/bookings is not under /admin/booking.
const isHere = (pathname: string, href: string) =>
  pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));

export function AdminNav({ isOwner }: { isOwner: boolean }) {
  const { t } = useAdminI18n();

  const [open, setOpen] = useState(false);
  const isReady = useHydrated();
  const pathname = usePathname();

  const groups = MENU_GROUPS.map((group) => ({
    key: group.key,
    links: group.links.filter((link) => isOwner || !link.ownerOnly),
  })).filter((group) => group.links.length > 0);
  const links = groups.flatMap((group) => group.links);
  // /admin/rates/restrictions sits under /admin/rates, so the longest match wins.
  const here = links
    .filter((link) => isHere(pathname, link.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav className="tabbar" aria-label={t.nav.label} data-pinned>
      <Link href="/admin" className="tabbar-brand" prefetch={false}>
        {t.common.appName}
        <LinkPending />
      </Link>
      <div id="admin-menu" className={open ? "menu menu-open" : "menu"}>
        <ul>
          {groups.map((group) => (
            <li key={group.key} className="menu-group">
              <p className="menu-heading" id={`menu-${group.key}`}>
                {t.navGroups[group.key]}
              </p>
              <ul aria-labelledby={`menu-${group.key}`}>
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      prefetch={false}
                      aria-current={link.href === here ? "page" : undefined}
                      onClick={() => setOpen(false)}
                    >
                      {t.nav[link.key]}
                      <LinkPending />
                    </Link>
                  </li>
                ))}
              </ul>
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
              <LinkPending />
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
