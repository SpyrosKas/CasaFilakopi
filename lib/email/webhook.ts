import { Resend } from "resend";
import { findTemplate } from "@/emails/registry";
import type { EmailDb } from "./db";
import { queueEmailWith } from "./queue";

// Delivery events from Resend (EML-08).

/** Only verification is used, and it takes no API key. */
const verifier = new Resend("re_webhook_verification_only");

export interface SignatureHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/**
 * Null unless the signature matches the exact bytes received and the timestamp
 * is fresh. Resend signs through Svix, so the headers are svix-*; the checking
 * library expects them by their Standard Webhooks names.
 */
export function verifyEvent(
  rawBody: string,
  headers: SignatureHeaders,
  secret: string,
): unknown {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return null;
  try {
    return verifier.webhooks.verify({
      payload: rawBody,
      headers: { id, timestamp, signature },
      webhookSecret: secret,
    });
  } catch {
    return null;
  }
}

interface EmailEvent {
  type?: string;
  data?: {
    email_id?: string;
    tags?: Record<string, string>;
    bounce?: { message?: string };
    failed?: { reason?: string };
    suppressed?: { message?: string };
  };
}

type Target = "delivered" | "bounced" | "failed";

/** Where each event may land. A replay or a late event matches no row. */
const TRANSITIONS: Record<string, { to: Target; from: string[] }> = {
  "email.delivered": { to: "delivered", from: ["sending", "sent"] },
  "email.bounced": {
    to: "bounced",
    from: ["sending", "sent", "delivered"],
  },
  "email.suppressed": { to: "bounced", from: ["sending", "sent"] },
  "email.failed": { to: "failed", from: ["sending", "sent"] },
};

const UUID = /^[0-9a-f-]{36}$/i;

export type WebhookOutcome = "updated" | "unchanged" | "ignored";

/**
 * Safe to receive any number of times, in any order. An event for a row we do
 * not have returns "ignored": every webhook endpoint on a Resend account hears
 * every environment's emails, so staging sees production's events.
 */
export async function applyEvent(
  db: EmailDb,
  event: EmailEvent,
): Promise<WebhookOutcome> {
  const transition = event.type ? TRANSITIONS[event.type] : undefined;
  const resendId = event.data?.email_id;
  if (!transition || !resendId) return "ignored";

  const { data, error } = await db
    .from("email_logs")
    .select("id, status")
    .eq("resend_id", resendId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  // The event can arrive before the worker has stored Resend's id.
  const tagged = event.data?.tags?.email_log_id;
  const logId = data?.id ?? (tagged && UUID.test(tagged) ? tagged : null);
  if (!logId) return "ignored";

  const detail =
    event.data?.bounce?.message ??
    event.data?.failed?.reason ??
    event.data?.suppressed?.message;

  const { data: updated, error: updateError } = await db
    .from("email_logs")
    .update({
      status: transition.to,
      ...(detail ? { last_error: detail.slice(0, 500) } : {}),
    })
    .eq("id", logId)
    .in("status", transition.from)
    .select("template_key, recipient, booking_id");
  if (updateError) throw new Error(updateError.message);

  const [row] = updated;
  if (!row) return "unchanged";
  if (transition.to !== "delivered") await tellHost(db, logId, row, detail);
  return "updated";
}

/**
 * A guest who never got their email cannot say so. Never for an email to the
 * host, which would loop, nor for an auto-reply: those go to whatever address
 * someone typed, so a wrong one is not worth a notification.
 */
async function tellHost(
  db: EmailDb,
  logId: string,
  row: { template_key: string; recipient: string; booking_id: string | null },
  reason: string | undefined,
): Promise<void> {
  const template = findTemplate(row.template_key);
  if (template?.audience === "host") return;
  if (row.template_key === "contact_auto_reply") return;

  await queueEmailWith(
    db,
    "host_email_bounced",
    {
      recipient: row.recipient,
      emailName: template?.label ?? row.template_key,
      ...(row.booking_id ? { bookingId: row.booking_id } : {}),
      ...(reason ? { reason: reason.slice(0, 500) } : {}),
    },
    { dedupeKey: `bounce:${logId}` },
  );
}
