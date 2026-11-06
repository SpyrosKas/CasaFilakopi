"use client";

import { useActionState, useState, useTransition, type FormEvent } from "react";
import { FormMessage } from "@/components/admin/form";
import { saveRules } from "@/lib/admin/actions/settings";
import { idleState } from "@/lib/admin/form-state";
import {
  centsToEuros,
  describeRules,
  eurosToCents,
  rulesSchema,
  type RulesInput,
} from "@/lib/admin/rules";
import { t } from "@/lib/admin/strings";
import type {
  CancellationRules,
  DepositRule,
  PaymentMode,
  PaymentRules,
} from "@/lib/domain/contracts";

const r = t.rules;

interface TierRow {
  key: number;
  days: string;
  percent: string;
}

/** A box being typed in may not hold a number yet. -1 fails the checks. */
function toNumber(text: string): number {
  const value = text.trim() === "" ? NaN : Number(text);
  return Number.isNaN(value) ? -1 : value;
}

export function RulesForm({ initial }: { initial: RulesInput }) {
  const [state, formAction, pending] = useActionState(saveRules, idleState);
  const [, startTransition] = useTransition();

  const deposit = initial.payment.deposit;
  const [mode, setMode] = useState<PaymentMode>(initial.payment.mode);
  const [depositKind, setDepositKind] = useState<DepositRule["kind"]>(
    deposit?.kind ?? "percent",
  );
  const [percent, setPercent] = useState(
    deposit?.kind === "percent" ? String(deposit.percent) : "30",
  );
  const [euros, setEuros] = useState(
    deposit?.kind === "fixed" ? centsToEuros(deposit.amountCents) : "",
  );
  const [balanceDays, setBalanceDays] = useState(
    String(initial.payment.balanceDaysBefore),
  );
  const [nonRefundable, setNonRefundable] = useState(
    initial.cancellation.isNonRefundable,
  );
  const [rows, setRows] = useState<TierRow[]>(() =>
    initial.cancellation.tiers.map((tier, index) => ({
      key: index,
      days: String(tier.daysBefore),
      percent: String(tier.refundPercent),
    })),
  );
  const [nextKey, setNextKey] = useState(initial.cancellation.tiers.length);

  const depositRule: DepositRule =
    depositKind === "percent"
      ? { kind: "percent", percent: toNumber(percent) }
      : { kind: "fixed", amountCents: eurosToCents(euros) ?? -1 };

  const payment: PaymentRules = {
    mode,
    deposit: mode === "deposit" ? depositRule : null,
    balanceDaysBefore: toNumber(balanceDays),
  };
  const cancellation: CancellationRules = {
    isNonRefundable: nonRefundable,
    tiers: nonRefundable
      ? []
      : rows.map((row) => ({
          daysBefore: toNumber(row.days),
          refundPercent: toNumber(row.percent),
        })),
  };

  // The same checks the server runs, so the preview never shows nonsense.
  const check = rulesSchema.safeParse({ payment, cancellation });
  const preview = check.success
    ? describeRules(check.data.payment, check.data.cancellation)
    : null;
  const errors = state.fieldErrors ?? {};
  const depositError =
    errors["payment.deposit"] ??
    errors["payment.deposit.percent"] ??
    errors["payment.deposit.amountCents"];
  const tierError = Object.entries(errors).find(([key]) =>
    key.startsWith("cancellation.tiers"),
  )?.[1];

  const updateRow = (key: number, change: Partial<TierRow>) =>
    setRows(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));

  const addRow = () => {
    setRows([...rows, { key: nextKey, days: "", percent: "" }]);
    setNextKey(nextKey + 1);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData();
    data.set("rules", JSON.stringify({ payment, cancellation }));
    startTransition(() => formAction(data));
  };

  const modes: { value: PaymentMode; label: string }[] = [
    { value: "full", label: r.modeFull },
    { value: "deposit", label: r.modeDeposit },
    { value: "on_arrival", label: r.modeOnArrival },
  ];

  return (
    <form onSubmit={onSubmit} noValidate className="stack">
      <p className="notice notice-info">{r.newOnly}</p>
      <FormMessage state={state} />

      <fieldset>
        <legend>{r.paymentHeading}</legend>
        {modes.map((option) => (
          <label className="choice" key={option.value}>
            <input
              type="radio"
              name="mode"
              checked={mode === option.value}
              onChange={() => setMode(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </fieldset>

      {mode === "deposit" && (
        <fieldset>
          <legend>{r.depositHeading}</legend>
          <label className="choice">
            <input
              type="radio"
              name="depositKind"
              checked={depositKind === "percent"}
              onChange={() => setDepositKind("percent")}
            />
            <span>{r.depositPercent}</span>
          </label>
          <label className="choice">
            <input
              type="radio"
              name="depositKind"
              checked={depositKind === "fixed"}
              onChange={() => setDepositKind("fixed")}
            />
            <span>{r.depositFixed}</span>
          </label>
          {depositKind === "percent" ? (
            <div className="field">
              <label htmlFor="deposit-percent">{r.depositPercentField}</label>
              <input
                id="deposit-percent"
                inputMode="numeric"
                value={percent}
                onChange={(event) => setPercent(event.target.value)}
              />
            </div>
          ) : (
            <div className="field">
              <label htmlFor="deposit-euros">{r.depositAmountField}</label>
              <input
                id="deposit-euros"
                inputMode="decimal"
                value={euros}
                onChange={(event) => setEuros(event.target.value)}
              />
            </div>
          )}
          {depositError && <p className="field-error">{depositError}</p>}
          <div className="field">
            <label htmlFor="balance-days">{r.balanceField}</label>
            <input
              id="balance-days"
              inputMode="numeric"
              value={balanceDays}
              onChange={(event) => setBalanceDays(event.target.value)}
            />
            {errors["payment.balanceDaysBefore"] && (
              <p className="field-error">
                {errors["payment.balanceDaysBefore"]}
              </p>
            )}
          </div>
        </fieldset>
      )}

      <fieldset>
        <legend>{r.cancelHeading}</legend>
        <label className="choice">
          <input
            type="checkbox"
            checked={nonRefundable}
            onChange={(event) => setNonRefundable(event.target.checked)}
          />
          <span>{r.nonRefundable}</span>
        </label>

        {!nonRefundable && (
          <>
            <p className="hint">{r.tierIntro}</p>
            {rows.map((row, index) => (
              <div className="tier" key={row.key}>
                <p className="tier-title">{r.tierLine(index + 1)}</p>
                <div className="tier-fields">
                  <div className="field">
                    <label htmlFor={`tier-days-${row.key}`}>{r.tierDays}</label>
                    <input
                      id={`tier-days-${row.key}`}
                      inputMode="numeric"
                      value={row.days}
                      onChange={(event) =>
                        updateRow(row.key, { days: event.target.value })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`tier-percent-${row.key}`}>
                      {r.tierPercent}
                    </label>
                    <input
                      id={`tier-percent-${row.key}`}
                      inputMode="numeric"
                      value={row.percent}
                      onChange={(event) =>
                        updateRow(row.key, { percent: event.target.value })
                      }
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() =>
                    setRows(rows.filter((other) => other.key !== row.key))
                  }
                >
                  {r.removeTier(index + 1)}
                </button>
              </div>
            ))}
            {tierError && <p className="field-error">{tierError}</p>}
            <button
              type="button"
              className="button button-quiet"
              onClick={addRow}
            >
              {r.addTier}
            </button>
          </>
        )}
      </fieldset>

      <section className="preview" aria-labelledby="preview-heading">
        <h2 id="preview-heading">{r.previewHeading}</h2>
        {preview ? (
          <>
            <h3>{r.previewPayment}</h3>
            {preview.payment.map((line) => (
              <p key={line}>{line}</p>
            ))}
            <h3>{r.previewCancellation}</h3>
            {preview.cancellation.map((line) => (
              <p key={line}>{line}</p>
            ))}
            {mode === "on_arrival" && <p className="hint">{r.onArrivalNote}</p>}
          </>
        ) : (
          <p className="field-error">
            {check.error?.issues[0]?.message ?? t.common.fixErrors}
          </p>
        )}
      </section>

      <button type="submit" className="button" disabled={pending}>
        {pending ? t.common.saving : t.common.save}
      </button>
    </form>
  );
}
