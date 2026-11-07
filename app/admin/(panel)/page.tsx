import Link from "next/link";
import {
  balanceText,
  Empty,
  PageHead,
  Panel,
  Stat,
  stayName,
  StayRow,
} from "@/components/admin/ui";
import {
  formatDate,
  formatEuro,
  formatStay,
  formatTenths,
} from "@/lib/admin/format";
import { buildReport } from "@/lib/admin/reports";
import { requireAdmin } from "@/lib/admin/session";
import {
  countUnread,
  loadBlocks,
  loadCalendarAlerts,
  loadStayBook,
  toReportInput,
} from "@/lib/admin/stay-data";
import { dayPlan, type Stay } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";
import { sumCents } from "@/lib/domain/money";
import { athensDate } from "@/lib/domain/dates";

const h = t.home;

/** Home answers today's questions. The full lists are one tap away. */
const MAX_LISTED = 5;

function StayList({
  stays,
  empty,
  side,
}: {
  stays: Stay[];
  empty: string;
  side?: (stay: Stay) => string | undefined;
}) {
  if (stays.length === 0) return <p className="muted">{empty}</p>;
  return (
    <ul className="rows">
      {stays.map((stay) => (
        <StayRow key={stay.id} stay={stay} side={side?.(stay)} />
      ))}
    </ul>
  );
}

const CHANNEL_NAME: Record<string, string> = {
  airbnb: t.stay.source.airbnb,
  booking_com: t.stay.source.booking_com,
  other_ical: t.stay.source.other,
};

/** The answer to "what do I need to do today?". */
export default async function AdminHomePage() {
  const admin = await requireAdmin();
  const isOwner = admin.role === "owner";
  const now = new Date();
  const today = athensDate(now);

  const [book, blocks, unread, failures] = await Promise.all([
    loadStayBook(admin),
    loadBlocks(admin),
    countUnread(admin),
    loadCalendarAlerts(admin),
  ]);

  const plan = dayPlan(book.stays, today);
  const { nights, money } = buildReport(toReportInput(book, blocks, now), {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
  });
  const conflicts = book.stays
    .filter((stay) => stay.isConflicted && stay.checkOut >= today)
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const owed = sumCents(plan.balances.map((stay) => stay.balanceCents));

  return (
    <div className="stack">
      <PageHead
        title={h.title(admin.displayName)}
        intro={h.today(formatDate(today))}
      />

      {(conflicts.length > 0 || failures.length > 0) && (
        <section className="notice notice-bad" role="status">
          <h2>{h.syncAlerts}</h2>
          {failures.map((row) => (
            <p key={row.channel}>
              {h.syncFailed(
                CHANNEL_NAME[row.channel],
                row.consecutive_failures,
              )}
            </p>
          ))}
          {conflicts.slice(0, MAX_LISTED).map((stay) => (
            <p key={stay.id}>
              <Link href={stay.href} prefetch={false} className="alert-link">
                {h.conflict(
                  stayName(stay),
                  formatStay(stay.checkIn, stay.checkOut),
                )}
              </Link>
            </p>
          ))}
          {conflicts.length > MAX_LISTED && (
            <p>{h.andMore(conflicts.length - MAX_LISTED)}</p>
          )}
        </section>
      )}

      <div className="stats">
        <Stat
          label={h.messages}
          value={String(unread)}
          href="/admin/messages"
        />
        <Stat
          label={h.occupancy}
          value={
            nights.occupancyTenths === null
              ? "-"
              : `${formatTenths(nights.occupancyTenths)}%`
          }
          hint={h.occupancyHint(nights.booked, nights.available)}
          href="/admin/calendar"
        />
        <Stat
          label={h.balances}
          value={formatEuro(owed)}
          href="/admin/bookings"
        />
        {isOwner && (
          <Stat
            label={h.income}
            value={formatEuro(money.incomeCents)}
            hint={h.incomeHint}
            href="/admin/reports"
          />
        )}
      </div>

      <div className="columns">
        <Panel title={h.arrivals}>
          <StayList stays={plan.arrivals} empty={h.arrivalsEmpty} />
        </Panel>
        <Panel title={h.departures}>
          <StayList stays={plan.departures} empty={h.departuresEmpty} />
        </Panel>
        <Panel title={h.inHouse}>
          <StayList stays={plan.inHouse} empty={h.inHouseEmpty} />
        </Panel>
        <Panel
          title={h.next}
          link={{ href: "/admin/bookings", label: h.allBookings }}
        >
          <StayList stays={plan.next} empty={h.nextEmpty} />
        </Panel>
      </div>

      <Panel
        title={h.balances}
        link={
          plan.balances.length > MAX_LISTED
            ? { href: "/admin/bookings", label: h.allBookings }
            : undefined
        }
      >
        {plan.balances.length === 0 ? (
          <Empty>{h.balancesEmpty}</Empty>
        ) : (
          <StayList
            stays={plan.balances.slice(0, MAX_LISTED)}
            empty=""
            side={balanceText}
          />
        )}
      </Panel>

      <div className="button-row">
        <Link href="/admin/bookings/new" prefetch={false} className="button">
          {h.addManual}
        </Link>
        {isOwner && (
          <Link
            href="/admin/invoices"
            prefetch={false}
            className="button button-quiet"
          >
            {h.invoices}
          </Link>
        )}
      </div>
    </div>
  );
}
