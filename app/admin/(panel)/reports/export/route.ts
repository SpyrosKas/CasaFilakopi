import { z } from "zod";
import { csvEuro, toCsv } from "@/lib/admin/csv";
import { monthlyReports } from "@/lib/admin/reports";
import { requireOwner } from "@/lib/admin/session";
import { loadBlocks, loadStayBook, toReportInput } from "@/lib/admin/stay-data";
import { t } from "@/lib/admin/strings";

const yearSchema = z.coerce.number().int().min(2000).max(2100);

/** One line per month, each column labelled as on the report page. */
export async function GET(request: Request) {
  const admin = await requireOwner();
  const now = new Date();
  const asked = yearSchema.safeParse(
    new URL(request.url).searchParams.get("year"),
  );
  const year = asked.success ? asked.data : now.getUTCFullYear();

  const [book, blocks] = await Promise.all([
    loadStayBook(admin),
    loadBlocks(admin),
  ]);
  const months = monthlyReports(toReportInput(book, blocks, now), year);
  const c = t.reports.csv;

  const csv = toCsv(
    [
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
    ],
    months.map(({ key, report: { money, bookings, nights, noAmount } }) => [
      key,
      csvEuro(money.paymentsCents),
      csvEuro(money.refundsCents),
      csvEuro(money.receivedCents),
      csvEuro(money.enteredCents),
      csvEuro(money.incomeCents),
      csvEuro(money.bookedCents),
      csvEuro(money.expectedCents),
      csvEuro(money.owedCents),
      bookings.made,
      bookings.had,
      bookings.expected,
      bookings.cancelled,
      bookings.noShows,
      nights.booked,
      nights.available,
      nights.occupancyTenths === null ? null : nights.occupancyTenths / 10,
      csvEuro(nights.averageNightCents),
      noAmount.stays,
    ]),
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="casa-filakopi-report-${year}.csv"`,
    },
  });
}
