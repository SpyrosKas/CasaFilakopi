import { useTranslations } from "next-intl";
import { contact } from "@/content/contact";
import { Link } from "@/i18n/navigation";
import { CookieSettingsButton } from "./cookie-banner";
import { Icon } from "./icon";
import { LanguageSwitcher } from "./language-switcher";

const mainLinks = [
  { href: "/", key: "home" },
  { href: "/book", key: "reservations" },
  { href: "/host", key: "host" },
  { href: "/directions", key: "directions" },
] as const;

const extraLinks = [
  { href: "/gallery", key: "gallery" },
  { href: "/contact", key: "contact" },
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

  return (
    <footer id="site-footer" className="section footer-section">
      <div className="container">
        <div className="row mb-4">
          <div className="col-md-3 mb-5">
            <ul className="list-unstyled link">
              {mainLinks.map(({ href, key }) => (
                <li key={key}>
                  <Link href={href}>{tNav(key)}</Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-md-6 mb-5 pr-md-5">
            <p className="text-center">
              {t("copyright", { year: String(new Date().getFullYear()) })}
            </p>
          </div>
          <div className="col-md-3 mb-5">
            <p className="text-right social">
              <a
                href={contact.facebook}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("facebook")}
              >
                <Icon name="facebook" />
              </a>{" "}
              <a
                href={contact.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("whatsapp")}
              >
                <Icon name="whatsapp" />
              </a>{" "}
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
        </div>
        <nav aria-label={t("moreLinks")}>
          <ul className="footer-extra">
            {extraLinks.map(({ href, key }) => (
              <li key={key}>
                <Link href={href}>{tNav(key)}</Link>
              </li>
            ))}
            <li>
              <CookieSettingsButton label={t("cookieSettings")} />
            </li>
            <li>
              <LanguageSwitcher />
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
