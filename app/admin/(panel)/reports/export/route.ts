import { z } from "zod";
import { requireOwner } from "@/lib/admin/session";
import { loadBlocks, loadStayBook, toReportInput } from "@/lib/admin/stay-data";
import { reportWorkbook, XLSX_TYPE } from "@/lib/admin/workbooks";

const yearSchema = z.coerce.number().int().min(2000).max(2100);

/** One line per month and one for the year, labelled as on the report page. */
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
  const file = reportWorkbook(toReportInput(book, blocks, now), year);

  return new Response(Buffer.from(file), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="casa-filakopi-report-${year}.xlsx"`,
    },
  });
}
