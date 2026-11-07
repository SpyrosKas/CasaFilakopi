"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/site/error-screen";
import { Link } from "@/i18n/navigation";
import { publicMediaUrl, SITE_PREFIX } from "@/lib/cms/media-url";

// An error page must not depend on the database, so it uses a fixed photo.
const heroPhoto = publicMediaUrl(`${SITE_PREFIX}tinified/_DSC1164.jpg`);

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("Error");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorScreen image={heroPhoto} title={t("title")} body={t("body")}>
      <button type="button" className="btn btn-primary" onClick={reset}>
        {t("retry")}
      </button>
      <Link href="/" className="btn btn-outline-primary">
        {t("home")}
      </Link>
    </ErrorScreen>
  );
}
