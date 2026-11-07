import type { AdminI18n } from "@/lib/admin/i18n";
import { adminI18n } from "@/lib/admin/i18n-server";
import Link from "next/link";
import {
  Empty,
  MoneyLines,
  PageHead,
  Panel,
  Stat,
  Tabs,
} from "@/components/admin/ui";
import {
  buildReport,
  monthlyReports,
  yearsWithData,
  type SourceLine,
} from "@/lib/admin/reports";
import { requireOwner } from "@/lib/admin/session";
import { loadBlocks, loadStayBook, toReportInput } from "@/lib/admin/stay-data";
import { NO_AMOUNT, type BookingSource } from "@/lib/admin/stays";
import { addDays, athensDate } from "@/lib/domain/dates";

const IMPORTED: BookingSource[] = ["airbnb", "booking_com", "other"];

const dash = "-";

/** Each figure shows when it is not zero, and the cards add up to Income. */
function sourceLines(line: SourceLine, { t, formatEuro }: AdminI18n) {
  const r = t.reports;
  const shown = [
    {
      label: r.sourceBookings,
      value: String(line.bookings),
      on: line.bookings,
    },
    { label: r.sourceNights, value: String(line.nights), on: line.nights },
    {
      label: r.sourceBooked,
      value: formatEuro(line.bookedCents ?? 0),
      on: line.bookedCents ?? 0,
    },
    {
      label: r.sourceReceived,
      value: formatEuro(line.receivedCents),
      on: line.receivedCents,
    },
    {
      label: r.sourceEntered,
      value: formatEuro(line.enteredCents),
      on: line.enteredCents,
    },
    {
      label: r.noAmountFilter,
      value: String(line.noAmount),
      on: line.noAmount,
    },
  ];
  return shown
    .filter((row) => row.on !== 0)
    .map(({ label, value }) => ({ label, value }));
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; month?: string }>;
}) {
  const i18n = await adminI18n();
  const { t, formatEuro, formatMonth, formatTenths } = i18n;
  const r = t.reports;

  const admin = await requireOwner();
  const now = new Date();
  const today = athensDate(now);
  const query = await searchParams;

  const [book, blocks] = await Promise.all([
    loadStayBook(admin),
    loadBlocks(admin),
  ]);
  const input = toReportInput(book, blocks, now);

  const thisYear = Number(today.slice(0, 4));
  const years = yearsWithData(input, thisYear);
  const askedYear = Number(query.year);
  const year = years.includes(askedYear) ? askedYear : thisYear;
  const askedMonth = Number(query.month);
  const month =
    query.month === "all"
      ? null
      : Number.isInteger(askedMonth) && askedMonth >= 1 && askedMonth <= 12
        ? askedMonth
        : year === thisYear
          ? Number(today.slice(5, 7))
          : null;

  const report = buildReport(input, { year, month });
  const bars = monthlyReports(input, year);
  const highest = Math.max(
    ...bars.map((bar) => bar.report.money.incomeCents),
    1,
  );
  const { money, bookings, nights } = report;

  const enteredLines = report.bySource
    .filter((line) => IMPORTED.includes(line.source) && line.enteredCents > 0)
    .map((line) => ({
      label: r.entered(t.stay.source[line.source]),
      value: formatEuro(line.enteredCents),
      note: r.enteredNote,
    }));

  return (
    <div className="stack">
      <PageHead title={r.title} intro={r.intro} />

      <Tabs
        items={years.map((option) => ({
          href: `/admin/reports?year=${option}&month=${option === thisYear ? Number(today.slice(5, 7)) : "all"}`,
          label: String(option),
          active: option === year,
        }))}
      />
      <Tabs
        items={[
          {
            href: `/admin/reports?year=${year}&month=all`,
            label: r.wholeYear,
            active: month === null,
          },
          ...r.months.map((name, index) => ({
            href: `/admin/reports?year=${year}&month=${index + 1}`,
            label: name,
            active: month === index + 1,
          })),
        ]}
      />

      <h2>{month === null ? year : formatMonth(report.from.slice(0, 7))}</h2>

      {report.noAmount.stays > 0 && (
        <p className="notice notice-warn" data-testid="no-amount">
          {r.noAmount(report.noAmount.stays, report.noAmount.nights)}{" "}
          <Link
            href={`/admin/bookings?${new URLSearchParams({
              tab: report.noAmount.tab,
              money: NO_AMOUNT,
              from: report.from,
              to: addDays(report.to, -1),
            })}`}
            prefetch={false}
            className="text-link"
          >
            {r.noAmountLink}
          </Link>
        </p>
      )}

      <div className="columns">
        <Panel title={r.incomeHeading}>
          <div data-testid="income">
            <MoneyLines
              lines={[
                { label: r.payments, value: formatEuro(money.paymentsCents) },
                { label: r.refunds, value: formatEuro(-money.refundsCents) },
                {
                  label: r.received,
                  value: formatEuro(money.receivedCents),
                  note: r.receivedNote,
                  strong: true,
                },
                ...enteredLines,
                {
                  label: r.income,
                  value: formatEuro(money.incomeCents),
                  strong: true,
                },
                ...(money.disputedCents > 0
                  ? [
                      {
                        label: r.disputed,
                        value: formatEuro(money.disputedCents),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </Panel>

        <Panel title={r.expectedHeading}>
          <p className="muted small">{r.expectedIntro}</p>
          <div data-testid="expected">
            <MoneyLines
              lines={[
                {
                  label: r.booked,
                  value: formatEuro(money.bookedCents),
                  note: r.bookedNote,
                },
                {
                  label: r.expected,
                  value: formatEuro(money.expectedCents),
                  note: r.expectedNote,
                },
                {
                  label: r.owed,
                  value: formatEuro(money.owedCents),
                  note: r.owedNote,
                },
                ...(money.toRefundCents > 0
                  ? [
                      {
                        label: r.toRefund,
                        value: formatEuro(money.toRefundCents),
                      },
                    ]
                  : []),
              ]}
            />
          </div>
        </Panel>
      </div>

      <h2>{r.bookingsHeading}</h2>
      <div className="stats" data-testid="booking-counts">
        <Stat label={r.made} value={String(bookings.made)} hint={r.madeHint} />
        <Stat label={r.had} value={String(bookings.had)} hint={r.hadHint} />
        <Stat
          label={r.expectedCount}
          value={String(bookings.expected)}
          hint={r.expectedCountHint}
        />
        <Stat
          label={r.cancelled}
          value={String(bookings.cancelled)}
          hint={r.cancelledHint}
        />
        <Stat label={r.noShows} value={String(bookings.noShows)} />
      </div>

      <h2>{r.nightsHeading}</h2>
      <div className="stats" data-testid="night-figures">
        <Stat label={r.nightsBooked} value={String(nights.booked)} />
        <Stat
          label={r.occupancy}
          value={
            nights.occupancyTenths === null
              ? dash
              : `${formatTenths(nights.occupancyTenths)}%`
          }
          hint={r.occupancyHint(nights.available)}
        />
        <Stat
          label={r.averageNight}
          value={
            nights.averageNightCents === null
              ? dash
              : formatEuro(nights.averageNightCents)
          }
          hint={r.averageNightHint(nights.pricedNights)}
        />
        <Stat
          label={r.averageStay}
          value={
            nights.averageStayTenths === null
              ? dash
              : r.averageStayValue(formatTenths(nights.averageStayTenths))
          }
        />
      </div>

      <Panel title={r.sourceHeading}>
        {report.bySource.length === 0 ? (
          <Empty>{r.sourceEmpty}</Empty>
        ) : (
          <div className="source-grid" data-testid="by-source">
            {report.bySource.map((line) => (
              <section key={line.source} className="source-card">
                <h3>{t.stay.source[line.source]}</h3>
                <MoneyLines lines={sourceLines(line, i18n)} />
              </section>
            ))}
          </div>
        )}
      </Panel>

      <Panel title={r.chartHeading}>
        <ul className="bars" aria-label={r.chartHeading}>
          {bars.map((bar) => {
            const income = bar.report.money.incomeCents;
            const label = r.chartLabel(
              r.months[bar.month - 1],
              formatEuro(income),
            );
            return (
              <li
                key={bar.key}
                className="bar"
                title={label}
                aria-label={label}
              >
                <span
                  className="bar-fill"
                  style={{
                    height: `${(Math.max(income, 0) / highest) * 100}%`,
                  }}
                />
              </li>
            );
          })}
        </ul>
        <div className="bar-labels" aria-hidden="true">
          {r.months.map((name) => (
            <span key={name}>{name.slice(0, 1)}</span>
          ))}
        </div>
        <p className="muted small">{r.chartNote}</p>
      </Panel>

      <Link
        href={`/admin/reports/export?year=${year}`}
        prefetch={false}
        download
        className="button button-quiet"
      >
        {r.export}
      </Link>
    </div>
  );
}
