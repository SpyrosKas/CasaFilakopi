"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callAdminRpc } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { requireOwner, type AdminContext } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import type { Json } from "@/lib/db/types";
import {
  loadIndex,
  loadInvoicingSetup,
  loadIssuablePayment,
  loadLines,
  type IndexRow,
} from "./data";
import { resolveSelection, reviewOf } from "./export";
import {
  applyFilters,
  parseFilters,
  SELECTION_LIMIT,
  type InvoiceFilters,
} from "./filters";
import { parseEuros } from "./format";
import { buildCreditLines, buildPaymentLines } from "./lines";
import type { SelectionReview } from "./review";
import { creditSchema, issueSchema, issuerFormSchema } from "./schemas";
import { storeInvoicePdf } from "./storage";

// Every action starts with requireOwner: these are public POST endpoints, and
// invoices are Owner only. Issuing goes through the database functions alone.

const s = t.invoices;
const LIST = "/admin/invoices";

const asJson = (value: unknown) => value as NonNullable<Json>;

function databaseMessage(error: unknown): string {
  const code = (error as { message?: string } | null)?.message ?? "";
  const known: Record<string, string> = s.errors.database;
  return known[code] ?? t.common.somethingWrong;
}

/**
 * The number is already used by the time this runs, so a failure here must not
 * undo anything: the document stays listed as "PDF missing", with a button to
 * make the PDF again.
 */
async function tryStorePdf(admin: AdminContext, invoiceId: string) {
  try {
    const row = (await loadIndex(admin)).find((r) => r.id === invoiceId);
    if (row && !row.hasPdf) await storeInvoicePdf(admin, row);
  } catch (error) {
    console.error("invoice_pdf_failed", invoiceId, error);
  }
}

export async function issueDocument(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = issueSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const form = parsed.data;

  const payment = await loadIssuablePayment(admin, form.paymentId);
  if (!payment) return errorState(s.errors.paymentGone);

  const { lines } = buildPaymentLines({
    reference: payment.reference,
    breakdown: payment.breakdown,
    payment: { kind: payment.kind, amountCents: payment.amountCents },
  });
  const customer = {
    name: payment.guestName,
    email: payment.guestEmail,
    country: payment.guestCountry,
    ...(form.docType === "invoice"
      ? {
          companyName: form.companyName,
          vatNumber: form.vatNumber,
          address: form.address,
          taxOffice: form.taxOffice,
        }
      : {}),
  };

  let invoiceId: string;
  try {
    const result = await callAdminRpc(admin, "issue_invoice", {
      p_booking_id: payment.bookingId,
      p_doc_type: form.docType,
      p_customer: asJson(customer),
      p_lines: asJson(lines),
      p_payment_id: payment.paymentId,
      p_payment_method: payment.method,
    });
    invoiceId = (result as { invoice_id: string }).invoice_id;
  } catch (error) {
    return errorState(databaseMessage(error));
  }

  await tryStorePdf(admin, invoiceId);
  revalidatePath(LIST);
  redirect(`${LIST}/${invoiceId}`);
}

export async function issueCreditNote(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = creditSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { invoiceId, amount, reason } = parsed.data;

  const rows = await loadIndex(admin);
  const original = rows.find((row) => row.id === invoiceId);
  if (!original || original.docType === "credit_note") {
    return errorState(s.errors.notCreditable);
  }

  const earlier = rows.filter((row) => row.creditsInvoiceId === invoiceId);
  const creditedCents = earlier.reduce((sum, r) => sum + r.totalCents, 0);
  const creditedVatCents = earlier.reduce((sum, r) => sum + r.vatCents, 0);
  const amountCents = parseEuros(amount);
  if (amountCents === null || amountCents <= 0) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { amount: s.errors.amount },
    };
  }

  let creditId: string;
  try {
    const lines = buildCreditLines({
      documentNumber: original.documentNumber,
      totalCents: original.totalCents,
      vatCents: original.vatCents,
      lines: await loadLines(admin, invoiceId),
      creditedCents,
      creditedVatCents,
      amountCents,
    });
    // The database holds the real limit, under a lock.
    const result = await callAdminRpc(admin, "issue_credit_note", {
      p_invoice_id: invoiceId,
      p_lines: asJson(lines),
      p_reason: reason,
    });
    creditId = (result as { invoice_id: string }).invoice_id;
  } catch (error) {
    return errorState(databaseMessage(error));
  }

  await tryStorePdf(admin, creditId);
  revalidatePath(LIST);
  redirect(`${LIST}/${creditId}`);
}

