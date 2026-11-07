import {
  BOOKING_PLACEHOLDERS,
  findTemplate,
  SCHEDULED_MESSAGE_KEY,
} from "@/emails/registry";
import type { RenderedEmail, TemplateCopy } from "@/emails/types";
import type { EmailDb, EmailLogRow } from "./db";
import type { GuestLinkEnv } from "./guest-link";
import { buildStayIcs } from "./ics";
import {
  attachmentRefs,
  invoiceAttachment,
  invoiceIsBlocked,
  type AttachmentRef,
} from "./queue";
import { renderCopy, renderEmail } from "./render";
import { loadEmailSettings, type EmailSettings } from "./settings";
import { validateText } from "./template-text";
import {
  TransportError,
  type EmailTransport,
  type OutgoingAttachment,
} from "./transport";
import {
  asLocale,
  buildContext,
  isClosedBooking,
  paidCents,
  type EmailContext,
} from "./variables";

// The queue is email_logs (EML-07, JOB-05). A row moves queued -> sending ->
// sent, then delivered or bounced from the webhook. Any number of workers can
// run at once, because taking a row is one atomic update (see claimRow).

export const MAX_ATTEMPTS = 6;
const BACKOFF_MINUTES = [1, 5, 30, 120, 360];
const DEFAULT_BATCH = 20;
/** Longer than a send can take. After it, a crashed worker's row is free. */
const LEASE_MINUTES = 10;
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** The row will never send. Stored as failed so Yorgos sees it. */
class PermanentFailure extends Error {}

/** On purpose, not an error. last_error starts "skipped:" so Admin can tell. */
class Skip extends Error {}

export const SKIPPED_PREFIX = "skipped:";

/**
 * Older than this, an email is news nobody needs (D28), so adding the key late
 * cannot flood people. A confirmation is still the guest's only record.
 */
const MAX_AGE_MS = 72 * 3_600_000;

/** Has been paid for and not called off. */
const LIVE_STATUSES = ["confirmed", "checked_in", "completed"];

const backoffMs = (attempts: number) =>
  BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000;

export interface WorkerResult {
  status: "ok" | "not_configured" | "config_error";
  /** Why the batch stopped, when status is config_error. */
  configError?: string;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  /** Rows waiting because no transport is set up. */
  waiting: number;
}

export interface WorkerOptions {
  db: EmailDb;
  transport: EmailTransport | null;
  env: GuestLinkEnv;
  now?: () => Date;
  limit?: number;
  /** Only these rows: a kick for one email, or a test sharing the database. */
  onlyIds?: string[];
}

interface Candidate {
  id: string;
  status: string;
  attempts: number;
}

