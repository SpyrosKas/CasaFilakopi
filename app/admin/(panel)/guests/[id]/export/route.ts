import { z } from "zod";
import { writeAudit } from "@/lib/admin/audit";
import { guestWorkbook } from "@/lib/admin/guest-export";
import { loadGuestData } from "@/lib/admin/guest-data";
import { adminI18n } from "@/lib/admin/i18n-server";
import { requireOwner } from "@/lib/admin/session";
import { XLSX_TYPE } from "@/lib/admin/workbooks";

/** Owner only. The file name holds no name, and the download is logged. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return new Response("Not found", { status: 404 });
  }

  const data = await loadGuestData(admin, id);
  if (!data) return new Response("Not found", { status: 404 });

  const { t } = await adminI18n();
  // Name-only matches may be someone else, so they need asking for.
  const withCandidates =
    new URL(request.url).searchParams.get("candidates") === "1";
  const body = guestWorkbook(data, t, withCandidates);
  await writeAudit(admin, {
    action: "export",
    entity: "guests",
    entityId: id,
    after: { with_candidates: withCandidates },
  });

  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="guest-data-${id.slice(0, 8)}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
