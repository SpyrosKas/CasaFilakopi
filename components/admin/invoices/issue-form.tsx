"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { useState } from "react";
import { ActionForm, Field } from "@/components/admin/form";
import { issueDocument } from "@/lib/invoicing/actions";
import type { IssuableDocType } from "@/lib/invoicing/types";

export function IssueForm({
  paymentId,
  defaultType,
  unprintable,
}: {
  paymentId: string;
  defaultType: IssuableDocType;
  /** Characters in the guest's name that the PDF cannot show. */
  unprintable: string[];
}) {
  const { t } = useAdminI18n();
  const s = t.invoices.issue;

  const [docType, setDocType] = useState<IssuableDocType>(defaultType);
  const options = [
    {
      value: "receipt" as const,
      label: t.invoices.docType.receipt,
      hint: s.receiptHint,
    },
    {
      value: "invoice" as const,
      label: t.invoices.docType.invoice,
      hint: s.invoiceHint,
    },
  ];

  return (
    <ActionForm
      action={issueDocument}
      submitLabel={s.submit}
      pendingLabel={s.submitting}
    >
      <input type="hidden" name="paymentId" value={paymentId} />
      {unprintable.length > 0 && (
        <div className="stack" data-testid="name-warning">
          <p className="notice notice-bad">{s.nameWarning}</p>
          <Field
            label={s.billingName}
            name="billingName"
            hint={s.billingNameHint}
          />
        </div>
      )}
      <fieldset>
        <legend>{s.typeHeading}</legend>
        {options.map((option) => (
          <label className="choice" key={option.value}>
            <input
              type="radio"
              name="docType"
              value={option.value}
              checked={docType === option.value}
              onChange={() => setDocType(option.value)}
            />
            <span>
              {option.label}
              <span className="hint choice-hint">{option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {docType === "invoice" && (
        <fieldset>
          <legend>{s.companyHeading}</legend>
          <Field label={s.companyName} name="companyName" />
          <Field label={s.vatNumber} name="vatNumber" />
          <Field label={s.address} name="address" />
          <Field label={s.taxOffice} name="taxOffice" />
        </fieldset>
      )}

      <p className="notice notice-info">{s.warning}</p>
    </ActionForm>
  );
}
