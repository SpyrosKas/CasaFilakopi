import { mailpitTransport } from "./transports/mailpit";
import { memoryTransport } from "./transports/memory";
import { resendTransport } from "./transports/resend";

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingEmail {
  /** Our email_logs id. Tagged, so webhooks can find the row. */
  logId: string;
  /** Stays the same across retries, so a lost answer cannot double-send. */
  idempotencyKey: string;
  from: { name: string; address: string };
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  attachments: OutgoingAttachment[];
}

export interface EmailTransport {
  readonly name: string;
  /** Resolves with the provider's id, or throws TransportError. */
  send(email: OutgoingEmail): Promise<{ id: string }>;
}

/**
 * What a failure means for the row:
 * - retry: try again later.
 * - permanent: this email can never go.
 * - config: our key or domain is wrong, so no email can go. Not this row's
 *   fault: the batch stops and the row keeps its attempts.
 * - already_accepted: the provider took this email on an earlier try.
 */
export type FailureKind = "retry" | "permanent" | "config" | "already_accepted";

export class TransportError extends Error {
  readonly kind: FailureKind;

  constructor(message: string, kind: FailureKind) {
    super(message);
    this.name = "TransportError";
    this.kind = kind;
  }
}

/** Sorts a provider's answer. `name` is Resend's error code. */
export function classifyFailure(
  status: number | null | undefined,
  name?: string,
): FailureKind {
  if (status === null || status === undefined) return "retry";
  if (status === 401 || status === 403) return "config";
  // Same key, different content: an earlier try got through and the email has
  // since rendered differently. Sending again would make a duplicate.
  if (name === "invalid_idempotent_request") return "already_accepted";
  if (status === 409 || status === 429 || status === 408 || status >= 500) {
    return "retry";
  }
  return "permanent";
}

interface TransportEnv {
  NODE_ENV?: string;
  RESEND_API_KEY?: string;
  EMAIL_DEV_TRANSPORT?: string;
  MAILPIT_URL?: string;
}

/**
 * One rule: a key means Resend. Without one, production has no transport, so
 * emails wait in the queue and the worker says why. A dev transport can never
 * run in production, because it would mark real guest emails as sent.
 */
export function selectTransport(
  env: TransportEnv = process.env,
): EmailTransport | null {
  if (env.RESEND_API_KEY) return resendTransport(env.RESEND_API_KEY);
  if (env.NODE_ENV === "production") return null;
  if (env.EMAIL_DEV_TRANSPORT === "memory") return memoryTransport();
  return mailpitTransport(env.MAILPIT_URL ?? "http://127.0.0.1:54324");
}
