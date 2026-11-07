"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { useMoney } from "./price-summary";

const post = (path: string, body: unknown) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export function PayBalance({ token }: { token: string }) {
  const t = useTranslations("Book.guest");
  const locale = useLocale();
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function pay() {
    setSending(true);
    setProblem(null);
    try {
      const response = await post("/api/checkout/balance", { token, locale });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (response.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      if (result.error === "nothing_due") {
        window.location.reload();
        return;
      }
      setProblem(
        result.error === "processing"
          ? t("balanceProcessing")
          : t("balanceUnavailable"),
      );
    } catch {
      setProblem(t("balanceUnavailable"));
    }
    setSending(false);
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary"
        disabled={sending}
        onClick={pay}
      >
        {sending ? t("paying") : t("payBalance")}
      </button>
      {problem && (
        <p className="contact-problem" role="alert">
          {problem}
        </p>
      )}
    </>
  );
}

function MessageForm({
  token,
  cancelRequest,
  label,
  submitLabel,
  sentText,
}: {
  token: string;
  cancelRequest: boolean;
  label: string;
  submitLabel: string;
  sentText: string;
}) {
  const t = useTranslations("Book.guest");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const id = cancelRequest ? "guest-cancel-message" : "guest-message";

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = String(new FormData(event.currentTarget).get("message"));
    setState("sending");
    setProblem(null);
    try {
      const response = await post("/api/checkout/guest/message", {
        token,
        message,
        cancelRequest,
      });
      if (response.ok) {
        setState("sent");
        return;
      }
      setProblem(response.status === 429 ? t("messageTooMany") : t("failed"));
    } catch {
      setProblem(t("failed"));
    }
    setState("idle");
  }

  if (state === "sent") {
    return <p role="status">{sentText}</p>;
  }
  return (
    <form className="contact-form" onSubmit={send}>
      <div className="contact-field">
        <label htmlFor={id}>{label}</label>
        <textarea id={id} name="message" rows={4} required maxLength={4000} />
      </div>
      {problem && (
        <p className="contact-problem" role="alert">
          {problem}
        </p>
      )}
      <button
        type="submit"
        className="btn btn-outline-primary"
        disabled={state === "sending"}
      >
        {state === "sending" ? t("messageSending") : submitLabel}
      </button>
    </form>
  );
}

export function MessageHost({ token }: { token: string }) {
  const t = useTranslations("Book.guest");
  return (
    <MessageForm
      token={token}
      cancelRequest={false}
      label={t("messageLabel")}
      submitLabel={t("messageSend")}
      sentText={t("messageSent")}
    />
  );
}

export function RequestCancellation({ token }: { token: string }) {
  const t = useTranslations("Book.guest");
  return (
    <>
      <p>{t("cancelAskIntro")}</p>
      <MessageForm
        token={token}
        cancelRequest
        label={t("cancelAskLabel")}
        submitLabel={t("cancelAskSend")}
        sentText={t("cancelAskSent")}
      />
    </>
  );
}

export function CancelBooking({
  token,
  refundCents,
}: {
  token: string;
  refundCents: number;
}) {
  const t = useTranslations("Book.guest");
  const { money } = useMoney();
  const [step, setStep] = useState<"idle" | "confirm" | "sending">("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{
    refundCents: number;
    refundDelayed: boolean;
  } | null>(null);

  async function cancel() {
    setStep("sending");
    setProblem(null);
    try {
      const response = await post("/api/checkout/guest/cancel", {
        token,
        expectedRefundCents: refundCents,
      });
      const result = (await response.json()) as {
        kind?: string;
        refundCents?: number;
        refundDelayed?: boolean;
        error?: string;
      };
      if (response.ok && result.kind === "cancelled") {
        setDone({
          refundCents: result.refundCents ?? 0,
          refundDelayed: result.refundDelayed ?? false,
        });
        return;
      }
      setProblem(
        result.error === "moved" || result.error === "needs_host"
          ? t("cancelMoved")
          : t("failed"),
      );
    } catch {
      setProblem(t("failed"));
    }
    setStep("confirm");
  }

  if (done) {
    const amount = money(done.refundCents);
    return (
      <div role="status" data-testid="guest-cancelled">
        <p>{t("cancelDone")}</p>
        {done.refundCents > 0 && (
          <p>
            {done.refundDelayed
              ? t("cancelDoneDelayed", { amount })
              : t("cancelDoneRefund", { amount })}
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <p>{t("cancelFree")}</p>
      <p>
        {refundCents > 0
          ? t("cancelRefund", { amount: money(refundCents) })
          : t("cancelNoMoney")}
      </p>
      {problem && (
        <p className="contact-problem" role="alert">
          {problem}
        </p>
      )}
      {step === "idle" ? (
        <button
          type="button"
          className="btn btn-outline-primary"
          onClick={() => setStep("confirm")}
        >
          {t("cancelButton")}
        </button>
      ) : (
        <div className="guest-confirm">
          <button
            type="button"
            className="btn btn-primary"
            disabled={step === "sending"}
            onClick={cancel}
          >
            {step === "sending" ? t("cancelSending") : t("cancelConfirm")}
          </button>
          <button
            type="button"
            className="btn btn-outline-primary"
            disabled={step === "sending"}
            onClick={() => setStep("idle")}
          >
            {t("cancelKeep")}
          </button>
        </div>
      )}
    </>
  );
}
