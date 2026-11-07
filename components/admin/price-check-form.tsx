"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import {
  useActionState,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { FormContext, FormMessage } from "@/components/admin/form";
import { MoneyLines } from "@/components/admin/panel";
import { useHydrated } from "@/components/admin/use-hydrated";
import type { PreviewState } from "@/lib/admin/booking-ops";
import { idleState } from "@/lib/admin/form-state";

function PricePanel({ state }: { state: PreviewState }) {
  const { t, formatEuro } = useAdminI18n();
  const s = t.stayForm;

  const preview = state.preview;
  if (!preview) return null;
  const { previousCents, overpaidCents, totalCents } = preview;
  const difference =
    previousCents === undefined ? null : totalCents - previousCents;

  return (
    <section className="panel" aria-live="polite">
      <h2>{s.priceHeading}</h2>
      {preview.warnings.map((warning) => (
        <p key={warning} className="notice notice-warn">
          {warning}
        </p>
      ))}
      <MoneyLines
        lines={[
          ...preview.lines.map((line) => ({
            label: line.label,
            value: formatEuro(line.cents),
          })),
          { label: s.total, value: formatEuro(totalCents), strong: true },
          ...(previousCents === undefined
            ? []
            : [{ label: s.was, value: formatEuro(previousCents) }]),
        ]}
      />
      {difference !== null && (
        <p className="notice notice-info">
          {difference === 0
            ? s.same
            : `${difference > 0 ? s.extra : s.less}: ${formatEuro(Math.abs(difference))}`}
        </p>
      )}
      {Boolean(overpaidCents) && (
        <p className="notice notice-warn">
          {s.overpaid(formatEuro(overpaidCents as number))}
        </p>
      )}
    </section>
  );
}

/**
 * Two steps: see the price, then save. The server works the price out both
 * times and refuses the save if it moved, so what he saw is what he agreed.
 * Changing any box hides the price until it is checked again.
 */
export function PriceCheckForm({
  previewAction,
  submitAction,
  submitLabel,
  children,
}: {
  previewAction: (
    state: PreviewState,
    formData: FormData,
  ) => Promise<PreviewState>;
  submitAction: (
    state: PreviewState,
    formData: FormData,
  ) => Promise<PreviewState>;
  submitLabel: string;
  children: ReactNode;
}) {
  const { t } = useAdminI18n();
  const s = t.stayForm;

  const form = useRef<HTMLFormElement>(null);
  const [previewState, runPreview, previewing] = useActionState(
    previewAction,
    idleState as PreviewState,
  );
  const [submitState, runSubmit, submitting] = useActionState(
    submitAction,
    idleState as PreviewState,
  );
  const [isStale, setIsStale] = useState(false);
  const [lastRun, setLastRun] = useState<"preview" | "submit">("preview");
  const [, startTransition] = useTransition();
  const isReady = useHydrated();

  const state = lastRun === "submit" ? submitState : previewState;
  const shown = isStale
    ? undefined
    : (state.preview ? state : previewState).preview;
  const data = () => new FormData(form.current as HTMLFormElement);

  const preview = () => {
    setIsStale(false);
    setLastRun("preview");
    const fields = data();
    startTransition(() => runPreview(fields));
  };

  const submit = () => {
    if (!shown) return;
    setLastRun("submit");
    const fields = data();
    fields.set("expectedTotal", String(shown.totalCents));
    startTransition(() => runSubmit(fields));
  };

  return (
    <FormContext.Provider value={state}>
      <form
        ref={form}
        noValidate
        className="stack"
        onChange={() => setIsStale(true)}
        onSubmit={(event) => event.preventDefault()}
      >
        {state.status === "error" && <FormMessage state={state} />}
        {children}
        <button
          type="button"
          className={shown ? "button button-quiet" : "button"}
          disabled={previewing || !isReady}
          onClick={preview}
        >
          {previewing ? s.checking : s.check}
        </button>
        {shown && <PricePanel state={{ status: "ok", preview: shown }} />}
        {shown && (
          <button
            type="button"
            className="button"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? s.saving : submitLabel}
          </button>
        )}
      </form>
    </FormContext.Provider>
  );
}
