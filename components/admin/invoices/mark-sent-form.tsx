"use client";

import { useAdminI18n } from "@/components/admin/language-provider";
import { ActionForm } from "@/components/admin/form";
import { markSent } from "@/lib/invoicing/actions";

/** The same step for a selection and for a whole month. */
export function MarkSentForm({ ids }: { ids: string[] }) {
  const { t } = useAdminI18n();
  const s = t.invoices.selection;

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
