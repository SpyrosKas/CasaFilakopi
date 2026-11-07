import "server-only";
import { createAdminClient } from "@/lib/db/admin";
import { getPublicEnv } from "@/lib/env";
import { issueGuestToken as issueToken } from "./guest-link";
import {
  queueEmailWith,
  type EmailData,
  type EmailType,
  type QueueOptions,
  type QueueResult,
} from "./queue";
import { selectTransport } from "./transport";
import { processQueue, type WorkerResult } from "./worker";

// The stable API for other tracks. Import from "@/lib/email" only.
//
//   await queueEmail("booking_confirmation", { bookingId });
//   await queueEmail("payment_receipt", { bookingId, paymentId });
//   await queueEmail("booking_cancellation", { bookingId, refundCents });
//   const token = await issueGuestToken(bookingId); // right after create_hold
//
// queueEmail never throws, so it cannot break a booking or a Stripe webhook.
// EMAIL_DATA in queue.ts lists every type and the data it takes.

export { guestBookingPath } from "./guest-link";
export type {
  AttachmentRef,
  EmailData,
  EmailType,
  QueueOptions,
  QueueResult,
} from "./queue";

export function queueEmail<T extends EmailType>(
  type: T,
  data: EmailData<T>,
  options?: QueueOptions,
): Promise<QueueResult> {
  return queueEmailWith(createAdminClient(), type, data, options);
}

export const workerEnv = () => ({
  siteUrl: getPublicEnv().NEXT_PUBLIC_SITE_URL,
  guestTokenSecret: process.env.GUEST_TOKEN_SECRET,
});

/** Runs the queue now, for the cron route and the kick below. */
export function runEmailQueue(onlyIds?: string[]): Promise<WorkerResult> {
  return processQueue({
    db: createAdminClient(),
    transport: selectTransport(),
    env: workerEnv(),
    onlyIds,
  });
}

/**
 * Sends these rows without waiting for cron. Call inside next/server after(),
 * so the guest's page does not wait on the mail provider. A failure here is
 * harmless: the rows stay queued and cron picks them up.
 */
export async function kickEmails(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await runEmailQueue(ids);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`email kick failed: ${message}`);
  }
}

/** The raw token for the guest's page. Stored nowhere: see guest-link.ts. */
export function issueGuestToken(bookingId: string): Promise<string> {
  return issueToken(
    createAdminClient(),
    bookingId,
    process.env.GUEST_TOKEN_SECRET,
  );
}
