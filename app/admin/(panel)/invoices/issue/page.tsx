import Link from "next/link";
import { z } from "zod";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { loadIssuablePayments } from "@/lib/invoicing/data";
import { foldText, PAGE_SIZE } from "@/lib/invoicing/filters";
import { formatDate, formatEuro } from "@/lib/invoicing/format";

const s = t.invoices.issue;

const paramsSchema = z.object({
  q: z.string().trim().max(100).catch("").default(""),
  page: z.coerce.number().int().min(1).catch(1).default(1),
});

export default async function IssueListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireOwner();
  const { q, page } = paramsSchema.parse(await searchParams);

  const wanted = foldText(q);
  const payments = (await loadIssuablePayments(admin)).filter((payment) =>
    foldText(`${payment.reference} ${payment.guestName}`).includes(wanted),
  );
  const pages = Math.max(Math.ceil(payments.length / PAGE_SIZE), 1);
  const current = Math.min(page, pages);
  const shown = payments.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const pageLink = (target: number) =>
    `/admin/invoices/issue?${new URLSearchParams({ q, page: String(target) })}`;

  return (
    <div className="stack">
      <h1>{s.title}</h1>
      <p>{s.intro}</p>
      <Link href="/admin/invoices" prefetch={false} className="text-link">
        {t.invoices.backToList}
      </Link>

      <form method="get" action="/admin/invoices/issue" className="stack">
        <div className="field">
          <label htmlFor="issue-search">{s.searchLabel}</label>
          <input id="issue-search" name="q" defaultValue={q} />
        </div>
        <button type="submit" className="button button-quiet">
          {s.search}
        </button>
      </form>

      {shown.length === 0 ? (
        <p>{s.empty}</p>
      ) : (
        <ul className="link-list">
          {shown.map((payment) => (
            <li key={payment.paymentId}>
              <Link
                href={`/admin/invoices/issue/${payment.paymentId}`}
                prefetch={false}
                aria-label={`${s.choose} ${payment.reference} ${formatEuro(payment.amountCents)}`}
              >
                <span>
                  {payment.reference || "-"}, {payment.guestName || "-"}
                  <span className="hint choice-hint">
                    {t.invoices.paymentKind[payment.kind]},{" "}
                    {formatEuro(payment.amountCents)}. {s.stay}:{" "}
                    {formatDate(payment.checkIn)} to{" "}
                    {formatDate(payment.checkOut)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="inv-pages" aria-label={s.title}>
          {current > 1 ? (
            <Link
              href={pageLink(current - 1)}
              prefetch={false}
              className="text-link"
            >
              {t.invoices.pagination.previous}
            </Link>
          ) : (
            <span />
          )}
          <span>{t.invoices.pagination.page(current, pages)}</span>
          {current < pages ? (
            <Link
              href={pageLink(current + 1)}
              prefetch={false}
              className="text-link"
            >
              {t.invoices.pagination.next}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
