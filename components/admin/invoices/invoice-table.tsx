import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { RowCheckbox } from "@/components/admin/invoices/selection";
import type { IndexRow } from "@/lib/invoicing/data";
import { formatDate, formatEuro } from "@/lib/invoicing/format";

/** A table on a computer. Below 900 px the styles turn each row into a card. */
export async function InvoiceTable({
  rows,
  credited,
}: {
  rows: IndexRow[];
  credited: Map<string, number>;
}) {
  const { t } = await adminI18n();
  const s = t.invoices;
  const c = s.columns;

  return (
    <table className="inv-table">
      <thead>
        <tr>
          <th scope="col">{c.select}</th>
          <th scope="col">{c.number}</th>
          <th scope="col">{c.date}</th>
          <th scope="col">{c.customer}</th>
          <th scope="col">{c.booking}</th>
          <th scope="col" className="inv-number">
            {c.total}
          </th>
          <th scope="col">{c.status}</th>
          <th scope="col">{c.download}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const isCredit = row.docType === "credit_note";
          const amount = credited.get(row.id) ?? 0;
          return (
            <tr key={row.id} data-testid={`row-${row.documentNumber}`}>
              <td className="inv-cell-check">
                <RowCheckbox
                  number={row.documentNumber}
                  document={{
                    id: row.id,
                    signedCents: (isCredit ? -1 : 1) * row.totalCents,
                  }}
                />
              </td>
              <td className="inv-cell-title">
                <Link
                  href={`/admin/invoices/${row.id}`}
                  prefetch={false}
                  className="text-link"
                >
                  {row.documentNumber}
                </Link>
                <span className="hint">{s.docType[row.docType]}</span>
              </td>
              <td data-label={c.date}>{formatDate(row.issuedOn)}</td>
              <td data-label={c.customer}>{row.customerName || "-"}</td>
              <td data-label={c.booking}>{row.bookingReference || "-"}</td>
              <td data-label={c.total} className="inv-number">
                {formatEuro((isCredit ? -1 : 1) * row.totalCents)}
              </td>
              <td data-label={c.status}>
                <span className="inv-badges">
                  {!row.hasPdf && (
                    <span className="inv-badge inv-badge-bad">
                      {s.badge.pdfMissing}
                    </span>
                  )}
                  {row.isSent && (
                    <span className="inv-badge">{s.badge.sent}</span>
                  )}
                  {amount > 0 && (
                    <span className="inv-badge">
                      {amount >= row.totalCents
                        ? s.badge.credited
                        : s.badge.partCredited}
                    </span>
                  )}
                </span>
              </td>
              <td className="inv-cell-download">
                {row.hasPdf && (
                  // A real link, not next/link: it ends in a file.
                  <a
                    href={`/admin/invoices/${row.id}/pdf?download=1`}
                    className="text-link"
                    aria-label={`${s.downloadPdf} ${row.documentNumber}`}
                  >
                    {s.downloadPdf}
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
