import "server-only";
import Stripe from "stripe";
import { createAdminClient } from "@/lib/db/admin";
import { getPublicEnv } from "@/lib/env";
import { emailSecrets } from "@/lib/email/env";
import type { PaymentDeps } from "./deps";
import { readStripeSettings } from "./env";

// The real wiring. Routes call this once per request. Tests build their own
// PaymentDeps with a client pointing at the fake server.

function createStripe(): {
  stripe: Stripe | null;
  webhookSecret?: string;
} {
  const settings = readStripeSettings();
  if (!settings) return { stripe: null };
  return {
    webhookSecret: settings.webhookSecret,
    stripe: new Stripe(settings.secretKey, {
      // Repeats use the same idempotency key, so they are safe for money.
      maxNetworkRetries: 2,
      timeout: 20_000,
      telemetry: false,
      ...settings.api,
    }),
  };
}

export function paymentDeps(): PaymentDeps {
  const testRoom =
    process.env.NODE_ENV !== "production"
      ? process.env.PAY_TEST_ROOM_ID
      : undefined;
  return {
    db: createAdminClient(),
    ...createStripe(),
    guestTokenSecret: emailSecrets().guestTokenSecret,
    siteUrl: getPublicEnv().NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""),
    now: () => new Date(),
    queued: [],
    ...(testRoom ? { roomId: testRoom } : {}),
  };
}
