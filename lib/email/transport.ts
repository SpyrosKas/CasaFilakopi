import { mailpitTransport } from "./transports/mailpit";
import { memoryTransport } from "./transports/memory";
import { resendTransport } from "./transports/resend";

export interface OutgoingAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface OutgoingEmail {
  /** Our email_logs id. Tagged, and the provider's idempotency key. */
  logId: string;
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

export class TransportError extends Error {
  /** False when sending the same email again cannot help. */
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "TransportError";
    this.retryable = retryable;
  }
}

/** A provider's answer, sorted into "try later" and "this will never work". */
export const isRetryableStatus = (status: number | null | undefined) =>
  status === null ||
  status === undefined ||
  status === 429 ||
  status === 408 ||
  status >= 500;

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
