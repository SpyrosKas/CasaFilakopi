"use client";

import { useState } from "react";
import { ActionForm, Field } from "@/components/admin/form";
import { t } from "@/lib/admin/strings";
import { issueDocument } from "@/lib/invoicing/actions";
import type { IssuableDocType } from "@/lib/invoicing/types";

const s = t.invoices.issue;

export function IssueForm({
  paymentId,
  defaultType,
}: {
  paymentId: string;
  defaultType: IssuableDocType;
}) {
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
