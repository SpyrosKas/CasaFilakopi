"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Link } from "@/i18n/navigation";
import type { QuoteView } from "@/lib/payments/quote";
import type { StayChoice } from "./use-stay";

type ReadyQuote = Extract<QuoteView, { ok: true }>;

/** Survives a guest pressing back from Stripe. This tab only. */
const DRAFT_KEY = "cf-checkout-draft";

type Draft = Record<string, string>;

function readDraft(): Draft {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Draft;
  } catch {
    return {};
  }
}

function saveDraft(draft: Draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // A private window may refuse. The form still works.
  }
}

function Field({
  name,
  label,
  type = "text",
  required,
  autoComplete,
  multiline,
  invalid,
  errorText,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  autoComplete?: string;
  multiline?: boolean;
  invalid?: boolean;
  errorText?: string;
  defaultValue?: string;
}) {
  const id = `checkout-${name}`;
  const shared = {
    id,
    name,
    required,
    defaultValue,
    "aria-invalid": invalid ? true : undefined,
    "aria-describedby": invalid ? `${id}-error` : undefined,
  };
  return (
    <div className="contact-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...shared} rows={4} maxLength={2000} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
      {invalid && (
        <p className="contact-error" id={`${id}-error`}>
          {errorText}
        </p>
      )}
    </div>
  );
}

export function CheckoutForm({
  choice,
  quote,
  promoCode,
  onPromo,
  onBack,
}: {
  choice: StayChoice;
  quote: ReadyQuote;
  promoCode: string;
  onPromo: (code: string) => void;
  onBack: () => void;
}) {
  const t = useTranslations("Book");
  const locale = useLocale();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<string[]>([]);
  const [draft] = useState(readDraft);
  const [promoDraft, setPromoDraft] = useState(promoCode);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
    // A guest coming back from Stripe may land on a frozen copy of this page.
    const reset = () => setSending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const link = (href: "/terms" | "/cancellation" | "/privacy") =>
    function PolicyLink(chunks: ReactNode) {
      return (
        <Link href={href} target="_blank">
          {chunks}
        </Link>
      );
    };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const data = new FormData(event.currentTarget);
    const text = (name: string) => String(data.get(name) ?? "");
    const fields = {
      name: text("name"),
      email: text("email"),
      phone: text("phone"),
      country: text("country"),
      arrivalTime: text("arrivalTime"),
      specialRequests: text("specialRequests"),
    };
    saveDraft(fields);

    setSending(true);
    setProblem(null);
    setInvalid([]);

    let code = "unavailable";
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          checkIn: choice.checkIn,
          checkOut: choice.checkOut,
          adults: choice.adults,
          children: choice.children,
          locale,
          ...(promoCode ? { promoCode } : {}),
          ...fields,
          marketing: data.get("marketing") === "on",
          acceptTerms: data.get("acceptTerms") === "on",
        }),
      });
      const result = (await response.json()) as {
        url?: string;
        path?: string;
        error?: string;
        fields?: string[];
      };
      const next = result.url ?? result.path;
      if (response.ok && next) {
        window.location.assign(next);
        return;
      }
      code = result.error ?? code;
      if (code === "invalid") {
        setInvalid(result.fields ?? []);
        code = "form";
      }
    } catch {
      // The message below covers a dropped connection too.
    }
    setSending(false);
    setProblem(
      t.has(`errors.${code}`) ? t(`errors.${code}`) : t("errors.unavailable"),
    );
  }

  const isInvalid = (name: string) => invalid.includes(name);

  return (
    <form className="contact-form checkout-form" onSubmit={submit} noValidate>
      <button type="button" className="link-button" onClick={onBack}>
        {t("back")}
      </button>
      <h2 ref={heading} tabIndex={-1}>
        {t("details.title")}
      </h2>

      <Field
        name="name"
        label={t("details.name")}
        required
        autoComplete="name"
        defaultValue={draft.name}
        invalid={isInvalid("name")}
        errorText={t("errors.name")}
      />
      <Field
        name="email"
        type="email"
        label={t("details.email")}
        required
        autoComplete="email"
        defaultValue={draft.email}
        invalid={isInvalid("email")}
        errorText={t("errors.email")}
      />
      <Field
        name="phone"
        type="tel"
        label={t("details.phone")}
        required
        autoComplete="tel"
        defaultValue={draft.phone}
        invalid={isInvalid("phone")}
        errorText={t("errors.phone")}
      />
      <Field
        name="country"
        label={t("details.country")}
        required
        autoComplete="country-name"
        defaultValue={draft.country}
        invalid={isInvalid("country")}
        errorText={t("errors.country")}
      />
      <Field
        name="arrivalTime"
        type="time"
        label={t("details.arrivalTime")}
        defaultValue={draft.arrivalTime}
        invalid={isInvalid("arrivalTime")}
        errorText={t("errors.arrivalTime")}
      />
      <Field
        name="specialRequests"
        label={t("details.requests")}
        multiline
        defaultValue={draft.specialRequests}
        invalid={isInvalid("specialRequests")}
        errorText={t("errors.specialRequests")}
      />

      <div className="contact-field">
        <label htmlFor="checkout-promo">{t("promo.label")}</label>
        <input
          id="checkout-promo"
          value={promoDraft}
          maxLength={40}
          autoComplete="off"
          onChange={(event) => setPromoDraft(event.target.value)}
          onBlur={() => onPromo(promoDraft.trim())}
        />
        <p className="promo-note" aria-live="polite">
          {quote.promoApplied && t("promo.applied")}
          {quote.promoRejected && (
            <span className="contact-error">{t("promo.rejected")}</span>
          )}
        </p>
      </div>

      <section className="checkout-rules" aria-labelledby="checkout-rules">
        <h3 id="checkout-rules">{t("details.cancellationTitle")}</h3>
        {quote.cancellation ? (
          quote.cancellation.split("\n").map((line) => <p key={line}>{line}</p>)
        ) : (
          <p>
            {t.rich("details.cancellationNone", {
              cancellation: link("/cancellation"),
            })}
          </p>
        )}
      </section>

      <div className="contact-consent">
        <input id="checkout-marketing" name="marketing" type="checkbox" />
        <label htmlFor="checkout-marketing">{t("details.marketing")}</label>
      </div>

      <div className="contact-consent">
        <input
          id="checkout-terms"
          name="acceptTerms"
          type="checkbox"
          required
          aria-invalid={isInvalid("acceptTerms") ? true : undefined}
          aria-describedby={
            isInvalid("acceptTerms") ? "checkout-terms-error" : undefined
          }
        />
        <label htmlFor="checkout-terms">
          {t.rich("details.terms", {
            terms: link("/terms"),
            cancellation: link("/cancellation"),
            privacy: link("/privacy"),
          })}
        </label>
      </div>
      {isInvalid("acceptTerms") && (
        <p className="contact-error" id="checkout-terms-error">
          {t("errors.acceptTerms")}
        </p>
      )}

      {problem && (
        <p className="contact-problem" role="alert">
          {problem}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={sending}>
        {sending
          ? t("details.sending")
          : quote.dueNowCents === 0
            ? t("details.payNothing")
            : t("details.pay")}
      </button>
      {quote.dueNowCents > 0 && (
        <p className="checkout-note">
          {t("details.secure")} {t("details.holdNote")}
        </p>
      )}
    </form>
  );
}