/** Never issues anything: it only makes the file for an existing document. */
export async function regeneratePdf(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const id = String(formData.get("invoiceId"));
  const resolved = await resolveSelection(admin, [id]);
  if (!resolved.ok) return errorState(s.errors.notFound);

  try {
    await storeInvoicePdf(admin, resolved.rows[0]);
  } catch (error) {
    console.error("invoice_pdf_failed", id, error);
    return errorState(s.errors.pdfFailed);
  }
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${id}`);
  redirect(`${LIST}/${id}?pdf=ready`);
}

export interface MatchedSelection {
  status: "ok" | "error";
  message?: string;
  documents: { id: string; signedCents: number }[];
}

const signedCents = (row: IndexRow) =>
  (row.docType === "credit_note" ? -1 : 1) * row.totalCents;

/** Every document under a filter, on every page of results. */
export async function selectMatching(query: string): Promise<MatchedSelection> {
  const admin = await requireOwner();
  const filters: InvoiceFilters = parseFilters(
    Object.fromEntries(new URLSearchParams(String(query))),
  );
  const rows = applyFilters(await loadIndex(admin), filters);
  if (rows.length > SELECTION_LIMIT) {
    return {
      status: "error",
      message: s.selection.tooMany(rows.length, SELECTION_LIMIT),
      documents: [],
    };
  }
  return {
    status: "ok",
    documents: rows.map((row) => ({
      id: row.id,
      signedCents: signedCents(row),
    })),
  };
}

export type ReviewResult =
  ({ status: "ok" } & SelectionReview) | { status: "error"; message: string };

export async function reviewSelection(ids: string[]): Promise<ReviewResult> {
  const admin = await requireOwner();
  const resolved = await resolveSelection(admin, ids);
  if (!resolved.ok) {
    return { status: "error", message: s.selection.refused };
  }
  return { status: "ok", ...reviewOf(resolved.rows) };
}

/**
 * Separate from downloading, and a step of its own. Anything with no PDF stays
 * unsent, since it cannot have gone to the accountant. The database leaves
 * documents already marked as they are, so marking twice keeps the first date.
 */
export async function markSent(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  if (formData.get("confirm") !== "yes") {
    return errorState(s.selection.confirmRequired);
  }
  const resolved = await resolveSelection(admin, formData.getAll("id"));
  if (!resolved.ok) return errorState(s.selection.refused);

  const ready = resolved.rows.filter((row) => row.hasPdf);
  const skipped = resolved.rows.length - ready.length;
  try {
    const marked = await callAdminRpc(admin, "mark_invoices_exported", {
      p_invoice_ids: ready.map((row) => row.id),
    });
    revalidatePath(LIST);
    revalidatePath(`${LIST}/export`);
    return okState(s.selection.marked(marked, skipped));
  } catch (error) {
    return errorState(databaseMessage(error));
  }
}

/**
 * Writes the details and the default type only. isProvisional and the myDATA
 * mode are copied from what is stored, whatever the request says: they change
 * only after the accountant confirms (D4).
 */
export async function saveInvoicingSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = issuerFormSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { defaultDocType, ...issuer } = parsed.data;

  const { settings, isUnreadable } = await loadInvoicingSetup(admin);
  if (isUnreadable) return errorState(s.settings.unreadable);

  const { error } = await admin.supabase.from("settings").upsert({
    key: "invoicing",
    is_public: false,
    value: asJson({
      ...settings,
      defaultDocType,
      issuer: { ...settings.issuer, ...issuer },
    }),
  });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath(`${LIST}/settings`);
  return okState(t.common.saved);
}
