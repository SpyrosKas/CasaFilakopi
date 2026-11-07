"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { decideConsent, openConsentBanner, useConsent } from "./consent-store";

export function CookieBanner() {
  const t = useTranslations("Consent");
  const { bannerOpen } = useConsent();
  if (!bannerOpen) return null;

  return (
    <section className="cookie-banner" aria-label={t("bannerLabel")}>
      <div className="cookie-banner__inner">
        <p className="cookie-banner__text">
          {t("text")} <Link href="/cookies">{t("policy")}</Link>
        </p>
        {/* Same size, same style, one click each: declining is as easy as accepting. */}
        <div className="cookie-banner__actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => decideConsent("declined")}
          >
            {t("decline")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => decideConsent("accepted")}
          >
            {t("accept")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function CookieSettingsButton({ label }: { label: string }) {
  return (
    <button type="button" className="link-button" onClick={openConsentBanner}>
      {label}
    </button>
  );
}
