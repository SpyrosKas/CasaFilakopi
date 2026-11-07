import Link from "next/link";
import { InvoiceFiltersForm } from "@/components/admin/invoices/filters";
import { InvoiceTable } from "@/components/admin/invoices/invoice-table";
import {
  SelectionBar,
  SelectionTools,
} from "@/components/admin/invoices/selection";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { loadIndex } from "@/lib/invoicing/data";
import {
  applyFilters,
  creditedAmounts,
  filtersToQuery,
  hasFilters,
  PAGE_SIZE,
  parseFilters,
  summarise,
} from "@/lib/invoicing/filters";
import { formatEuro } from "@/lib/invoicing/format";

const s = t.invoices;

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireOwner();
  const filters = parseFilters(await searchParams);

  const all = await loadIndex(admin);
  const matching = applyFilters(all, filters);
  const totals = summarise(matching);
  const credited = creditedAmounts(all);

  const pages = Math.max(Math.ceil(matching.length / PAGE_SIZE), 1);
  const page = Math.min(filters.page, pages);
  const rows = matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const query = filtersToQuery(filters);
  const pageLink = (target: number) =>
    `/admin/invoices${filtersToQuery(filters, target)}`;

  return (
    <div className="stack inv-wide">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <p className="notice notice-info">{s.provisional}</p>

      <div className="inv-actions">
        <Link href="/admin/invoices/issue" prefetch={false} className="button">
          {s.issueLink}
        </Link>
        <Link
          href="/admin/invoices/export"
          prefetch={false}
          className="button button-quiet"
        >
          {s.exportLink}
        </Link>
        <Link
          href="/admin/invoices/settings"
          prefetch={false}
          className="button button-quiet"
        >
          {s.settingsLink}
        </Link>
      </div>

      <InvoiceFiltersForm filters={filters} />

      <section aria-label={s.totals.heading}>
        <dl className="inv-totals" data-testid="totals">
          <div>
            <dt>{s.totals.count}</dt>
            <dd>{totals.count}</dd>
          </div>
          <div>
            <dt>{s.totals.billed}</dt>
            <dd>{formatEuro(totals.billedCents)}</dd>
          </div>
          <div>
            <dt>{s.totals.credited}</dt>
            <dd>{formatEuro(totals.creditedCents)}</dd>
          </div>
          <div>
            <dt>{s.totals.total}</dt>
            <dd>{formatEuro(totals.totalCents)}</dd>
          </div>
          <div>
            <dt>{s.totals.vat}</dt>
            <dd>{formatEuro(totals.vatCents)}</dd>
          </div>
          <div>
            <dt>{s.totals.fees}</dt>
            <dd>{formatEuro(totals.feeCents)}</dd>
          </div>
        </dl>
      </section>

      {rows.length === 0 ? (
        <p>{hasFilters(filters) ? s.empty : s.emptyAll}</p>
      ) : (
        <div className="inv-selection">
          <SelectionTools
            documents={rows.map((row) => ({
              id: row.id,
              signedCents:
                (row.docType === "credit_note" ? -1 : 1) * row.totalCents,
            }))}
            matchingCount={matching.length}
            query={query.slice(1)}
          />
          <InvoiceTable rows={rows} credited={credited} />
          {pages > 1 && (
            <nav className="inv-pages" aria-label={s.title}>
              {page > 1 ? (
                <Link
                  href={pageLink(page - 1)}
                  prefetch={false}
                  className="text-link"
                >
                  {s.pagination.previous}
                </Link>
              ) : (
                <span />
              )}
              <span>{s.pagination.page(page, pages)}</span>
              {page < pages ? (
                <Link
                  href={pageLink(page + 1)}
                  prefetch={false}
                  className="text-link"
                >
                  {s.pagination.next}
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      )}

      {/* Last on the page, so it stays in view from the top of the page down. */}
      <SelectionBar />
    </div>
  );
}
