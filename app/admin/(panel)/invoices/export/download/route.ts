import { athensDate } from "@/lib/domain/dates";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { loadIndex } from "@/lib/invoicing/data";
import {
  packResponse,
  pdfResponse,
  resolveSelection,
} from "@/lib/invoicing/export";
import { applyFilters, filtersSchema } from "@/lib/invoicing/filters";

// The monthly pack and a selection are the same export: only how the list of
// documents is found differs. Neither marks anything as sent.

function refuse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: Request): Promise<Response> {
  const admin = await requireOwner();
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const filters = filtersSchema.parse({ month });
  if (!filters.month) return refuse(t.invoices.selection.refused, 400);

  const rows = applyFilters(await loadIndex(admin), filters).reverse();
  return packResponse(admin, rows, `casa-filakopi-${filters.month}`);
}

export async function POST(request: Request): Promise<Response> {
  const admin = await requireOwner();
  // A body that is not a form has no ids, and is refused like any other.
  const form = await request.formData().catch(() => new FormData());
  const resolved = await resolveSelection(admin, form.getAll("id"));
  if (!resolved.ok) return refuse(t.invoices.selection.refused, 400);

  const { rows } = resolved;
  if (rows.length === 1) {
    return (
      (await pdfResponse(admin, rows[0])) ??
      new Response(null, {
        status: 303,
        headers: { Location: `/admin/invoices/${rows[0].id}?pdf=missing` },
      })
    );
  }
  const today = athensDate(new Date());
  return packResponse(admin, rows, `casa-filakopi-selection-${today}`);
}
