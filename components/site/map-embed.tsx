"use client";

import { useTranslations } from "next-intl";
import { contact } from "@/content/contact";
import { decideConsent, useConsent } from "./consent-store";

/**
 * Google Maps sets cookies, so the iframe exists only after consent (WEB-10).
 * `load={false}` also holds it back while the fullscreen menu is closed.
 */
export function MapEmbed({ load = true }: { load?: boolean }) {
  const t = useTranslations("Map");
  const { choice } = useConsent();

  if (choice === "accepted") {
    if (!load) return null;
    return (
      <iframe
        className="map-frame"
        src={contact.mapEmbed}
        title={t("title")}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    );
  }

  return (
    <div className="map-placeholder">
      <p>{t("blocked")}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => decideConsent("accepted")}
      >
        {t("allow")}
      </button>
      <a href={contact.mapLink} target="_blank" rel="noopener noreferrer">
        {t("openExternally")}
      </a>
    </div>
  );
}
