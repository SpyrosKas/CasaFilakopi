// Stripe settings from the environment. Nothing here touches the network, so
// the site builds and runs with no Stripe account: the booking pages then show
// prices and dates, and checkout says how to reach Yorgos instead.

export interface StripeSettings {
  secretKey: string;
  webhookSecret: string;
  publishableKey: string;
  /** Only ever set for the local fake server. Never honoured in production. */
  api?: { host: string; port: number; protocol: "http" | "https" };
}

type Env = Record<string, string | undefined>;

/** Same rule as turnstileMode, without its logging: see lib/email/contact.ts. */
export function turnstileReady(env: Env = process.env): boolean {
  const hasSite = !!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const hasSecret = !!env.TURNSTILE_SECRET_KEY;
  if (hasSite || hasSecret) return hasSite && hasSecret;
  return env.NODE_ENV !== "production";
}

const mode = (key: string) => (/_live_/.test(key) ? "live" : "test");

/** Null means checkout is closed. Half a setup also counts as closed. */
export function readStripeSettings(
  env: Env = process.env,
): StripeSettings | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const publishableKey = env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!secretKey || !webhookSecret || !publishableKey) {
    if (secretKey || webhookSecret || publishableKey) {
      console.error("Stripe is half set up: all three keys are needed");
    }
    return null;
  }
  // A test key beside a live key would take payments that never confirm.
  if (mode(secretKey) !== mode(publishableKey)) {
    console.error(
      "Stripe keys are from different modes: checkout stays closed",
    );
    return null;
  }

  const host = env.STRIPE_API_HOST?.trim();
  const useFake = host && env.NODE_ENV !== "production";
  return {
    secretKey,
    webhookSecret,
    publishableKey,
    ...(useFake
      ? {
          api: {
            host,
            port: Number(env.STRIPE_API_PORT ?? 443),
            protocol: env.STRIPE_API_PROTOCOL === "http" ? "http" : "https",
          },
        }
      : {}),
  };
}
