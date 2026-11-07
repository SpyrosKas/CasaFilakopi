import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/admin/session";
import { loadIndex } from "@/lib/invoicing/data";
import { signedPdfUrl } from "@/lib/invoicing/storage";

/**
 * Sends the Owner to a fresh short-lived link, made at the moment of the click.
 * ?download=1 saves the file under its document number. Otherwise it opens.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const admin = await requireOwner();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return new Response(null, { status: 404 });
  }

  const row = (await loadIndex(admin)).find((entry) => entry.id === id);
  if (!row) return new Response(null, { status: 404 });

  const download = new URL(request.url).searchParams.get("download") === "1";
  const url = await signedPdfUrl(admin, row, { download });
  if (!url) redirect(`/admin/invoices/${id}?pdf=missing`);

  return new Response(null, {
    status: 303,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
