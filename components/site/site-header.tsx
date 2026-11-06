"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { contact } from "@/content/contact";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { MapEmbed } from "./map-embed";

const menuLinks = [
  { href: "/", key: "home" },
  { href: "/book", key: "reservations" },
  { href: "/host", key: "host" },
  { href: "/directions", key: "directions" },
  { href: "/gallery", key: "gallery" },
  { href: "/contact", key: "contact" },
] as const;

/** Tab cycles through the close button and the menu, never the page behind. */
function keepFocusInMenu(event: KeyboardEvent, toggle: HTMLElement | null) {
  if (!toggle) return;
  const items = [
    toggle,
    ...document.querySelectorAll<HTMLElement>(
      "#site-navbar a, #site-navbar button, #site-navbar iframe",
    ),
  ];
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const outside = !active || !items.includes(active);

  if (outside || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey && !outside ? last : first).focus();
  }
}

export function SiteHeader() {
  const t = useTranslations("Nav");
  const tCommon = useTranslations("Common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The map stays loaded after the menu's first opening, so closing is cheap.
  const [menuUsed, setMenuUsed] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

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
        keepFocusInMenu(event, toggleRef.current);
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.classList.remove("menu-open");
      root.style.overflow = "";
      behind.forEach((element) => element.removeAttribute("inert"));
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="site-header">
      <div className="container-fluid">
        <div className="row">
          <div className="col-4 site-logo" data-reveal-load="fade">
            {pathname !== "/" && <Link href="/">{tCommon("siteName")}</Link>}
          </div>
          <div className="col-8">
            <button
              ref={toggleRef}
              type="button"
              className={`site-menu-toggle${open ? " open" : ""}`}
              data-reveal-load="fade"
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
              <span />
            </button>

            <div id="site-navbar" className="site-navbar bg-pattern">
              <nav aria-label={t("mainNavigation")}>
                <div className="container">
                  <div className="row full-height align-items-center">
                    <div className="col-md-3">
                      <ul className="list-unstyled menu">
                        {menuLinks.map(({ href, key }) => (
                          <li key={key}>
                            <Link
                              href={href}
                              aria-current={
                                pathname === href ? "page" : undefined
                              }
                              onClick={close}
                            >
                              {t(key)}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="col-md-9 extra-info">
                      <div className="row">
                        <div className="col-md-9 mb-5">
                          <MapEmbed load={menuUsed} />
                        </div>
                        <div className="col-md-3">
                          <h3>{t("contactInfo")}</h3>
                          <p>
                            {t("addressLine1")} <br /> {t("addressLine2")}
                          </p>
                          <p>
                            <a href={`mailto:${contact.email}`}>
                              {contact.email}
                            </a>
                          </p>
                          <p>
                            <a href={contact.phoneHref}>
                              {contact.phoneDisplay}
                            </a>
                          </p>
                          <p>
                            <a href={contact.whatsappHref}>
                              {t("whatsappLabel", {
                                number: contact.whatsappDisplay,
                              })}
                            </a>
                          </p>
                          <p>
                            <LanguageSwitcher onSwitch={close} />
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </nav>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
