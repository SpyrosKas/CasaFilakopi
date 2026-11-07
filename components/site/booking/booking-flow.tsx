"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { SiteContact } from "@/lib/cms/public";
import { CheckoutForm } from "./checkout-form";
import { StayPicker, StaySummary } from "./stay-picker";
import {
  useAvailability,
  useQuote,
  useStayChoice,
  type StayChoice,
} from "./use-stay";
import "./booking.css";

type HostContact = Pick<
  SiteContact,
  "email" | "whatsappHref" | "whatsappDisplay"
>;

/** The two lines come from Admin's text for this page. */
export interface ClosedNotice {
  title: string;
  body: string;
}

export function PaymentsClosed({
  contact,
  notice,
}: {
  contact: HostContact;
  notice: ClosedNotice;
}) {
  const t = useTranslations("Book");
  return (
    <div className="booking-closed">
      <h3>{notice.title}</h3>
      <p>{notice.body}</p>
      <p className="book-links">
        <a href={`mailto:${contact.email}`}>
          {t("emailLabel", { email: contact.email })}
        </a>
        <a href={contact.whatsappHref}>
          {t("whatsappLabel", { number: contact.whatsappDisplay })}
        </a>
      </p>
    </div>
  );
}

/** The dates step, then the details step, on one page (BKG-07). */
export function BookingFlow({
  initial,
  contact,
  closed,
}: {
  initial: Partial<StayChoice>;
  contact: HostContact;
  closed: ClosedNotice;
}) {
  const t = useTranslations("Book");
  const { availability, failed, rules } = useAvailability(true);
  const { choice, pick, clear, setGuests } = useStayChoice(initial);
  const [step, setStep] = useState<"stay" | "details">("stay");
  const [promoCode, setPromoCode] = useState("");
  const quote = useQuote(choice, promoCode);

  if (failed) return <p className="contact-problem">{t("loadFailed")}</p>;
  if (!availability || !rules) {
    return (
      <p className="calendar-loading" role="status">
        {t("loading")}
      </p>
    );
  }

  const ready = quote.state === "ready" && quote.quote.ok ? quote.quote : null;

  return (
    <div className="booking-layout">
      <div className="booking-main">
        {step === "stay" ? (
          <StayPicker
            id="book"
            availability={availability}
            rules={rules}
            choice={choice}
            onPick={(date) => pick(date, rules)}
            onClear={clear}
            onGuests={setGuests}
          />
        ) : (
          ready && (
            <CheckoutForm
              choice={choice}
              quote={ready}
              promoCode={promoCode}
              onPromo={setPromoCode}
              onBack={() => setStep("stay")}
            />
          )
        )}
      </div>
      <StaySummary
        quote={quote}
        action={
          step === "stay" &&
          ready &&
          (ready.paymentsOpen ? (
            <button
              type="button"
              className="btn btn-primary stay-continue"
              onClick={() => setStep("details")}
            >
              {t("continue")}
            </button>
          ) : (
            <PaymentsClosed contact={contact} notice={closed} />
          ))
        }
      />
    </div>
  );
}
