import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { Badge, Empty, PageHead, Tabs } from "@/components/admin/ui";
import { requireAdmin } from "@/lib/admin/session";
import {
  countMessages,
  loadMessagePage,
  MESSAGES_PER_PAGE,
} from "@/lib/admin/stay-data";

const TABS = ["new", "replied", "archived"] as const;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string | string[];
    page?: string | string[];
  }>;
}) {
  const { t, formatStamp } = await adminI18n();
  const m = t.messages;

  const admin = await requireAdmin();
  const query = await searchParams;
  const tab = TABS.find((name) => name === query.tab) ?? "new";
  const asked = Number(query.page);
  const page = Number.isSafeInteger(asked) && asked > 1 ? asked : 1;

  const [{ rows, total }, ...counts] = await Promise.all([
    loadMessagePage(admin, tab, page),
    ...TABS.map((name) => countMessages(admin, name)),
  ]);
  const pages = Math.max(Math.ceil(total / MESSAGES_PER_PAGE), 1);
  const pageHref = (target: number) =>
    `/admin/messages?tab=${tab}&page=${target}`;

  return (
    <div className="stack">
      <PageHead title={m.title} intro={m.intro} />
      <Tabs
        items={TABS.map((name, index) => ({
          href: `/admin/messages?tab=${name}`,
          label: m.tabs[name],
          count: counts[index],
          active: name === tab,
        }))}
      />
      {rows.length === 0 ? (
        <Empty>{m.empty[tab]}</Empty>
      ) : (
        <section className="panel">
          <ul className="rows">
            {rows.map((row) => (
              <li key={row.id}>
                <Link
                  href={`/admin/messages/${row.id}`}
                  prefetch={false}
                  className="row"
                >
                  <span className="row-main">
                    <span className="row-title">{row.name}</span>
                    <span className="row-sub">
                      {formatStamp(row.created_at)}
                    </span>
                    <span>{row.message.slice(0, 100)}</span>
                  </span>
                  {!row.is_read && (
                    <span className="row-side">
                      <Badge tone="info">{m.unread}</Badge>
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {pages > 1 && (
        <nav className="button-row" aria-label={m.pageOf(page, pages)}>
          {page > 1 && (
            <Link
              href={pageHref(page - 1)}
              prefetch={false}
              className="button button-quiet"
            >
              {m.newer}
            </Link>
          )}
          {page < pages && (
            <Link
              href={pageHref(page + 1)}
              prefetch={false}
              className="button button-quiet"
            >
              {m.older}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
