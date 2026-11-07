import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { MarkSentForm } from "@/components/admin/invoices/mark-sent-form";
import { requireOwner } from "@/lib/admin/session";
import { loadIndex } from "@/lib/invoicing/data";
import { reviewOf } from "@/lib/invoicing/export";
import { applyFilters, filtersSchema } from "@/lib/invoicing/filters";
import { formatEuro, previousMonth } from "@/lib/invoicing/format";

export default async function ExportPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { t } = await adminI18n();
  const s = t.invoices.export;
  const n = t.invoices.selection;

  const admin = await requireOwner();
  const { month: asked } = await searchParams;
  const month =
    filtersSchema.parse({ month: asked }).month ?? previousMonth(new Date());

  const rows = applyFilters(
    await loadIndex(admin),
    filtersSchema.parse({ month }),
  );
  const review = reviewOf(rows);

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/invoices" prefetch={false} className="text-link">
        {t.invoices.backToList}
      </Link>

      <form method="get" action="/admin/invoices/export" className="stack">
        <div className="field">
          <label htmlFor="export-month">{s.month}</label>
          <input
            id="export-month"
            name="month"
            type="month"
            defaultValue={month}
          />
        </div>
        <button type="submit" className="button button-quiet">
          {s.show}
        </button>
      </form>

      {rows.length === 0 ? (
        <p>{s.none}</p>
      ) : (
        <>
          <p>
            {s.summary(review.count)} {n.total}: {formatEuro(review.totalCents)}
          </p>

          {review.missingPdf.length > 0 && (
            <div className="notice notice-bad" role="alert">
              <p>
                <strong>{n.missingHeading}</strong>
              </p>
              <ul className="inv-names">
                {review.missingPdf.map((document) => (
                  <li key={document.id}>
                    <Link
                      href={`/admin/invoices/${document.id}`}
                      prefetch={false}
                      className="text-link"
                    >
                      {document.documentNumber}
                    </Link>
                  </li>
                ))}
              </ul>
              <p>{n.missingNote}</p>
            </div>
          )}
          {review.alreadySent.length > 0 && (
            <div className="notice notice-info" role="status">
              <p>
                <strong>{n.sentHeading}</strong>
              </p>
              <ul className="inv-names">
                {review.alreadySent.map((document) => (
                  <li key={document.id}>
                    {n.sentOn(document.documentNumber, document.sentOn)}
                  </li>
                ))}
              </ul>
              <p>{n.sentNote}</p>
            </div>
          )}

          <section className="stack">
            {/* A plain link, not next/link: it ends in a file. */}
            <a
              href={`/admin/invoices/export/download?month=${month}`}
              className="button"
            >
              {s.download}
            </a>
            <p className="hint">{s.downloadHint}</p>
            <p className="hint">{s.pickSome}</p>
            {/* T5.8: sending by email goes here once Resend is set up (A5). */}
            <p className="hint">{s.emailLater}</p>
          </section>

          <section className="stack">
            <h2>{n.markHeading}</h2>
            <p>{n.markIntro}</p>
            <MarkSentForm ids={rows.map((row) => row.id)} />
          </section>
        </>
      )}
    </div>
  );
}
