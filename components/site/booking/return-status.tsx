"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { SiteContact } from "@/lib/cms/public";
import "./booking.css";

type State =
  | { state: "confirming" }
  | { state: "not_paid" }
  | { state: "problem" }
  | { state: "unknown" }
  | { state: "confirmed"; reference: string | null; path: string | null };

const POLL_MS = 2500;
const SLOW_POLL_MS = 15_000;
/** After this it says it is slow, and asks less often. */
const SLOW_AFTER_MS = 60_000;
/** After this it stops saying "confirming" and hands over to the host. */
const STUCK_AFTER_MS = 5 * 60_000;

/**
 * Never says confirmed by itself. Arriving on this page proves nothing, so it
 * asks the server until the verified webhook has changed the booking (BKG-12).
 */
export function ReturnStatus({
  sessionId,
  contact,
}: {
  sessionId: string | null;
  contact: Pick<
    SiteContact,
    "email" | "phoneDisplay" | "phoneHref" | "whatsappDisplay" | "whatsappHref"
  >;
}) {
  const t = useTranslations("Book.return");
  const [status, setStatus] = useState<State>(
    sessionId ? { state: "confirming" } : { state: "unknown" },
  );
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();

    async function poll() {
      try {
        const response = await fetch(
          `/api/checkout/status?session_id=${encodeURIComponent(sessionId!)}`,
        );
        if (response.status === 404) {
          if (!stopped) setStatus({ state: "unknown" });
          return;
        }
        if (response.ok) {
          const next = (await response.json()) as State;
          if (stopped) return;
          setStatus(next);
          if (next.state !== "confirming") return;
        }
      } catch {
        // A dropped connection is no news. The next poll tries again.
      }
      if (stopped) return;
      const elapsed = Date.now() - started;
      setWaited(elapsed);
      timer = setTimeout(
        poll,
        elapsed < SLOW_AFTER_MS ? POLL_MS : SLOW_POLL_MS,
      );
    }

    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId]);

  const again = (
    <Link href="/book" className="btn btn-primary">
      {t("again")}
    </Link>
  );

  switch (status.state) {
    case "confirmed":
      return (
        <div className="booking-note" data-state="confirmed">
          <h2>{t("confirmedTitle")}</h2>
          {status.reference && (
            <p>{t("confirmedReference", { reference: status.reference })}</p>
          )}
          {status.path && (
            <a className="btn btn-primary" href={status.path}>
              {t("open")}
            </a>
          )}
        </div>
      );
    case "confirming":
      if (waited >= STUCK_AFTER_MS) {
        return (
          <div className="booking-note" data-state="stuck">
            <h2>{t("stuckTitle")}</h2>
            <p>{t("stuckBody")}</p>
            <p className="book-links">
              <a href={contact.phoneHref}>{contact.phoneDisplay}</a>
              <a href={contact.whatsappHref}>{contact.whatsappDisplay}</a>
              <a href={`mailto:${contact.email}`}>{contact.email}</a>
            </p>
          </div>
        );
      }
      return (
        <div className="booking-note" role="status" data-state="confirming">
          <h2>{t("confirmingTitle")}</h2>
          <p>{waited >= SLOW_AFTER_MS ? t("slowBody") : t("confirmingBody")}</p>
        </div>
      );
    case "problem":
      return (
        <div className="booking-note" data-state="problem">
          <h2>{t("problemTitle")}</h2>
          <p>{t("problemBody")}</p>
        </div>
      );
    case "not_paid":
      return (
        <div className="booking-note" data-state="not_paid">
          <h2>{t("notPaidTitle")}</h2>
          <p>{t("notPaidBody")}</p>
          {again}
        </div>
      );
    default:
      return (
        <div className="booking-note" data-state="unknown">
          <h2>{t("unknownTitle")}</h2>
          <p>{t("unknownBody")}</p>
          {again}
        </div>
      );
  }
}
