"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { ErrorScreen } from "@/components/site/error-screen";
import { Link } from "@/i18n/navigation";

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
    <ErrorScreen title={t("title")} body={t("body")}>
      <button
        type="button"
        className="btn btn-primary text-white mr-2 mb-2"
        onClick={reset}
      >
        {t("retry")}
      </button>
      <Link href="/" className="btn btn-outline-primary mb-2">
        {t("home")}
      </Link>
    </ErrorScreen>
  );
}
