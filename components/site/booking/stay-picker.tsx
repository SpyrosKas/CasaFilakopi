"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { CalendarRules } from "@/lib/payments/calendar";
import type { AvailabilityView, QuoteView } from "@/lib/payments/quote";
import { AvailabilityCalendar } from "./availability-calendar";
import { PriceBreakdownView, useMoney } from "./price-summary";
import type { StayChoice } from "./use-stay";

type Quote =
  | { state: "none" }
  | { state: "working" }
  | { state: "failed" }
  | { state: "ready"; quote: QuoteView };

function GuestSelect({
  id,
  label,
  value,
  from,
  to,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  from: number;
  to: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="contact-field guest-select">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {Array.from({ length: Math.max(to - from + 1, 1) }, (_, index) => (
          <option key={index} value={from + index}>
            {from + index}
          </option>
        ))}
      </select>
    </div>
  );
}

function QuoteMessage({ quote }: { quote: Extract<QuoteView, { ok: false }> }) {
  const t = useTranslations("Book.reasons");
  return (
    <p className="contact-problem" role="alert">
      {quote.reason === "below_min_stay" && quote.minNights
        ? t("below_min_stay_nights", { count: quote.minNights })
        : t(quote.reason)}
    </p>
  );
}

export function StaySummary({
  quote,
  action,
}: {
  quote: Quote;
  action?: ReactNode;
}) {
  const t = useTranslations("Book.summary");
  return (
    <aside className="stay-summary" aria-labelledby="stay-summary-title">
      <h2 id="stay-summary-title">{t("title")}</h2>
      <div aria-live="polite">
        {quote.state === "none" && <p>{t("empty")}</p>}
        {quote.state === "working" && <p>{t("working")}</p>}
        {quote.state === "failed" && (
          <p className="contact-problem">{t("failed")}</p>
        )}
        {quote.state === "ready" &&
          (quote.quote.ok ? (
            <PriceBreakdownView quote={quote.quote} />
          ) : (
            <QuoteMessage quote={quote.quote} />
          ))}
      </div>
      {action}
    </aside>
  );
}

export function StayPicker({
  id,
  availability,
  rules,
  choice,
  onPick,
  onClear,
  onGuests,
}: {
  id: string;
  availability: AvailabilityView;
  rules: CalendarRules;
  choice: StayChoice;
  onPick: (date: string) => void;
  onClear: () => void;
  onGuests: (guests: { adults?: number; children?: number }) => void;
}) {
  const t = useTranslations("Book");
  const { date } = useMoney();
  const { checkIn, checkOut } = choice;

  return (
    <div className="stay-picker">
      <dl className="stay-dates">
        <div>
          <dt>{t("calendar.checkIn")}</dt>
          <dd>{checkIn ? date(checkIn) : t("calendar.notChosen")}</dd>
        </div>
        <div>
          <dt>{t("calendar.checkOut")}</dt>
          <dd>{checkOut ? date(checkOut) : t("calendar.notChosen")}</dd>
        </div>
      </dl>
      <p className="stay-help" aria-live="polite">
        {checkIn && checkOut
          ? t("calendar.picked", {
              checkIn: date(checkIn),
              checkOut: date(checkOut),
            })
          : checkIn
            ? t("calendar.helpCheckOut")
            : t("calendar.help")}
      </p>
      <AvailabilityCalendar
        rules={rules}
        selection={choice}
        onPick={onPick}
        onClear={onClear}
      />
      <fieldset className="stay-guests">
        <legend>{t("guests.legend")}</legend>
        <GuestSelect
          id={`${id}-adults`}
          label={t("guests.adults")}
          value={Math.min(choice.adults, availability.maxAdults)}
          from={1}
          to={availability.maxAdults}
          onChange={(adults) => onGuests({ adults })}
        />
        <GuestSelect
          id={`${id}-children`}
          label={t("guests.children")}
          value={Math.min(choice.children, availability.maxChildren)}
          from={0}
          to={availability.maxChildren}
          onChange={(children) => onGuests({ children })}
        />
      </fieldset>
    </div>
  );
}
