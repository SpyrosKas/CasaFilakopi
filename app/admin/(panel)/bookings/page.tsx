import Link from "next/link";
import { Field, SelectField } from "@/components/admin/form";
import {
  balanceText,
  Empty,
  PageHead,
  StayRow,
  Tabs,
} from "@/components/admin/ui";
import { bookingListSchema } from "@/lib/admin/ops-schemas";
import { requireAdmin } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import {
  filterStays,
  matchesFilters,
  STAY_TABS,
  tabOf,
  type StayFilters,
} from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";
import { athensDate } from "@/lib/domain/dates";

const b = t.bookings;

const asOptions = (labels: Record<string, string>) => [
  { value: "", label: b.any },
  ...Object.entries(labels).map(([value, label]) => ({ value, label })),
];

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) || null;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const parsed = bookingListSchema.parse({
    tab: first(query.tab),
    q: first(query.q) ?? "",
    from: first(query.from),
    to: first(query.to),
    status: first(query.status),
    source: first(query.source),
    money: first(query.money),
  });
  const filters: StayFilters = { ...parsed, search: parsed.q };

  const today = athensDate(new Date());
  const { stays } = await loadStayBook(admin);
  const rows = filterStays(stays, filters, today);
  const filtered = stays.filter((stay) => matchesFilters(stay, filters));

  const extraFilters = [
    filters.from,
    filters.to,
    filters.status,
    filters.source,
    filters.money,
  ].some(Boolean);
  const hasFilters = extraFilters || filters.search !== "";

  const tabHref = (tab: string) => {
    const params = new URLSearchParams({ tab });
    if (filters.search) params.set("q", filters.search);
    for (const key of ["from", "to", "status", "source", "money"] as const) {
      const value = filters[key];
      if (value) params.set(key, value);
    }
    return `/admin/bookings?${params}`;
  };

  return (
    <div className="stack">
      <PageHead
        title={b.title}
        intro={b.intro}
        action={
          <Link href="/admin/bookings/new" prefetch={false} className="button">
            {b.add}
          </Link>
        }
      />

      <Tabs
        items={STAY_TABS.map((tab) => ({
          href: tabHref(tab),
          label: b.tabs[tab],
          count: filtered.filter((stay) => tabOf(stay, today) === tab).length,
          active: tab === filters.tab,
        }))}
      />

      <form action="/admin/bookings" className="stack">
        <input type="hidden" name="tab" value={filters.tab} />
        <Field
          label={b.search}
          name="q"
          type="search"
          defaultValue={filters.search}
        />
        <details className="filters" open={extraFilters}>
          <summary>{b.filters}</summary>
          <div className="filters-body">
            <div className="field-row">
              <Field
                label={b.filterFrom}
                name="from"
                type="date"
                defaultValue={filters.from ?? ""}
              />
              <Field
                label={b.filterTo}
                name="to"
                type="date"
                defaultValue={filters.to ?? ""}
              />
            </div>
            <SelectField
              label={b.filterStatus}
              name="status"
              defaultValue={filters.status ?? ""}
              options={asOptions(t.stay.status)}
            />
            <SelectField
              label={b.filterSource}
              name="source"
              defaultValue={filters.source ?? ""}
              options={asOptions(t.stay.source)}
            />
            <SelectField
              label={b.filterMoney}
              name="money"
              defaultValue={filters.money ?? ""}
              options={asOptions(t.stay.money)}
            />
          </div>
        </details>
        <div className="button-row">
          <button type="submit" className="button">
            {b.apply}
          </button>
          {hasFilters && (
            <Link
              href={`/admin/bookings?tab=${filters.tab}`}
              prefetch={false}
              className="button button-quiet"
            >
              {b.clear}
            </Link>
          )}
        </div>
      </form>

      {rows.length === 0 ? (
        <Empty>{hasFilters ? b.noMatch : b.empty[filters.tab]}</Empty>
      ) : (
        <section className="panel">
          <ul className="rows" data-testid="stay-list">
            {rows.map((stay) => (
              <StayRow key={stay.id} stay={stay} side={balanceText(stay)} />
            ))}
          </ul>
        </section>
      )}

      {admin.role === "owner" && (
        <Link
          href="/admin/bookings/export"
          prefetch={false}
          download
          className="button button-quiet"
        >
          {b.export}
        </Link>
      )}
    </div>
  );
}
