import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { AvailabilityCalendar } from "@/components/admin/calendars";
import { Empty, PageHead, Panel } from "@/components/admin/ui";
import { buildMonth, isMonthKey, type NightKind } from "@/lib/admin/calendar";
import { requireAdmin } from "@/lib/admin/session";
import { loadBlocks, loadStayBook } from "@/lib/admin/stay-data";
import { athensDate, isValidIsoDate } from "@/lib/domain/dates";

const LEGEND: NightKind[] = [
  "free",
  "direct",
  "airbnb",
  "booking_com",
  "other",
  "hold",
  "block",
];

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    month?: string | string[];
    from?: string | string[];
  }>;
}) {
  const { t, formatStay } = await adminI18n();
  const c = t.calendar;

  const admin = await requireAdmin();
  const today = athensDate(new Date());
  const query = await searchParams;
  const month = isMonthKey(query.month) ? query.month : today.slice(0, 7);

  const [{ stays }, blocks] = await Promise.all([
    loadStayBook(admin),
    loadBlocks(admin),
  ]);
  const { nights, entries } = buildMonth(month, stays, blocks, {
    reasons: c.reasons,
    noName: t.stay.noName,
    hold: c.legend.hold,
  });
  const blockInfo = blocks.map((block) => ({
    ...block,
    title: entries.find((row) => row.key === block.id)?.title ?? "",
  }));

  return (
    <div className="stack">
      <PageHead title={c.title} intro={c.intro} />

      <AvailabilityCalendar
        key={`${month}-${isValidIsoDate(query.from) ? query.from : ""}`}
        month={month}
        nights={nights}
        today={today}
        blocks={blockInfo}
        firstNight={isValidIsoDate(query.from) ? query.from : null}
      />

      <ul className="legend">
        {LEGEND.map((kind) => (
          <li key={kind}>
            <span className={`legend-swatch night-${kind}`} />
            {c.legend[kind]}
          </li>
        ))}
      </ul>
      <p className="muted small">{c.nightNote}</p>

      <Panel title={c.thisMonth}>
        {entries.length === 0 ? (
          <Empty>{c.monthEmpty}</Empty>
        ) : (
          <ul className="rows">
            {entries.map((entry) => {
              const body = (
                <span className="row-main">
                  <span className="row-title">{entry.title}</span>
                  <span className="row-sub">
                    {c.legend[entry.kind]}, {formatStay(entry.start, entry.end)}
                  </span>
                </span>
              );
              return (
                <li key={entry.key}>
                  {entry.href ? (
                    <Link href={entry.href} prefetch={false} className="row">
                      {body}
                    </Link>
                  ) : (
                    <div className="row">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
