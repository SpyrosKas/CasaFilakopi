import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm, Field, TextAreaField } from "@/components/admin/form";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { issueCreditNote } from "@/lib/invoicing/actions";
import { loadIndex } from "@/lib/invoicing/data";
import { plainAmount, formatEuro } from "@/lib/invoicing/format";

const s = t.invoices.credit;

export default async function CreditNotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const rows = await loadIndex(admin);
  const row = rows.find((entry) => entry.id === id);
  if (!row || row.docType === "credit_note") notFound();

  const credited = rows
    .filter((entry) => entry.creditsInvoiceId === id)
    .reduce((sum, entry) => sum + entry.totalCents, 0);
  const leftCents = row.totalCents - credited;

  return (
    <div className="stack">
      <h1>{s.title(row.documentNumber)}</h1>
      <Link
        href={`/admin/invoices/${row.id}`}
        prefetch={false}
        className="text-link"
      >
        {row.documentNumber}
      </Link>
      {leftCents <= 0 ? (
        <p>{s.nothingLeft}</p>
      ) : (
        <>
          <p>{s.intro}</p>
          <p>{s.left(formatEuro(leftCents))}</p>
          <p className="hint">{s.assumption}</p>
          <ActionForm
            action={issueCreditNote}
            submitLabel={s.submit}
            pendingLabel={s.submitting}
          >
            <input type="hidden" name="invoiceId" value={row.id} />
            <input
              type="hidden"
              name="expectedCreditedCents"
              value={credited}
            />
            <Field
              label={s.amount}
              name="amount"
              hint={s.amountHint}
              inputMode="decimal"
              defaultValue={plainAmount(leftCents)}
            />
            <TextAreaField label={s.reason} name="reason" defaultValue="" />
          </ActionForm>
        </>
      )}
    </div>
  );
}
