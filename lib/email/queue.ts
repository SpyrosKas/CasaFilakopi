import { createHash } from "node:crypto";
import { z } from "zod";
import { findTemplate } from "@/emails/registry";
import type { Json } from "@/lib/db/types";
import type { EmailDb } from "./db";
import { headerSafe, MAX_BODY_LENGTH } from "./template-text";
import {
  documentsAreProvisional,
  loadEmailSettings,
  type EmailSettings,
} from "./settings";
import { asLocale } from "./variables";

// What other tracks call. Each type names exactly the data it takes, and the
// objects are strict, so a raw guest token or stillOwedCents (D24) cannot be
// passed in. Rows hold ids; values are read when the email goes out.

const id = z.uuid();
const bookingOnly = z.strictObject({ bookingId: id });
const contactOnly = z.strictObject({ contactMessageId: id });
const cents = z.number().int().min(0);
const shortText = z.string().trim().min(1).max(500);
const longText = z.string().trim().min(1).max(MAX_BODY_LENGTH);

const attachmentRef = z.strictObject({
  bucket: z.enum(["invoices", "uploads-private"]),
  // Plain relative paths only: no "..", no leading slash, no backslash.
  path: z
    .string()
    .max(500)
    .regex(/^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/)
    .refine((path) => !path.includes("..")),
  filename: z
    .string()
    .max(200)
    .regex(/^[^/\\\r\n\0]+$/),
  contentType: z
    .string()
    .max(100)
    .regex(/^[a-z]+\/[a-z0-9.+-]+(; ?charset=[a-z0-9-]+)?$/i),
});

/** Checked when a row is queued and again when it is sent. */
export const attachmentRefs = z.array(attachmentRef).max(10);

export type AttachmentRef = z.output<typeof attachmentRef>;

const alert = {
  bookingId: id.optional(),
  amountCents: cents.optional(),
  reason: shortText.optional(),
};

export const EMAIL_DATA = {
  booking_confirmation: bookingOnly,
  payment_receipt: z.strictObject({ bookingId: id, paymentId: id }),
  invoice_document: z.strictObject({ bookingId: id, invoiceId: id }),
  balance_request: bookingOnly,
  balance_reminder: bookingOnly,
  pre_arrival: bookingOnly,
  booking_cancellation: z.strictObject({
    bookingId: id,
    refundCents: cents.optional(),
  }),
  refund_confirmation: z.strictObject({ bookingId: id, refundId: id }),
  contact_auto_reply: contactOnly,
  thank_you: bookingOnly,
  scheduled_message: z.strictObject({
    bookingId: id,
    subject: shortText,
    body: longText,
    ruleId: z.string().max(64).optional(),
  }),
  host_new_booking: bookingOnly,
  host_booking_modified: z.strictObject({
    bookingId: id,
    changes: longText.optional(),
  }),
  host_booking_cancelled: z.strictObject({
    bookingId: id,
    refundCents: cents.optional(),
  }),
  host_payment_failed: z.strictObject(alert),
  host_dispute_opened: z.strictObject(alert),
  host_contact_message: contactOnly,
  host_email_bounced: z.strictObject({
    bookingId: id.optional(),
    recipient: z.email(),
    emailName: shortText,
    reason: shortText.optional(),
  }),
  host_guest_message: z.strictObject({ bookingId: id, message: longText }),
  host_sync_conflict: z.strictObject({
    channel: shortText,
    checkIn: z.iso.date(),
    checkOut: z.iso.date(),
    summary: shortText.optional(),
  }),
  host_sync_failure: z.strictObject({
    channel: shortText,
    failures: z.number().int().positive(),
    error: shortText.optional(),
  }),
  host_invoice_failed: z.strictObject({
    documentNumber: shortText,
    error: shortText.optional(),
  }),
  host_job_failure: z.strictObject({
    job: shortText,
    failures: z.number().int().positive(),
    error: shortText.optional(),
  }),
} as const;

export type EmailType = keyof typeof EMAIL_DATA;
export type EmailData<T extends EmailType> = z.input<(typeof EMAIL_DATA)[T]>;

export interface QueueOptions {
  /** Not before this moment. Default: as soon as the worker runs. */
  sendAt?: Date;
  /** The same key never queues twice. Many types have one built in. */
  dedupeKey?: string;
  /** Files in storage. Only the path goes in the row, never the bytes. */
  attachments?: AttachmentRef[];
}

export type QueueResult =
  | {
      ok: true;
      /** New rows. Empty when dedupeKey had already been used. */
      ids: string[];
      duplicate: boolean;
    }
  | {
      ok: false;
      reason:
        | "invalid_data"
        | "booking_not_found"
        | "no_recipient"
        | "provisional_blocked"
        | "database_error";
      detail?: string;
    };

/** An email a booking should only ever get once, whatever is retried. */
const ONCE_PER: Partial<Record<EmailType, string>> = {
  booking_confirmation: "bookingId",
  payment_receipt: "paymentId",
  invoice_document: "invoiceId",
  booking_cancellation: "bookingId",
  refund_confirmation: "refundId",
  contact_auto_reply: "contactMessageId",
  host_new_booking: "bookingId",
  host_booking_cancelled: "bookingId",
  host_contact_message: "contactMessageId",
  balance_request: "bookingId",
  balance_reminder: "bookingId",
  pre_arrival: "bookingId",
  thank_you: "bookingId",
};

/**
 * A row's id is a UUID v5 of its dedupe key, so the primary key makes repeats
 * impossible, even when two runs race. No new column or index is needed.
 */
