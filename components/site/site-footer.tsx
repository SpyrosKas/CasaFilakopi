import { useTranslations } from "next-intl";
import { contact } from "@/content/contact";
import { Link } from "@/i18n/navigation";
import { CookieSettingsButton } from "./cookie-banner";
import { Icon } from "./icon";

const mainLinks = [
  { href: "/", key: "home" },
  { href: "/book", key: "reservations" },
  { href: "/host", key: "host" },
  { href: "/directions", key: "directions" },
  { href: "/gallery", key: "gallery" },
  { href: "/contact", key: "contact" },
] as const;

const extraLinks = [
  { href: "/faq", key: "faq" },
  { href: "/house-rules", key: "houseRules" },
  { href: "/privacy", key: "privacy" },
  { href: "/terms", key: "terms" },
  { href: "/cancellation", key: "cancellation" },
  { href: "/cookies", key: "cookies" },
] as const;

export function SiteFooter() {
  const t = useTranslations("Footer");
  const tNav = useTranslations("Nav");
  const tCommon = useTranslations("Common");

  return (
    <footer id="site-footer" className="footer-section">
      <div className="wrap footer-grid">
        <div className="footer-brand">
          <p className="footer-name">{tCommon("siteName")}</p>
          <address>
            {tNav("addressLine1")} <br /> {tNav("addressLine2")}
          </address>
          <p className="social">
            <a
              href={contact.facebook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("facebook")}
            >
              <Icon name="facebook" />
            </a>
            <a
              href={contact.whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("whatsapp")}
            >
              <Icon name="whatsapp" />
            </a>
            <a
              href={contact.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("instagram")}
            >
              <Icon name="instagram" />
            </a>
          </p>
        </div>
        <ul className="footer-links">
          {mainLinks.map(({ href, key }) => (
            <li key={key}>
              <Link href={href}>{tNav(key)}</Link>
            </li>
          ))}
        </ul>
        <nav aria-label={t("moreLinks")}>
          <ul className="footer-links">
            {extraLinks.map(({ href, key }) => (
              <li key={key}>
                <Link href={href}>{tNav(key)}</Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton label={t("cookieSettings")} />
            </li>
          </ul>
        </nav>
      </div>
      <div className="wrap">
        <p className="footer-copyright">
          {t("copyright", { year: String(new Date().getFullYear()) })}
        </p>
      </div>
    </footer>
  );
}
