import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { Database, Json } from "@/lib/db/types";
import {
  queueEmailWith,
  type EmailData,
  type EmailType,
  type QueueOptions,
  type QueueResult,
} from "@/lib/email/queue";

/** A secret-key client. Everything in lib/payments runs on the server. */
export type PayDb = SupabaseClient<Database>;

/**
 * What the payment code needs from the outside world. Passed in, so the same
 * code runs under real routes and under tests with a local fake Stripe.
 */
export interface PaymentDeps {
  db: PayDb;
  /** Null until the three Stripe keys are set. */
  stripe: Stripe | null;
  webhookSecret?: string;
  guestTokenSecret?: string;
  siteUrl: string;
  now: () => Date;
  /** Test only: a room of the test's own. Otherwise the one active house. */
  roomId?: string;
  /** Email rows queued during this request, for kickEmails in after(). */
  queued: string[];
}

export class PaymentsClosedError extends Error {
  constructor() {
    super("payments_closed");
    this.name = "PaymentsClosedError";
  }
}

export function requireStripe(deps: PaymentDeps): Stripe {
  if (!deps.stripe) throw new PaymentsClosedError();
  return deps.stripe;
}

/** The message a database function raised. */
export const dbCode = (error: unknown): string =>
  typeof (error as { message?: unknown } | null)?.message === "string"
    ? (error as { message: string }).message
    : "unknown";

/** Throws on failure with the database's own message, and returns the data. */
export async function rpc<T = Json>(
  deps: PaymentDeps,
  fn: string,
  args: Record<string, unknown>,
): Promise<T> {
  const client = deps.db as unknown as {
    rpc(
      name: string,
      params: unknown,
    ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Queues and remembers the row, so the route can send it straight away. */
export async function queue<T extends EmailType>(
  deps: PaymentDeps,
  type: T,
  data: EmailData<T>,
  options?: QueueOptions,
): Promise<QueueResult> {
  const result = await queueEmailWith(deps.db, type, data, options);
  if (result.ok) deps.queued.push(...result.ids);
  return result;
}
