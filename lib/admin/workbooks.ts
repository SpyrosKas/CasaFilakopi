import type { Report } from "@/lib/admin/reports";
import {
  monthlyReports,
  buildReport,
  type ReportInput,
} from "@/lib/admin/reports";
import type { Stay } from "@/lib/admin/stays";
import { t } from "@/lib/admin/strings";
import { buildXlsx, type Cell, type Sheet } from "@/lib/invoicing/xlsx";

// The two Excel files (D21). Real numbers and dates, and text that is stored
// as text, so a guest called "=1+1" stays exactly that.

const text = (value: string | null | undefined): Cell =>
  value ? { kind: "text", value } : { kind: "empty" };
const euro = (cents: number | null): Cell =>
  cents === null ? { kind: "empty" } : { kind: "euro", cents };
const count = (value: number | null): Cell =>
  value === null ? { kind: "empty" } : { kind: "count", value };
const date = (value: string): Cell => ({ kind: "date", value });
const header = (titles: string[]): Cell[] =>
  titles.map((value) => ({ kind: "text", value, style: "header" }));

export function bookingsWorkbook(stays: Stay[]): Uint8Array {
  const c = t.bookings.exported;
  const columns: { title: string; width: number }[] = [
    { title: c.reference, width: 20 },
    { title: c.status, width: 20 },
    { title: c.source, width: 16 },
    { title: c.guest, width: 26 },
    { title: c.email, width: 30 },
    { title: c.phone, width: 20 },
    { title: c.checkIn, width: 12 },
    { title: c.checkOut, width: 12 },
    { title: c.nights, width: 8 },
    { title: c.adults, width: 8 },
    { title: c.children, width: 9 },
    { title: c.total, width: 14 },
    { title: c.received, width: 14 },
    { title: c.refunded, width: 14 },
    { title: c.paid, width: 14 },
    { title: c.balance, width: 14 },
    { title: c.entered, width: 14 },
    { title: c.payment, width: 16 },
  ];

  const rows = stays.map((stay): Cell[] => {
    const own = stay.kind === "booking";
    return [
      text(stay.reference),
      text(t.stay.status[stay.status]),
      text(t.stay.source[stay.source]),
      text(stay.name ?? stay.summary),
      text(stay.email),
      text(stay.phone),
      date(stay.checkIn),
      date(stay.checkOut),
      count(stay.nights),
      count(stay.adults),
      count(stay.children),
      euro(stay.totalCents),
      euro(own ? stay.money.receivedCents : null),
      euro(own ? stay.money.refundedCents : null),
      euro(own ? stay.money.paidCents : null),
      euro(own ? stay.balanceCents : null),
      euro(stay.enteredCents),
      text(t.stay.money[stay.moneyState]),
    ];
  });

  return buildXlsx([
    {
      name: t.bookings.title,
      widths: columns.map((column) => column.width),
      freezeHeader: true,
      headerHeight: 32,
      rows: [header(columns.map((column) => column.title)), ...rows],
    },
  ]);
}

function reportCells(label: string, report: Report): Cell[] {
  const { money, bookings, nights, noAmount } = report;
  return [
    text(label),
    euro(money.paymentsCents),
    euro(money.refundsCents),
    euro(money.receivedCents),
    euro(money.enteredCents),
    euro(money.incomeCents),
    euro(money.bookedCents),
    euro(money.expectedCents),
    euro(money.owedCents),
    count(bookings.made),
    count(bookings.had),
    count(bookings.expected),
    count(bookings.cancelled),
    count(bookings.noShows),
    count(nights.booked),
    count(nights.available),
    nights.occupancyTenths === null
      ? { kind: "empty" }
      : text(`${(nights.occupancyTenths / 10).toFixed(1)}%`),
    euro(nights.averageNightCents),
    count(noAmount.stays),
  ];
}

export function reportWorkbook(input: ReportInput, year: number): Uint8Array {
  const c = t.reports.sheet;
  const titles = [
    c.month,
    c.payments,
    c.refunds,
    c.received,
    c.entered,
    c.income,
    c.booked,
    c.expected,
    c.owed,
    c.made,
    c.had,
    c.expectedCount,
    c.cancelled,
    c.noShows,
    c.nights,
    c.available,
    c.occupancy,
    c.average,
    c.noAmount,
  ];
  const sheet: Sheet = {
    name: String(year),
    widths: titles.map((_, index) => (index === 0 ? 12 : 14)),
    freezeHeader: true,
    headerHeight: 48,
    rows: [
      header(titles),
      ...monthlyReports(input, year).map(({ key, report }) =>
        reportCells(key, report),
      ),
      reportCells(c.wholeYear, buildReport(input, { year, month: null })),
    ],
  };
  return buildXlsx([sheet]);
}

export const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
