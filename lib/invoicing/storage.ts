import "server-only";
import { callAdminRpc } from "@/lib/admin/audit";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import { loadLines, pdfInput, type IndexRow } from "./data";
import { PDF_CACHE_SECONDS, pdfStoragePath } from "./format";
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
  row: Pick<IndexRow, "pdfPath">,
): Promise<string | null> {
  await assertOwner(admin);
  if (!row.pdfPath) return null;
  const { data, error } = await bucket().createSignedUrl(
    row.pdfPath,
    SIGNED_URL_SECONDS,
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

/** Which of these paths really hold a file, asking once per folder. */
export async function existingPdfs(
  admin: AdminContext,
  paths: string[],
): Promise<Set<string>> {
  await assertOwner(admin);
  const folders = new Set(
    paths.map((path) => path.slice(0, path.lastIndexOf("/"))),
  );
  const found = new Set<string>();
  const pageSize = 1000;
  for (const folder of folders) {
    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await bucket().list(folder, {
        limit: pageSize,
        offset,
      });
      if (error) throw error;
      for (const file of data) found.add(`${folder}/${file.name}`);
      if (data.length < pageSize) break;
    }
  }
  return found;
}

const sameBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && Buffer.compare(a, b) === 0;

/**
 * Makes the PDF from stored data, stores it and links it to the document. Safe
 * to repeat: the same document always gives the same file. A file already at
 * that path is only linked if it is byte for byte this document, because
 * linking anything else would show a guest's document with the wrong contents.
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
  const path = pdfStoragePath(row.id, row.issuedAt);
  const { error } = await bucket().upload(path, bytes, {
    contentType: "application/pdf",
    cacheControl: PDF_CACHE_SECONDS,
    upsert: false,
  });
  if (error) {
    const stored = await readPdf(admin, path);
    if (!stored || !sameBytes(stored, bytes)) throw error;
  }
  await callAdminRpc(admin, "attach_invoice_pdf", {
    p_invoice_id: row.id,
    p_path: path,
  });
}
