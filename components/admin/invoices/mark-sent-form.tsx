"use client";

import { ActionForm } from "@/components/admin/form";
import { t } from "@/lib/admin/strings";
import { markSent } from "@/lib/invoicing/actions";

const s = t.invoices.selection;

/** The same step for a selection and for a whole month. */
export function MarkSentForm({ ids }: { ids: string[] }) {
  return (
    <ActionForm
      action={markSent}
      submitLabel={s.markSubmit}
      pendingLabel={s.marking}
    >
      {ids.map((id) => (
        <input type="hidden" name="id" value={id} key={id} />
      ))}
      <label className="choice">
        <input type="checkbox" name="confirm" value="yes" />
        <span>{s.confirm}</span>
      </label>
    </ActionForm>
  );
}
