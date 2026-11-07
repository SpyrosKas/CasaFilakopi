import "server-only";
import { writeAudit } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import { loadLines, pdfInput, type IndexRow } from "./data";
import { pdfFileName, pdfStoragePath } from "./format";
import { renderInvoicePdf } from "./pdf";

// The bucket has no policies, so only the secret key reaches it. Each call
// checks the role through the user's own client first, as callAdminRpc does:
// the secret key skips the MFA check.

const BUCKET = "invoices";

/** Long enough to open a link, too short to be worth passing around. */
export const SIGNED_URL_SECONDS = 60;

async function assertOwner(admin: AdminContext): Promise<void> {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error) throw error;
  if (role !== "owner") throw new Error("not_authorised");
}

const bucket = () => createAdminClient().storage.from(BUCKET);

/** Null when the file is not in the bucket. */
export async function signedPdfUrl(
  admin: AdminContext,
  row: Pick<IndexRow, "pdfPath" | "documentNumber">,
  options: { download: boolean },
): Promise<string | null> {
  await assertOwner(admin);
  if (!row.pdfPath) return null;
  const { data, error } = await bucket().createSignedUrl(
    row.pdfPath,
    SIGNED_URL_SECONDS,
    options.download
      ? { download: pdfFileName(row.documentNumber) }
      : undefined,
  );
  return error ? null : data.signedUrl;
}

/** One file at a time, into memory only for as long as it is being sent. */
export async function readPdf(
  admin: AdminContext,
  path: string,
): Promise<Uint8Array | null> {
  await assertOwner(admin);
  const { data, error } = await bucket().download(path);
  return error ? null : new Uint8Array(await data.arrayBuffer());
}

/**
 * attach_invoice_pdf takes no p_actor, so callAdminRpc cannot call it and the
 * audit line is written here to name the Owner.
 */
async function attachPdf(
  admin: AdminContext,
  invoiceId: string,
  path: string,
): Promise<void> {
  await assertOwner(admin);
  const { error } = await createAdminClient().rpc("attach_invoice_pdf", {
    p_invoice_id: invoiceId,
    p_path: path,
  });
  if (error) throw error;
  await writeAudit(admin, {
    action: "invoice_pdf_attached",
    entity: "invoices",
    entityId: invoiceId,
    after: { path },
  });
}

/**
 * Makes the PDF from stored data, stores it and links it to the document. Safe
 * to repeat: the same document always gives the same file at the same path, so
 * a file already there from an earlier, half-finished try is simply linked.
 * Throws if it fails. The document stays issued and listed as "PDF missing".
 */
export async function storeInvoicePdf(
  admin: AdminContext,
  row: IndexRow,
): Promise<void> {
  await assertOwner(admin);
  const bytes = await renderInvoicePdf(
    pdfInput(row, await loadLines(admin, row.id)),
  );
  const path = pdfStoragePath(row.documentNumber, row.issuedAt);
  const { error } = await bucket().upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error && !/exists|duplicate/i.test(error.message)) throw error;
  await attachPdf(admin, row.id, path);
}
