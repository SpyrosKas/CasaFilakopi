import { alertHost } from "./alerts";
import { dbCode, requireStripe, type PaymentDeps } from "./deps";
import { applyPaidSession } from "./webhook";

// The safety net under the webhook. If Stripe took money and no event reached
// us, the guest has paid and nothing here knows. So the cron job asks Stripe
// which Sessions completed, and any paid one with no payment row goes through
// the same confirm path as a verified webhook, then the host is told. The
// answer comes from Stripe's API with the secret key, so the browser and the
// return page are still never trusted.

const LOOK_BACK_SECONDS = 3 * 24 * 60 * 60;
/** Longer than a Session lives, so a webhook on its way is left to land. */
const SETTLE_SECONDS = 35 * 60;
const STUCK_EVENT_MS = 60 * 60_000;

export interface ReconcileResult {
  sessions: number;
  recovered: number;
  failed: number;
  stuckEvents: number;
}

async function hasPayment(deps: PaymentDeps, intent: string) {
  const { data, error } = await deps.db
    .from("payments")
    .select("id")
    .eq("stripe_payment_intent_id", intent)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

async function alertStuckEvents(deps: PaymentDeps): Promise<number> {
  const before = new Date(deps.now().getTime() - STUCK_EVENT_MS).toISOString();
  const { data, error } = await deps.db
    .from("stripe_events")
    .select("id, type, error")
    .is("processed_at", null)
    .lt("received_at", before)
    .order("received_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  for (const event of data) {
    await alertHost(deps, {
      key: `stuck_event:${event.id}`,
      reason: `A Stripe event (${event.type}, ${event.id}) has not finished after an hour${event.error ? `: ${event.error.slice(0, 120)}` : ""}. Please check it.`,
    });
  }
  return data.length;
}

export async function reconcilePayments(
  deps: PaymentDeps,
): Promise<ReconcileResult> {
  const stripe = requireStripe(deps);
  const now = Math.floor(deps.now().getTime() / 1000);
  const result: ReconcileResult = {
    sessions: 0,
    recovered: 0,
    failed: 0,
    stuckEvents: 0,
  };

  for await (const session of stripe.checkout.sessions.list({
    status: "complete",
    created: { gte: now - LOOK_BACK_SECONDS },
    limit: 100,
  })) {
    result.sessions += 1;
    const bookingId = session.metadata?.booking_id;
    const intent =
      typeof session.payment_intent === "string"
        ? session.payment_intent
        : session.payment_intent?.id;
    if (!bookingId || !intent || session.payment_status !== "paid") continue;
    if (session.created > now - SETTLE_SECONDS) continue;
    if (await hasPayment(deps, intent)) continue;

    try {
      await applyPaidSession(deps, session);
      result.recovered += 1;
      await alertHost(deps, {
        key: `reconciled:${intent}`,
        bookingId,
        amountCents: session.amount_total ?? undefined,
        reason: `Stripe took this payment (${intent}) but its webhook never reached the site. The regular check picked it up and ran it now. Please check the booking, and the webhook endpoint in Stripe.`,
      });
    } catch (error) {
      result.failed += 1;
      console.error(`reconcile ${intent}: ${dbCode(error)}`);
      await alertHost(deps, {
        key: `reconcile_failed:${intent}`,
        bookingId,
        amountCents: session.amount_total ?? undefined,
        reason: `URGENT: Stripe took this payment (${intent}) but it could not be recorded here. Please check it in Stripe and in Admin.`,
      });
    }
  }

  result.stuckEvents = await alertStuckEvents(deps);
  return result;
}
