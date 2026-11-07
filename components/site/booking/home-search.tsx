"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import { StayPicker, StaySummary } from "./stay-picker";
import {
  stayQuery,
  useAvailability,
  useQuote,
  useStayChoice,
} from "./use-stay";
import "./booking.css";

/** WEB-05. Stays idle until it scrolls into view, as most visits never reach it. */
export function HomeSearch() {
  const t = useTranslations("Book");
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: "300px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);

  const { availability, failed, rules } = useAvailability(near);
  const { choice, pick, clear, setGuests } = useStayChoice();
  const quote = useQuote(choice, "");
  const canBook = quote.state === "ready" && quote.quote.ok;

  return (
    <div ref={root} className="home-search">
      <h2>{t("homeTitle")}</h2>
      <p>{t("homeIntro")}</p>
      {failed && <p className="contact-problem">{t("loadFailed")}</p>}
      {!failed && (!availability || !rules) && (
        <p className="calendar-loading" role="status">
          {t("loading")}
        </p>
      )}
      {availability && rules && (
        <div className="booking-layout">
          <div className="booking-main">
            <StayPicker
              id="home"
              availability={availability}
              rules={rules}
              choice={choice}
              onPick={(date) => pick(date, rules)}
              onClear={clear}
              onGuests={setGuests}
            />
          </div>
          <StaySummary
            quote={quote}
            action={
              canBook && (
                <Link
                  href={`/book?${stayQuery(choice)}`}
                  className="btn btn-primary stay-continue"
                >
                  {t("continue")}
                </Link>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
