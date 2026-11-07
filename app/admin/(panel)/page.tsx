import type { AdminStrings } from "@/lib/admin/strings";
import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import { ChannelAlertsPanel } from "@/components/admin/integrations/channel-alerts";
import {
  balanceText,
  Empty,
  PageHead,
  Panel,
  Stat,
  stayName,
  StayRow,
} from "@/components/admin/ui";
import { buildReport } from "@/lib/admin/reports";
import { requireAdmin } from "@/lib/admin/session";
import {
  countUnread,
  loadBlocks,
  loadCalendarAlerts,
  loadJobHealth,
  loadStayBook,
  toReportInput,
} from "@/lib/admin/stay-data";
import { dayPlan, type Stay } from "@/lib/admin/stays";
import { sumCents } from "@/lib/domain/money";
import { athensDate } from "@/lib/domain/dates";

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

const channelName = (t: AdminStrings, channel: string): string =>
  ({
    airbnb: t.stay.source.airbnb,
    booking_com: t.stay.source.booking_com,
    other_ical: t.stay.source.other,
  })[channel] ?? channel;

/** The answer to "what do I need to do today?". */
export default async function AdminHomePage() {
  const i18n = await adminI18n();
  const { t, formatDate, formatStay, formatEuro, formatTenths } = i18n;
  const h = t.home;
  const j = t.ops.jobs;

  const admin = await requireAdmin();
  const isOwner = admin.role === "owner";
  const now = new Date();
  const today = athensDate(now);

  const [book, blocks, unread, failures, jobs] = await Promise.all([
    loadStayBook(admin),
    loadBlocks(admin),
    countUnread(admin),
    loadCalendarAlerts(admin),
    isOwner ? loadJobHealth(admin) : null,
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
      <ChannelAlertsPanel withLink={isOwner} />

      {(conflicts.length > 0 || failures.length > 0) && (
        <section className="notice notice-bad" role="status">
          <h2>{h.syncAlerts}</h2>
          {failures.map((row) => (
            <p key={row.channel}>
              {h.syncFailed(
                channelName(t, row.channel),
                row.consecutive_failures,
              )}
            </p>
          ))}
          {conflicts.slice(0, MAX_LISTED).map((stay) => (
            <p key={stay.id}>
              <Link href={stay.href} prefetch={false} className="alert-link">
                {h.conflict(
                  stayName(stay, i18n),
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

      {jobs &&
        (jobs.failed.length > 0 ||
          jobs.stale.length > 0 ||
          jobs.siteSilent) && (
          <section
            className="notice notice-bad"
            role="status"
            data-testid="job-health"
          >
            <h2>{j.title}</h2>
            {jobs.failed.map(({ job, at }) => (
              <p key={job}>
                {j.failed(j.labels[job], formatDate(at.slice(0, 10)))}
              </p>
            ))}
            {jobs.stale.map((job) => (
              <p key={job}>{j.stale(j.labels[job])}</p>
            ))}
            {jobs.siteSilent && <p>{j.siteSilent}</p>}
          </section>
        )}

      {plan.moneyHeld.length > 0 && (
        <section className="panel" data-testid="money-held">
          <h2>{h.moneyHeld}</h2>
          <p className="notice notice-bad">{h.moneyHeldHint}</p>
          <ul className="rows">
            {plan.moneyHeld.slice(0, MAX_LISTED).map((stay) => (
              <StayRow
                key={stay.id}
                stay={stay}
                side={formatEuro(stay.money.paidCents)}
              />
            ))}
          </ul>
          {plan.moneyHeld.length > MAX_LISTED && (
            <p className="muted small">
              {h.andMore(plan.moneyHeld.length - MAX_LISTED)}
            </p>
          )}
        </section>
      )}

      {plan.toGiveBack.length > 0 && (
        <Panel title={h.giveBack}>
          <div data-testid="give-back">
            <StayList
              stays={plan.toGiveBack.slice(0, MAX_LISTED)}
              empty=""
              side={(stay) => formatEuro(stay.toRefundCents)}
            />
          </div>
          {plan.toGiveBack.length > MAX_LISTED && (
            <p className="muted small">
              {h.andMore(plan.toGiveBack.length - MAX_LISTED)}
            </p>
          )}
        </Panel>
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
            side={(stay) => balanceText(stay, i18n)}
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