async function findDue(
  db: EmailDb,
  now: Date,
  limit: number,
  onlyIds?: string[],
): Promise<Candidate[]> {
  let query = db
    .from("email_logs")
    .select("id, status, attempts")
    .in("status", ["queued", "sending"])
    .lte("next_attempt_at", now.toISOString())
    .order("next_attempt_at")
    .limit(limit);
  if (onlyIds) query = query.in("id", onlyIds);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Takes one row, or null if another worker got there first. The whole guard
 * against double sending is here: Postgres runs this update under a row lock
 * and re-checks the WHERE on the latest row, so of two racing updates only one
 * can still match. It needs no RPC or SKIP LOCKED: this site sends few emails.
 *
 * next_attempt_at doubles as the lease on a `sending` row. If a worker dies
 * mid-send, the row comes back here after the lease. The provider's idempotency
 * key, built from the row id, then stops a send that had got through.
 */
async function claimRow(
  db: EmailDb,
  row: Candidate,
  now: Date,
): Promise<EmailLogRow | null> {
  const { data, error } = await db
    .from("email_logs")
    .update({
      status: "sending",
      attempts: row.attempts + 1,
      next_attempt_at: new Date(
        now.getTime() + LEASE_MINUTES * 60_000,
      ).toISOString(),
    })
    .eq("id", row.id)
    .eq("status", row.status)
    .eq("attempts", row.attempts)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** Whoever is doing the work holds the lease, so these match on `sending`. */
async function finish(
  db: EmailDb,
  id: string,
  update: {
    status: "sent" | "queued" | "failed";
    last_error: string | null;
    attempts?: number;
    next_attempt_at?: string;
    resend_id?: string;
    sent_at?: string;
  },
): Promise<void> {
  const { error } = await db
    .from("email_logs")
    .update(update)
    .eq("id", id)
    .eq("status", "sending");
  if (error) throw new Error(error.message);
}

/**
 * Written by the webhook when it beats us here. The status stays what it set,
 * but we still store the id, so later events find the row.
 */
async function recordSent(
  db: EmailDb,
  id: string,
  resendId: string,
  now: Date,
): Promise<void> {
  await finish(db, id, {
    status: "sent",
    resend_id: resendId,
    sent_at: now.toISOString(),
    last_error: null,
  });
  const { error } = await db
    .from("email_logs")
    .update({ resend_id: resendId, sent_at: now.toISOString() })
    .eq("id", id)
    .is("resend_id", null);
  if (error) throw new Error(error.message);
}

function balanceSkip(row: EmailLogRow, owed: number): void {
  const isBalance =
    row.template_key === "balance_request" ||
    row.template_key === "balance_reminder";
  if (isBalance && owed <= 0) throw new Skip("balance already paid");
}

/** Timed emails are checked again now: the booking may have changed. */
const TIMED = [
  "balance_request",
  "balance_reminder",
  "pre_arrival",
  "thank_you",
  SCHEDULED_MESSAGE_KEY,
];

async function checkStillWanted(
  db: EmailDb,
  row: EmailLogRow,
  context: EmailContext,
): Promise<void> {
  const { booking } = context;
  const def = findTemplate(row.template_key);
  const isTimed = TIMED.includes(row.template_key);

  if (!booking) {
    if (def?.needsBooking || isTimed) {
      throw new PermanentFailure("booking_not_found");
    }
    return;
  }

  if (
    row.template_key === "booking_confirmation" &&
    !LIVE_STATUSES.includes(booking.status)
  ) {
    throw new Skip(`booking is ${booking.status}`);
  }

  // The address may have been corrected since. A note about a contact message
  // goes to whoever wrote it, who need not be the guest on the booking.
  const isToGuest = def?.audience !== "host";
  if (
    isToGuest &&
    !row.contact_message_id &&
    row.recipient.toLowerCase() !== booking.guest_email?.toLowerCase()
  ) {
    throw new Skip("the booking's email address has changed");
  }

  if (!isTimed) return;
  if (isClosedBooking(booking.status)) {
    throw new Skip(`booking is ${booking.status}`);
  }
  balanceSkip(row, booking.total_cents - (await paidCents(db, booking.id)));
}

/**
 * Rule two for D17, at the last step. It also covers rows other tracks wrote
 * directly, and documents that turned provisional after queueing. Nothing from
 * the row is trusted: refs are parsed again, and an invoice email takes its
 * file from the invoice itself. Any other invoice file may only reach the host.
 */
async function resolveAttachments(
  db: EmailDb,
  row: EmailLogRow,
  settings: EmailSettings,
): Promise<AttachmentRef[]> {
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const refs = attachmentRefs.safeParse(payload.attachments ?? []);
  if (!refs.success) throw new PermanentFailure("bad attachment reference");

  if (row.template_key === "invoice_document") {
    const { invoiceId } = payload;
    if (typeof invoiceId !== "string") {
      throw new PermanentFailure("provisional_blocked: no invoice on the row");
    }
    if (await invoiceIsBlocked(db, invoiceId, settings)) {
      throw new PermanentFailure("provisional_blocked");
    }
    const document = await invoiceAttachment(db, invoiceId, row.booking_id);
    if (!document) throw new PermanentFailure("invoice file not found");
    return [document.ref];
  }

  const toHost = settings.hostRecipients.some(
    (address) => address.toLowerCase() === row.recipient.toLowerCase(),
  );
  if (!toHost && refs.data.some((file) => file.bucket === "invoices")) {
    throw new PermanentFailure("provisional_blocked: invoice file to a guest");
  }
  return refs.data;
}

async function loadAttachments(
  db: EmailDb,
  refs: AttachmentRef[],
): Promise<OutgoingAttachment[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const { data, error } = await db.storage
        .from(ref.bucket)
        .download(ref.path);
      if (error || !data) {
        throw new Error(`attachment ${ref.path}: ${error?.message}`);
      }
      if (data.size > MAX_ATTACHMENT_BYTES) {
        throw new PermanentFailure(`attachment ${ref.path} is too large`);
      }
      return {
        filename: ref.filename,
        contentType: ref.contentType,
        content: Buffer.from(await data.arrayBuffer()),
      };
    }),
  );
}

