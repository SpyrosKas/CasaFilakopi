import Link from "next/link";
import { Badge, Empty, PageHead, Tabs } from "@/components/admin/ui";
import { formatStamp } from "@/lib/admin/format";
import { requireAdmin } from "@/lib/admin/session";
import { loadMessages } from "@/lib/admin/stay-data";
import { t } from "@/lib/admin/strings";

const m = t.messages;
const TABS = ["new", "replied", "archived"] as const;

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const admin = await requireAdmin();
  const asked = (await searchParams).tab;
  const tab = TABS.find((name) => name === asked) ?? "new";

  const all = await loadMessages(admin);
  const rows = all.filter((row) => row.status === tab);

  return (
    <div className="stack">
      <PageHead title={m.title} intro={m.intro} />
      <Tabs
        items={TABS.map((name) => ({
          href: `/admin/messages?tab=${name}`,
          label: m.tabs[name],
          count: all.filter((row) => row.status === name).length,
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
    </div>
  );
}
