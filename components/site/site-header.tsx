"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import type { SiteContact } from "@/lib/cms/public";
import { LanguageSwitcher } from "./language-switcher";
import { MapEmbed } from "./map-embed";

const pageLinks = [
  { href: "/", key: "home" },
  { href: "/host", key: "host" },
  { href: "/directions", key: "directions" },
  { href: "/gallery", key: "gallery" },
  { href: "/contact", key: "contact" },
] as const;

const menuLinks = [
  pageLinks[0],
  { href: "/book", key: "reservations" },
  ...pageLinks.slice(1),
] as const;

// The width where styles/site.css swaps the menu button for the full menu.
const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

function subscribeToScroll(onChange: () => void) {
  window.addEventListener("scroll", onChange, { passive: true });
  return () => window.removeEventListener("scroll", onChange);
}

const nothingToWatch = () => () => {};

/** Tab cycles through the header and the menu, never the page behind. */
function keepFocusInMenu(event: KeyboardEvent) {
  const items = [
    ...document.querySelectorAll<HTMLElement>(
      ".site-header a, .site-header button, #site-navbar iframe",
    ),
  ].filter((element) => element.checkVisibility());
  const first = items[0];
  const last = items[items.length - 1];
  if (!first) return;
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !items.includes(active);

  if (outside || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey && !outside ? last : first).focus();
  }
}

export function SiteHeader({ contact }: { contact: SiteContact }) {
  const t = useTranslations("Nav");
  const tCommon = useTranslations("Common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The map stays loaded after the menu's first opening, so closing is cheap.
  const [menuUsed, setMenuUsed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const scrolled = useSyncExternalStore(
    subscribeToScroll,
    () => window.scrollY > 24,
    () => false,
  );
  // Without scripts the header cannot tell where the hero ends, so CSS turns it
  // solid after a moment. data-live cancels that, like the reveal failsafe.
  const live = useSyncExternalStore(
    nothingToWatch,
    () => true,
    () => false,
  );

  useEffect(() => {
    if (!open) return;
    const behind = document.querySelectorAll("#main, #site-footer");
    const root = document.documentElement;
    document.body.classList.add("menu-open");
    root.style.overflow = "hidden";
    behind.forEach((element) => element.setAttribute("inert", ""));
    document.querySelector<HTMLElement>("#site-navbar a")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      } else if (event.key === "Tab") {
        keepFocusInMenu(event);
      }
    };
    document.addEventListener("keydown", onKeyDown);

    // Turning a tablet sideways can bring the desktop menu, with no toggle left.
    const desktop = window.matchMedia(DESKTOP_NAV_QUERY);
    const onWidthChange = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", onWidthChange);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      desktop.removeEventListener("change", onWidthChange);
      document.body.classList.remove("menu-open");
      root.style.overflow = "";
      behind.forEach((element) => element.removeAttribute("inert"));
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header
      className={`site-header${scrolled ? " is-solid" : ""}`}
      data-live={live ? "" : undefined}
    >
      <div className="site-header__bar">
        <Link href="/" className="site-logo" onClick={close}>
          {tCommon("siteName")}
        </Link>

        <nav className="site-nav" aria-label={t("mainNavigation")}>
          <ul>
            {pageLinks.map(({ href, key }) => (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                >
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <LanguageSwitcher onSwitch={close} />

        <Link
          href="/book"
          className="btn btn-primary site-header__book"
          onClick={close}
        >
          {t("book")}
        </Link>

        <button
          ref={toggleRef}
          type="button"
          className={`site-menu-toggle${open ? " open" : ""}`}
          aria-expanded={open}
          aria-controls="site-navbar"
          aria-label={open ? t("closeMenu") : t("openMenu")}
          onClick={() => {
            setMenuUsed(true);
            setOpen(!open);
          }}
        >
          <span />
          <span />
        </button>
      </div>

      <div id="site-navbar" className="site-navbar">
        <nav aria-label={t("mainNavigation")}>
          <ul className="menu">
            {menuLinks.map(({ href, key }) => (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={pathname === href ? "page" : undefined}
                  onClick={close}
                >
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
          <div className="extra-info">
            <h2>{t("contactInfo")}</h2>
            <p>
              {contact.addressLine1} <br /> {contact.addressLine2}
            </p>
            <p>
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </p>
            <p>
              <a href={contact.phoneHref}>{contact.phoneDisplay}</a>
            </p>
            <p>
              <a href={contact.whatsappHref}>
                {t("whatsappLabel", { number: contact.whatsappDisplay })}
              </a>
            </p>
            <MapEmbed load={menuUsed} />
          </div>
        </nav>
      </div>
    </header>
  );
}
