import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/admin/form";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { regeneratePdf } from "@/lib/invoicing/actions";
import {
  loadIndex,
  loadLines,
  loadPayment,
  type IndexRow,
} from "@/lib/invoicing/data";
import {
  formatDate,
  formatEuro,
  formatPercent,
  issuedOn,
} from "@/lib/invoicing/format";
import { needsAccountantCheck, vatBreakdown } from "@/lib/invoicing/lines";

const s = t.invoices;
const d = s.detail;

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function DocumentLink({ row }: { row: IndexRow }) {
  return (
    <Link
      href={`/admin/invoices/${row.id}`}
      prefetch={false}
      className="text-link"
    >
      {row.documentNumber}
    </Link>
  );
}

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ pdf?: string; notice?: string }>;
}) {
  const admin = await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const { pdf, notice } = await searchParams;

  const rows = await loadIndex(admin);
  const row = rows.find((entry) => entry.id === id);
  if (!row) notFound();

  const lines = await loadLines(admin, id);
  const payment = row.paymentId
    ? await loadPayment(admin, row.paymentId)
    : null;
  const credits = rows.filter((entry) => entry.creditsInvoiceId === id);
  const original = rows.find((entry) => entry.id === row.creditsInvoiceId);
  const creditedCents = credits.reduce((sum, e) => sum + e.totalCents, 0);
  const leftCents = row.totalCents - creditedCents;
  const isCredit = row.docType === "credit_note";
  const pdfMissing = !row.hasPdf || pdf === "missing";

  return (
    <div className="stack">
      <h1>{row.documentNumber}</h1>
      <p>
        {s.docType[row.docType]}. {d.issued} {formatDate(row.issuedOn)}.
      </p>
      <Link href="/admin/invoices" prefetch={false} className="text-link">
        {s.backToList}
      </Link>

      {row.isProvisional && (
        <p className="notice notice-bad">{s.provisional}</p>
      )}

      {notice === "already_issued" && (
        <p className="notice notice-bad" role="alert">
          {d.alreadyIssued}
        </p>
      )}

      {pdf === "ready" && row.hasPdf && (
        <p className="notice notice-ok" role="status">
          {d.pdfMade}
        </p>
      )}

      {pdfMissing ? (
        <div className="stack" data-testid="pdf-missing">
          <p className="notice notice-bad">
            <strong>{s.badge.pdfMissing}. </strong>
            {d.pdfMissing}
          </p>
          <ActionForm
            action={regeneratePdf}
            submitLabel={d.regenerate}
            pendingLabel={d.regenerating}
          >
            <input type="hidden" name="invoiceId" value={row.id} />
          </ActionForm>
        </div>
      ) : (
        <div className="inv-actions">
          <a
            href={`/admin/invoices/${row.id}/pdf?download=1`}
            className="button"
          >
            {s.downloadPdf}
          </a>
          <a
            href={`/admin/invoices/${row.id}/pdf`}
            className="button button-quiet"
          >
            {d.openPdf}
          </a>
        </div>
      )}

      <p>
        {row.exportedAt
          ? d.sentOn(formatDate(issuedOn(row.exportedAt)))
          : d.notSent}
      </p>

      {original && (
        <section className="stack">
          <h2>{d.creditsHeading}</h2>
          <DocumentLink row={original} />
        </section>
      )}
      {row.reason && (
        <p>
          {d.reason}: {row.reason}
        </p>
      )}

      <section className="stack">
        <h2>{d.bookingHeading}</h2>
        {row.bookingReference ? (
          <>
            <p>{row.bookingReference}</p>
            {/* The booking screen does not exist yet (ADM-10): this shows its documents. */}
            <Link
              href={`/admin/invoices?booking=${encodeURIComponent(row.bookingReference)}`}
              prefetch={false}
              className="text-link"
            >
              {d.otherDocuments}
            </Link>
          </>
        ) : (
          <p>{d.noBooking}</p>
        )}
      </section>

      {payment && (
        <section className="stack">
          <h2>{d.paymentHeading}</h2>
          <dl className="facts">
            <Fact label={d.paymentKind} value={s.paymentKind[payment.kind]} />
            <Fact label={d.amount} value={formatEuro(payment.amountCents)} />
            <Fact label={d.method} value={s.method[payment.method]} />
            <Fact
              label={d.paidOn}
              value={payment.paidAt && formatDate(issuedOn(payment.paidAt))}
            />
            <Fact label={d.transaction} value={payment.stripePaymentIntentId} />
            <Fact label={d.note} value={payment.note} />
          </dl>
        </section>
      )}

      <section className="stack">
        <h2>{d.customerHeading}</h2>
        <dl className="facts">
          <Fact label={d.company} value={row.customer.companyName} />
          <Fact label={d.name} value={row.customer.name} />
          <Fact label={d.vatNumber} value={row.customer.vatNumber} />
          <Fact label={d.taxOffice} value={row.customer.taxOffice} />
          <Fact label={d.address} value={row.customer.address} />
          <Fact label={d.email} value={row.customer.email} />
          <Fact label={d.country} value={row.customer.country} />
        </dl>
      </section>

      <section className="stack">
        <h2>{d.issuerHeading}</h2>
        <dl className="facts">
          <Fact label={d.name} value={row.issuer.legalName} />
          <Fact label={d.vatNumber} value={row.issuer.vatNumber} />
          <Fact label={d.taxOffice} value={row.issuer.taxOffice} />
          <Fact label={d.address} value={row.issuer.address} />
          <Fact label={d.phone} value={row.issuer.phone} />
          <Fact label={d.email} value={row.issuer.email} />
        </dl>
      </section>

      <section className="stack">
        <h2>{d.linesHeading}</h2>
        <ul className="inv-lines">
          {lines.map((line, index) => (
            <li key={index}>
              <span>{line.description}</span>
              <span className="hint">
                {d.quantity}: {line.quantity}. {d.unit}:{" "}
                {formatEuro(line.unitCents)}. {d.vat}:{" "}
                {formatEuro(line.vatCents)}.
              </span>
              <strong>{formatEuro(line.totalCents)}</strong>
            </li>
          ))}
        </ul>
        {needsAccountantCheck(lines) && <p className="hint">{d.assumption}</p>}
      </section>

      <section className="stack">
        <h2>{d.vatHeading}</h2>
        <ul className="inv-lines">
          {vatBreakdown(lines).map((entry) => (
            <li key={entry.basisPoints}>
              <span>
                {d.vatRate}:{" "}
                {entry.basisPoints
                  ? formatPercent(entry.basisPoints)
                  : d.vatNone}
              </span>
              <span>
                {d.vatBase}: {formatEuro(entry.baseCents)}. {d.vat}:{" "}
                {formatEuro(entry.vatCents)}.
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="stack">
        <h2>{d.totalsHeading}</h2>
        <dl className="facts">
          <Fact label={d.net} value={formatEuro(row.netCents)} />
          <Fact label={d.vat} value={formatEuro(row.vatCents)} />
          <Fact label={d.fees} value={formatEuro(row.feeCents)} />
          <Fact label={d.total} value={formatEuro(row.totalCents)} />
        </dl>
      </section>

      {!isCredit && (
        <section className="stack">
          <h2>{d.creditHistory}</h2>
          {credits.length === 0 ? (
            <p>{d.noCredits}</p>
          ) : (
            <>
              <ul className="inv-names">
                {credits.map((credit) => (
                  <li key={credit.id}>
                    <DocumentLink row={credit} />{" "}
                    {formatEuro(credit.totalCents)}
                  </li>
                ))}
              </ul>
              <p>
                {d.creditedSoFar(
                  formatEuro(creditedCents),
                  formatEuro(leftCents),
                )}
              </p>
            </>
          )}
          {leftCents > 0 && (
            <Link
              href={`/admin/invoices/${row.id}/credit`}
              prefetch={false}
              className="button button-quiet"
            >
              {d.creditLink}
            </Link>
          )}
          <p className="hint">{d.immutable}</p>
        </section>
      )}
    </div>
  );
}
