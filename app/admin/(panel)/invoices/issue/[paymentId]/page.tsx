import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { IssueForm } from "@/components/admin/invoices/issue-form";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import {
  loadIndex,
  loadInvoicingSetup,
  loadIssuablePayment,
} from "@/lib/invoicing/data";
import { cannotPrint } from "@/lib/invoicing/fonts";
import { formatEuro } from "@/lib/invoicing/format";
import { buildPaymentLines } from "@/lib/invoicing/lines";

const s = t.invoices.issue;

export default async function IssuePage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const admin = await requireOwner();
  const { paymentId } = await params;
  if (!z.uuid().safeParse(paymentId).success) notFound();

  // One document per payment: an old link goes to the one that exists.
  const existing = (await loadIndex(admin)).find(
    (row) => row.paymentId === paymentId,
  );
  if (existing) redirect(`/admin/invoices/${existing.id}`);

  const payment = await loadIssuablePayment(admin, paymentId);
  if (!payment) notFound();

  const { settings } = await loadInvoicingSetup(admin);
  const built = buildPaymentLines({
    reference: payment.reference,
    breakdown: payment.breakdown,
    payment: {
      kind: payment.kind,
      amountCents: payment.amountCents,
      isRetained: payment.isRetained,
    },
  });

  return (
    <div className="stack">
      <h1>{s.formTitle(payment.reference || "-")}</h1>
      <Link href="/admin/invoices/issue" prefetch={false} className="text-link">
        {s.title}
      </Link>

      {!built.ok ? (
        <p className="notice notice-bad" role="alert">
          {t.invoices.errors.priceUnreadable}
        </p>
      ) : (
        <>
          <section className="preview">
            <h2>{s.previewHeading}</h2>
            <p>
              {s.guest}: {payment.guestName || "-"}
            </p>
            <ul className="inv-lines">
              {built.lines.map((line, index) => (
                <li key={index}>
                  <span>{line.description}</span>
                  <strong>{formatEuro(line.totalCents)}</strong>
                </li>
              ))}
            </ul>
            {built.needsConfirmation && <p className="hint">{s.assumption}</p>}
            {payment.isRetained && <p className="hint">{s.retained}</p>}
          </section>

          <IssueForm
            paymentId={payment.paymentId}
            defaultType={settings.defaultDocType}
            unprintable={cannotPrint(payment.guestName)}
          />
        </>
      )}
    </div>
  );
}