function calendarFile(context: EmailContext): OutgoingAttachment | null {
  const { booking, property } = context;
  if (!booking) return null;
  return {
    filename: "casa-filakopi.ics",
    contentType: "text/calendar; charset=utf-8",
    content: Buffer.from(
      buildStayIcs({
        uid: booking.id,
        title: property.name,
        location: property.address,
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        createdAt: new Date(booking.created_at),
      }),
    ),
  };
}

async function loadOverride(
  db: EmailDb,
  key: string,
  locale: string,
): Promise<TemplateCopy | null> {
  const { data, error } = await db
    .from("email_templates")
    .select("subject, body")
    .eq("key", key)
    .eq("locale", locale)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

const footerLines = (
  context: EmailContext,
  isGuest: boolean,
  replyTo: string,
) =>
  isGuest
    ? [context.property.address, replyTo].filter(
        (line): line is string => !!line,
      )
    : [];

async function renderRow(
  db: EmailDb,
  row: EmailLogRow,
  context: EmailContext,
  replyTo: string,
): Promise<RenderedEmail> {
  const locale = asLocale(row.locale);
  const brandName = context.property.name;
  const payload = (row.payload ?? {}) as Record<string, unknown>;

  if (row.template_key === SCHEDULED_MESSAGE_KEY) {
    const copy = {
      subject: String(payload.subject ?? ""),
      body: String(payload.body ?? ""),
    };
    if (validateText(copy, BOOKING_PLACEHOLDERS).length) {
      throw new PermanentFailure("scheduled message text is not valid");
    }
    return renderCopy(copy, {
      locale,
      values: context.values,
      brandName,
      footer: footerLines(context, true, replyTo),
    });
  }

  const def = findTemplate(row.template_key);
  if (!def) throw new PermanentFailure(`unknown template ${row.template_key}`);

  if (def.needsGuestLink && !context.values.bookingLink) {
    // Without the link the guest could do nothing. GUEST_TOKEN_SECRET is the
    // usual cause, so this retries rather than failing at once.
    throw new Error("guest link unavailable");
  }
  for (const name of def.required) {
    if (!context.values[name]) throw new PermanentFailure(`no value: ${name}`);
  }

  return renderEmail(def, {
    locale,
    values: context.values,
    override: def.editable
      ? await loadOverride(db, def.key, locale)
      : undefined,
    brandName,
    footer: footerLines(context, def.audience === "guest", replyTo),
  });
}

async function deliver(
  options: WorkerOptions & { transport: EmailTransport },
  row: EmailLogRow,
  settings: EmailSettings,
  now: Date,
): Promise<string> {
  const { db, transport, env } = options;
  const context = await buildContext(db, row, settings, env, now);
  await checkStillWanted(db, row, context);

  const refs = await resolveAttachments(db, row, settings);

  const payloadReplyTo = (row.payload as { replyTo?: unknown } | null)?.replyTo;
  const replyTo =
    context.guestReplyTo ??
    (typeof payloadReplyTo === "string" ? payloadReplyTo : settings.replyTo);

  const email = await renderRow(db, row, context, replyTo);
  const attachments = await loadAttachments(db, refs);
  if (row.template_key === "booking_confirmation") {
    const calendar = settings.calendarAttachment && calendarFile(context);
    if (calendar) attachments.push(calendar);
  }

  const payload = (row.payload ?? {}) as { sendGeneration?: unknown };
  const generation = Number(payload.sendGeneration) || 0;

  const { id } = await transport.send({
    logId: row.id,
    idempotencyKey: `email-log/${row.id}/${generation}`,
    from: { name: settings.senderName, address: settings.fromAddress },
    to: row.recipient,
    replyTo,
    attachments,
    ...email,
  });
  return id;
}

async function handleFailure(
  db: EmailDb,
  row: EmailLogRow,
  error: unknown,
  now: Date,
): Promise<"retried" | "failed" | "skipped" | "sent"> {
  const message = error instanceof Error ? error.message : "unknown error";

  if (error instanceof TransportError && error.kind === "already_accepted") {
    // Resend holds this key from an earlier try, so the email went out and only
    // the answer was lost. The webhook still finds the row by its tag.
    await finish(db, row.id, {
      status: "sent",
      sent_at: now.toISOString(),
      last_error: `accepted on an earlier try: ${message}`.slice(0, 500),
    });
    return "sent";
  }

  if (error instanceof Skip) {
    await finish(db, row.id, {
      status: "failed",
      last_error: `${SKIPPED_PREFIX} ${message}`,
    });
    return "skipped";
  }

  const permanent =
    error instanceof PermanentFailure ||
    (error instanceof TransportError && error.kind === "permanent");

  if (permanent || row.attempts >= MAX_ATTEMPTS) {
    await finish(db, row.id, {
      status: "failed",
      last_error: message.slice(0, 500),
    });
    return "failed";
  }
  await finish(db, row.id, {
    status: "queued",
    last_error: message.slice(0, 500),
    next_attempt_at: new Date(
      now.getTime() + backoffMs(row.attempts),
    ).toISOString(),
  });
  return "retried";
}

async function countWaiting(db: EmailDb): Promise<number> {
  const { count, error } = await db
    .from("email_logs")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

function isTooOld(row: EmailLogRow, now: Date): boolean {
  if (row.template_key === "booking_confirmation") return false;
  const { notBefore } = (row.payload ?? {}) as { notBefore?: unknown };
  const start = Math.max(
    Date.parse(row.created_at),
    typeof notBefore === "string" ? Date.parse(notBefore) : 0,
  );
  return now.getTime() - start > MAX_AGE_MS;
}

/** Sends what is due. Safe to run at any time, as often as you like. */
export async function processQueue(
  options: WorkerOptions,
): Promise<WorkerResult> {
  const { db, transport, onlyIds } = options;
  const clock = options.now ?? (() => new Date());
  const result: WorkerResult = {
    status: "ok",
    claimed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
    waiting: 0,
  };

  if (!transport) {
    // Nothing is claimed, so no attempt is used up while Resend is not set up.
    result.status = "not_configured";
    result.waiting = await countWaiting(db);
    console.warn(
      `email: no transport (RESEND_API_KEY missing), ${result.waiting} queued`,
    );
    return result;
  }

  const candidates = await findDue(
    db,
    clock(),
    options.limit ?? DEFAULT_BATCH,
    onlyIds,
  );
  if (candidates.length === 0) return result;
  const settings = await loadEmailSettings(db);

  for (const candidate of candidates) {
    const row = await claimRow(db, candidate, clock());
    if (!row) continue;
    result.claimed += 1;

    // Attempts are counted on claim, so a row that kills the worker also ends.
    if (candidate.status === "sending" && row.attempts > MAX_ATTEMPTS) {
      await finish(db, row.id, {
        status: "failed",
        last_error: "worker stopped during sending, too many times",
      });
      result.failed += 1;
      continue;
    }

    if (isTooOld(row, clock())) {
      await finish(db, row.id, {
        status: "failed",
        last_error: `${SKIPPED_PREFIX} too old to send`,
      });
      result.skipped += 1;
      continue;
    }

    try {
      const id = await deliver(
        { ...options, transport },
        row,
        settings,
        clock(),
      );
      await recordSent(db, row.id, id, clock());
      result.sent += 1;
    } catch (error) {
      if (error instanceof TransportError && error.kind === "config") {
        // Every row would fail the same way. Give this one its try back, stop,
        // and let the run report it, so a bad key costs no email.
        await finish(db, row.id, {
          status: "queued",
          attempts: row.attempts - 1,
          next_attempt_at: clock().toISOString(),
          last_error: error.message.slice(0, 500),
        });
        result.claimed -= 1;
        result.status = "config_error";
        result.configError = error.message;
        console.error(`EMAIL STOPPED, check the Resend key: ${error.message}`);
        break;
      }
      result[await handleFailure(db, row, error, clock())] += 1;
    }
  }
  return result;
}
