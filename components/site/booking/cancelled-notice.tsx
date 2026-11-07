"use client";

import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Link } from "@/i18n/navigation";
import "./booking.css";

/** Frees the dates once the page has really loaded in a browser. */
export function CancelledNotice({
  releaseKey,
  againQuery,
}: {
  releaseKey: string | null;
  againQuery: string;
}) {
  const t = useTranslations("Book.cancelled");

  useEffect(() => {
    if (!releaseKey) return;
    fetch("/api/checkout/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: releaseKey }),
    }).catch(() => {
      // The hold ends by itself within 35 minutes.
    });
  }, [releaseKey]);

  return (
    <div className="booking-note">
      <p>{releaseKey ? t("body") : t("balanceBody")}</p>
      {releaseKey && (
        <Link href={`/book?${againQuery}`} className="btn btn-primary">
          {t("again")}
        </Link>
      )}
    </div>
  );
}
