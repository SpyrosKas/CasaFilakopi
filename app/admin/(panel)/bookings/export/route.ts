import { csvEuro, toCsv } from "@/lib/admin/csv";
import { requireOwner } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import { t } from "@/lib/admin/strings";

/** Guest contacts and money together, so this file is the Owner's alone. */
export async function GET() {
  const admin = await requireOwner();
  const { stays } = await loadStayBook(admin);
  const c = t.bookings.exported;

  const rows = stays
    .filter((stay) => stay.status !== "expired")
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
    .map((stay) => [
      stay.reference,
      t.stay.status[stay.status],
      t.stay.source[stay.source],
      stay.name ?? stay.summary,
      stay.email,
      stay.phone,
      stay.checkIn,
      stay.checkOut,
      stay.nights,
      stay.adults,
      stay.children,
      csvEuro(stay.totalCents),
      stay.kind === "booking" ? csvEuro(stay.money.receivedCents) : null,
      stay.kind === "booking" ? csvEuro(stay.money.refundedCents) : null,
      stay.kind === "booking" ? csvEuro(stay.money.paidCents) : null,
      stay.kind === "booking" ? csvEuro(stay.balanceCents) : null,
      csvEuro(stay.enteredCents),
      t.stay.money[stay.moneyState],
    ]);

  const csv = toCsv(
    [
      c.reference,
      c.status,
      c.source,
      c.guest,
      c.email,
      c.phone,
      c.checkIn,
      c.checkOut,
      c.nights,
      c.adults,
      c.children,
      c.total,
      c.received,
      c.refunded,
      c.paid,
      c.balance,
      c.entered,
      c.payment,
    ],
    rows,
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition":
        'attachment; filename="casa-filakopi-bookings.csv"',
    },
  });
}
