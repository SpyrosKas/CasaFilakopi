"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { logError } from "@/lib/log";
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
import type { Json } from "@/lib/db/types";
import { cannotPrint } from "./fonts";
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
import { existingPdfs, storeInvoicePdf } from "./storage";
import type { AdminStrings } from "@/lib/admin/strings";

// Every action starts with requireOwner: these are public POST endpoints, and
// invoices are Owner only. Issuing goes through the database functions alone.

const LIST = "/admin/invoices";

const asJson = (value: unknown) => value as NonNullable<Json>;

function databaseMessage(error: unknown, t: AdminStrings): string {
  const code = (error as { message?: string } | null)?.message ?? "";
  const known: Record<string, string> = t.invoices.errors.database;
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
    await logError("invoice.pdf_failed", error, { invoiceId });
  }
}

export async function issueDocument(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();
  const s = t.invoices;

  const admin = await requireOwner();
  const parsed = issueSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const form = parsed.data;

  const payment = await loadIssuablePayment(admin, form.paymentId);
  if (!payment) return errorState(s.errors.paymentGone);

  const built = buildPaymentLines({
    reference: payment.reference,
    breakdown: payment.breakdown,
    payment: {
      kind: payment.kind,
      amountCents: payment.amountCents,
      isRetained: payment.isRetained,
    },
  });
  if (!built.ok) return errorState(s.errors.priceUnreadable);

  // What the Owner types must print: it cannot be fixed after issuing.
  const typed: Record<string, string> = {
    billingName: form.billingName,
    ...(form.docType === "invoice"
      ? {
          companyName: form.companyName,
          address: form.address,
          taxOffice: form.taxOffice,
        }
      : {}),
  };
  const fieldErrors = Object.fromEntries(
    Object.entries(typed)
      .filter(([, value]) => cannotPrint(value).length > 0)
      .map(([field]) => [field, s.errors.cannotPrint]),
  );
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: t.common.fixErrors, fieldErrors };
  }

  const customer = {
    name: form.billingName || payment.guestName,
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

  let issued: { invoice_id: string; already_issued: boolean };
  try {
    issued = (await callAdminRpc(admin, "issue_invoice", {
      p_booking_id: payment.bookingId,
      p_doc_type: form.docType,
      p_customer: asJson(customer),
      p_lines: asJson(built.lines),
      p_payment_id: payment.paymentId,
      p_payment_method: payment.method,
    })) as typeof issued;
  } catch (error) {
    return errorState(databaseMessage(error, t));
  }

  await tryStorePdf(admin, issued.invoice_id);
  revalidatePath(LIST);
  redirect(
    `${LIST}/${issued.invoice_id}${issued.already_issued ? "?notice=already_issued" : ""}`,
  );
}

export async function issueCreditNote(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();
  const s = t.invoices;

  const admin = await requireOwner();
  const parsed = creditSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { invoiceId, amount, reason, expectedCreditedCents } = parsed.data;
  if (cannotPrint(reason).length > 0) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: { reason: s.errors.cannotPrint },
    };
  }

  const rows = await loadIndex(admin);
  const original = rows.find((row) => row.id === invoiceId);
  if (!original || original.docType === "credit_note") {
    return errorState(s.errors.notCreditable);
  }

  const earlier = rows.filter((row) => row.creditsInvoiceId === invoiceId);
  const creditedCents = earlier.reduce((sum, r) => sum + r.totalCents, 0);
  const creditedVatCents = earlier.reduce((sum, r) => sum + r.vatCents, 0);
  const creditedFeeCents = earlier.reduce((sum, r) => sum + r.feeCents, 0);
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
      feeCents: original.feeCents,
      lines: await loadLines(admin, invoiceId),
      creditedCents,
      creditedVatCents,
      creditedFeeCents,
      amountCents,
    });
    // The database holds the real limit, under a lock, and refuses a form
    // that was opened before another credit note went through.
    const result = await callAdminRpc(admin, "issue_credit_note", {
      p_invoice_id: invoiceId,
      p_lines: asJson(lines),
      p_reason: reason,
      p_expected_credited_cents: expectedCreditedCents,
    });
    creditId = (result as { invoice_id: string }).invoice_id;
  } catch (error) {
    return errorState(databaseMessage(error, t));
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
  const { t } = await adminI18n();
  const s = t.invoices;

  const admin = await requireOwner();
  const id = String(formData.get("invoiceId"));
  const resolved = await resolveSelection(admin, [id]);
  if (!resolved.ok) return errorState(s.errors.notFound);

  try {
    await storeInvoicePdf(admin, resolved.rows[0]);
  } catch (error) {
    await logError("invoice.pdf_failed", error, { id });
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
  const { t } = await adminI18n();
  const s = t.invoices;

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
  const { t } = await adminI18n();
  const s = t.invoices;

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
  const { t } = await adminI18n();
  const s = t.invoices;

  const admin = await requireOwner();
  if (formData.get("confirm") !== "yes") {
    return errorState(s.selection.confirmRequired);
  }
  const resolved = await resolveSelection(admin, formData.getAll("id"));
  if (!resolved.ok) return errorState(s.selection.refused);

  try {
    // The file itself is checked: a stored path alone proves nothing.
    const paths = resolved.rows.flatMap((row) => row.pdfPath ?? []);
    const files = await existingPdfs(admin, paths);
    const ready = resolved.rows.filter(
      (row) => row.pdfPath && files.has(row.pdfPath),
    );
    const skipped = resolved.rows.length - ready.length;
    const marked = await callAdminRpc(admin, "mark_invoices_exported", {
      p_invoice_ids: ready.map((row) => row.id),
    });
    revalidatePath(LIST);
    revalidatePath(`${LIST}/export`);
    return okState(s.selection.marked(marked, skipped));
  } catch (error) {
    return errorState(databaseMessage(error, t));
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
  const { say, t } = await adminI18n();
  const s = t.invoices;

  const admin = await requireOwner();
  const parsed = issuerFormSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { defaultDocType, ...issuer } = parsed.data;

  const { settings, stored, isStored, isUnreadable } =
    await loadInvoicingSetup(admin);
  if (isUnreadable) return errorState(s.settings.unreadable);

  // The stored value, not the parsed one: filling in a default here would look
  // to the database like a change to isProvisional.
  const base = isStored ? stored : { isProvisional: true, myDataMode: "off" };
  const { error } = await admin.supabase.from("settings").upsert({
    key: "invoicing",
    is_public: false,
    value: asJson({
      ...base,
      defaultDocType,
      issuer: { ...settings.issuer, ...issuer },
    }),
  });
  if (error) return errorState(databaseMessage(error, t));

  revalidatePath(`${LIST}/settings`);
  return okState(t.common.saved);
}
