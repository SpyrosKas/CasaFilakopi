import { requireOwner } from "@/lib/admin/session";
import { loadStayBook } from "@/lib/admin/stay-data";
import { holdsMoneyUnconfirmed } from "@/lib/admin/stays";
import { bookingsWorkbook, XLSX_TYPE } from "@/lib/admin/workbooks";

/** Guest contacts and money together, so this file is the Owner's alone. */
export async function GET() {
  const admin = await requireOwner();
  const { stays } = await loadStayBook(admin);

  // An abandoned checkout is left out, unless money is sitting on it (D7).
  const rows = stays
    .filter((stay) => stay.status !== "expired" || holdsMoneyUnconfirmed(stay))
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn));

  return new Response(Buffer.from(bookingsWorkbook(rows)), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition":
        'attachment; filename="casa-filakopi-bookings.xlsx"',
    },
  });
}