export function dedupeId(key: string): string {
  const hash = createHash("sha1")
    .update("casa-filakopi-email:")
    .update(key)
    .digest("hex");
  const variant = ((parseInt(hash[16], 16) & 3) | 8).toString(16);
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `${variant}${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join("-");
}

type Failure = Extract<QueueResult, { ok: false }>;

interface Recipients {
  addresses: string[];
  locale: string;
}

async function guestRecipient(
  db: EmailDb,
  data: Record<string, unknown>,
): Promise<Recipients | Failure> {
  if (typeof data.contactMessageId === "string") {
    const { data: row, error } = await db
      .from("contact_messages")
      .select("email, locale")
      .eq("id", data.contactMessageId)
      .maybeSingle();
    if (error) return { ok: false, reason: "database_error" };
    if (!row) return { ok: false, reason: "no_recipient" };
    return { addresses: [row.email], locale: row.locale };
  }
  const { data: row, error } = await db
    .from("bookings")
    .select("guest_email, locale")
    .eq("id", String(data.bookingId))
    .maybeSingle();
  if (error) return { ok: false, reason: "database_error" };
  if (!row) return { ok: false, reason: "booking_not_found" };
  if (!row.guest_email) return { ok: false, reason: "no_recipient" };
  return { addresses: [row.guest_email], locale: row.locale };
}

/** Rule one for D17: no provisional document goes to a guest. */
export async function invoiceIsBlocked(
  db: EmailDb,
  invoiceId: string,
  settings: EmailSettings,
): Promise<boolean> {
  if (!settings.invoiceEmailEnabled) return true;
  if (await documentsAreProvisional(db)) return true;
  const { data, error } = await db
    .from("invoices")
    .select("is_provisional, status")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !data || data.is_provisional || data.status !== "issued";
}

/** Built from the invoice itself, so a row can never name another's file. */
export async function invoiceAttachment(
  db: EmailDb,
  invoiceId: string,
  bookingId: string | null,
): Promise<{ ref: AttachmentRef; documentNumber: string } | null> {
  const { data, error } = await db
    .from("invoices")
    .select("pdf_path, document_number, booking_id")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.pdf_path || !data.document_number) return null;
  if (data.booking_id !== bookingId) return null;
  return {
    documentNumber: data.document_number,
    ref: {
      bucket: "invoices",
      path: data.pdf_path,
      filename: `${data.document_number}.pdf`,
      contentType: "application/pdf",
    },
  };
}

/**
 * Queues an email. It never throws and never sends: a booking must complete
 * even if email is down, so callers check the result only if they care.
 */
export async function queueEmailWith<T extends EmailType>(
  db: EmailDb,
  type: T,
  data: EmailData<T>,
  options: QueueOptions = {},
): Promise<QueueResult> {
  try {
    return await enqueue(db, type, data, options);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown";
    console.error(`queueEmail ${type} failed: ${detail}`);
    return { ok: false, reason: "database_error", detail };
  }
}

async function enqueue<T extends EmailType>(
  db: EmailDb,
  type: T,
  input: EmailData<T>,
  options: QueueOptions,
): Promise<QueueResult> {
  const parsed = EMAIL_DATA[type].safeParse(input);
  if (!parsed.success) {
    console.error(`queueEmail ${type}: ${parsed.error.message}`);
    return { ok: false, reason: "invalid_data", detail: parsed.error.message };
  }
  const data = parsed.data as Record<string, unknown>;
  const { bookingId, contactMessageId, ...rest } = data;
  const settings = await loadEmailSettings(db);

  const isHost = findTemplate(type)?.audience === "host";
  const recipients: Recipients | Failure = isHost
    ? { addresses: settings.hostRecipients, locale: settings.hostLocale }
    : await guestRecipient(db, data);
  if ("ok" in recipients) return recipients;

  const payload: Record<string, unknown> = { ...rest };
  if (typeof payload.subject === "string") {
    payload.subject = headerSafe(payload.subject);
  }
  const refs = attachmentRefs.safeParse(options.attachments ?? []);
  if (!refs.success) {
    console.error(`queueEmail ${type}: bad attachment reference`);
    return { ok: false, reason: "invalid_data", detail: refs.error.message };
  }
  const attachments = refs.data;
  // The 72-hour limit counts from here for an email meant for later.
  if (options.sendAt) payload.notBefore = options.sendAt.toISOString();

  if (type === "invoice_document") {
    const invoiceId = String(data.invoiceId);
    if (await invoiceIsBlocked(db, invoiceId, settings)) {
      return { ok: false, reason: "provisional_blocked" };
    }
    const document = await invoiceAttachment(db, invoiceId, String(bookingId));
    if (!document) return { ok: false, reason: "invalid_data" };
    attachments.push(document.ref);
    payload.documentNumber = document.documentNumber;
  }
  if (attachments.length) payload.attachments = attachments;

  const onceField = ONCE_PER[type];
  const key =
    options.dedupeKey ??
    (onceField ? `${type}:${String(data[onceField])}` : undefined);

  const rows = recipients.addresses.map((recipient) => ({
    ...(key ? { id: dedupeId(`${key}:${recipient.toLowerCase()}`) } : {}),
    template_key: type,
    recipient,
    locale: asLocale(recipients.locale),
    payload: payload as NonNullable<Json>,
    booking_id: typeof bookingId === "string" ? bookingId : null,
    contact_message_id:
      typeof contactMessageId === "string" ? contactMessageId : null,
    status: "queued",
    next_attempt_at: (options.sendAt ?? new Date()).toISOString(),
  }));

  const { data: inserted, error } = await db
    .from("email_logs")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (error) {
    console.error(`queueEmail ${type}: ${error.message}`);
    return { ok: false, reason: "database_error", detail: error.message };
  }
  const ids = inserted.map((row) => row.id);
  return { ok: true, ids, duplicate: ids.length === 0 };
}
