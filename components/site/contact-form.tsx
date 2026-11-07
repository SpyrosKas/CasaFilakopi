"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useState, type FormEvent } from "react";
import { contact } from "@/content/contact";
import { Link } from "@/i18n/navigation";
import { useConsent } from "./consent-store";
import { Turnstile } from "./turnstile";

// CNT-01. Turnstile sends the visitor's address and browser details to
// Cloudflare, so it is treated like the Google map (WEB-12): nothing loads until
// the visitor agrees. Accepting cookies counts. A visitor who declined can
// allow it for this one form with a button, and is not shut out.

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** Required in production (D28), so without it the form stays shut. */
const CLOSED = process.env.NODE_ENV === "production" && !SITE_KEY;

type Status = "idle" | "sending" | "sent";

type FieldName = "name" | "email" | "phone" | "dates" | "message";

function TextField({
  name,
  type = "text",
  label,
  error,
  required,
  autoComplete,
  multiline,
}: {
  name: FieldName;
  type?: string;
  label: string;
  error?: string;
  required?: boolean;
  autoComplete?: string;
  multiline?: boolean;
}) {
  const id = `contact-${name}`;
  const shared = {
    id,
    name,
    required,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
  return (
    <div className="contact-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...shared} rows={6} maxLength={5000} />
      ) : (
        <input {...shared} type={type} autoComplete={autoComplete} />
      )}
      {error && (
        <p className="contact-error" id={`${id}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}

export function ContactForm() {
  const t = useTranslations("ContactForm");
  const locale = useLocale();
  const { choice } = useConsent();

  const [status, setStatus] = useState<Status>("idle");
  const [invalid, setInvalid] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const [allowedHere, setAllowedHere] = useState(false);
  const [engaged, setEngaged] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const handleToken = useCallback(
    (value: string | null) => setToken(value),
    [],
  );

  const checkAllowed = choice === "accepted" || allowedHere;
  const waitingForCheck = !!SITE_KEY && !token;

  const error = (name: string) =>
    invalid.includes(name) ? t(`errors.${name}`) : undefined;

  const closedText = t("closed", {
    phone: contact.phoneDisplay,
    email: contact.email,
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status === "sending") return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => String(data.get(name) ?? "");

    setStatus("sending");
    setProblem(null);
    setInvalid([]);

    let code = "unavailable";
    let fields: string[] = [];
    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: text("name"),
          email: text("email"),
          phone: text("phone"),
          dates: text("dates"),
          message: text("message"),
          locale,
          consent: data.get("consent") === "on",
          website: text("website"),
          ...(token ? { turnstileToken: token } : {}),
        }),
      });
      if (response.ok) {
        setStatus("sent");
        return;
      }
      const result = (await response.json()) as {
        error?: string;
        fields?: string[];
      };
      code = result.error ?? code;
      fields = result.fields ?? [];
    } catch {
      // The message below covers a dropped connection too.
    }

    setStatus("idle");
    if (SITE_KEY) {
      setToken(null);
      setResetKey((key) => key + 1);
    }
    if (code === "invalid") {
      setInvalid(fields);
      setProblem(t("errors.form"));
    } else if (code === "rate_limited") {
      setProblem(t("errors.rateLimited"));
    } else if (code === "verification_failed") {
      setProblem(t("errors.verification"));
    } else if (code === "closed") {
      setProblem(closedText);
    } else {
      setProblem(t("errors.unavailable"));
    }
  }

  if (CLOSED) {
    return (
      <div className="contact-sent">
        <h2>{t("title")}</h2>
        <p>{closedText}</p>
      </div>
    );
  }

  if (status === "sent") {
    return (
      <div className="contact-sent" role="status">
        <h2>{t("sentTitle")}</h2>
        <p>{t("sentBody")}</p>
      </div>
    );
  }

  return (
    <form
      className="contact-form"
      onSubmit={submit}
      onFocusCapture={() => setEngaged(true)}
      noValidate
    >
      <h2>{t("title")}</h2>
      <TextField
        name="name"
        label={t("name")}
        required
        autoComplete="name"
        error={error("name")}
      />
      <TextField
        name="email"
        type="email"
        label={t("email")}
        required
        autoComplete="email"
        error={error("email")}
      />
      <TextField
        name="phone"
        type="tel"
        label={t("phone")}
        autoComplete="tel"
        error={error("phone")}
      />
      <TextField name="dates" label={t("dates")} error={error("dates")} />
      <TextField
        name="message"
        label={t("message")}
        required
        multiline
        error={error("message")}
      />

      {/* People never see this, and bots tend to fill every field. */}
      <div className="contact-trap" aria-hidden="true">
        <input
          id="contact-website"
          name="website"
          type="text"
          aria-label="Website"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="contact-consent">
        <input
          id="contact-consent"
          name="consent"
          type="checkbox"
          required
          aria-invalid={invalid.includes("consent") ? true : undefined}
          aria-describedby={
            invalid.includes("consent") ? "contact-consent-error" : undefined
          }
        />
        <label htmlFor="contact-consent">
          {t.rich("consent", {
            link: (chunks) => <Link href="/privacy">{chunks}</Link>,
          })}
        </label>
      </div>
      {invalid.includes("consent") && (
        <p className="contact-error" id="contact-consent-error">
          {t("errors.consent")}
        </p>
      )}

      {SITE_KEY &&
        (checkAllowed ? (
          engaged && (
            <Turnstile
              siteKey={SITE_KEY}
              locale={locale}
              resetKey={resetKey}
              failedText={t("errors.checkBlocked")}
              onToken={handleToken}
            />
          )
        ) : (
          <div className="contact-check">
            <p>{t("checkNotice")}</p>
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={() => {
                setAllowedHere(true);
                setEngaged(true);
              }}
            >
              {t("checkAllow")}
            </button>
          </div>
        ))}

      {problem && (
        <p className="contact-problem" role="alert">
          {problem}
        </p>
      )}

      <button
        type="submit"
        className="btn btn-primary"
        disabled={status === "sending" || waitingForCheck}
      >
        {status === "sending" ? t("sending") : t("send")}
      </button>
    </form>
  );
}
