import { z } from "zod";
import { writeAudit } from "@/lib/admin/audit";
import { guestWorkbook } from "@/lib/admin/guest-export";
import { loadGuestData } from "@/lib/admin/guest-data";
import { requireOwner } from "@/lib/admin/session";
import { XLSX_TYPE } from "@/lib/admin/workbooks";

/** Owner only. The file name holds no name, and the download is logged. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return new Response("Not found", { status: 404 });
  }

  const data = await loadGuestData(admin, id);
  if (!data) return new Response("Not found", { status: 404 });

  const body = guestWorkbook(data);
  await writeAudit(admin, {
    action: "export",
    entity: "guests",
    entityId: id,
  });

  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="guest-data-${id.slice(0, 8)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
