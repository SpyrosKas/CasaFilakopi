"use client";

import { useActionState } from "react";
import { useHydrated } from "@/components/admin/use-hydrated";
import { ActionForm, Field, FormMessage } from "@/components/admin/form";
import {
  finishEnrolment,
  startEnrolment,
  type EnrolState,
} from "@/lib/admin/actions/mfa";
import { t } from "@/lib/admin/strings";

const start = (): Promise<EnrolState> => startEnrolment();

/** Sets up TOTP. The key is shown only here and is never stored by the app. */
export function EnrolForm({ intro }: { intro: string }) {
  const [state, startAction, starting] = useActionState<EnrolState>(start, {
    status: "idle",
  });
  const enrolment = state.enrolment;
  const isReady = useHydrated();

  if (!enrolment) {
    return (
      <div className="stack">
        <h1>{t.mfa.enrolTitle}</h1>
        <p>{intro}</p>
        <FormMessage state={state} />
        <ol className="steps">
          <li>{t.mfa.stepInstall}</li>
          <li>{t.mfa.stepStart}</li>
        </ol>
        <form action={startAction}>
          <button
            type="submit"
            className="button"
            disabled={starting || !isReady}
          >
            {starting ? t.mfa.starting : t.mfa.start}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>{t.mfa.enrolTitle}</h1>
      <h2>{t.mfa.stepScan}</h2>
      <a className="button button-quiet" href={enrolment.uri}>
        {t.mfa.onThisPhone}
      </a>
      <p>{t.mfa.otherDevice}</p>
      {/* A data URL from Supabase, so next/image has nothing to optimise. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="qr"
        src={enrolment.qrCode}
        alt={t.mfa.qrAlt}
        width={200}
        height={200}
      />
      <p>{t.mfa.manual}</p>
      <code className="secret" data-testid="totp-secret">
        {enrolment.secret}
      </code>
      <h2>{t.mfa.stepCode}</h2>
      <ActionForm
        action={finishEnrolment}
        submitLabel={t.mfa.enrolSubmit}
        pendingLabel={t.mfa.verifying}
      >
        <input type="hidden" name="factorId" value={enrolment.factorId} />
        <Field
          label={t.mfa.code}
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
        />
      </ActionForm>
    </div>
  );
}
