import { redirect } from "next/navigation";
import { z } from "zod";
import { requireOwner } from "@/lib/admin/session";
import { loadIndex } from "@/lib/invoicing/data";
import { pdfResponse } from "@/lib/invoicing/export";
import { signedPdfUrl } from "@/lib/invoicing/storage";

/**
 * Opening sends the Owner to a fresh short-lived link, made at the click.
 * ?download=1 saves the file under its document number, sent from here:
 * storage percent-encodes a Greek name given to a signed link, so Yorgos would
 * save %CE%91%CE%A0%CE%A5-000001.pdf.
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

  const missing = `/admin/invoices/${id}?pdf=missing`;
  if (new URL(request.url).searchParams.get("download") === "1") {
    return (await pdfResponse(admin, row)) ?? redirect(missing);
  }

  const url = await signedPdfUrl(admin, row);
  if (!url) redirect(missing);

  return new Response(null, {
    status: 303,
    headers: { Location: url, "Cache-Control": "private, no-store" },
  });
}
