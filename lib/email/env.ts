import { z } from "zod";

// Kept apart from lib/env.server.ts on purpose. That schema runs on every
// database call, so a missing email secret there would take bookings down.
// Here it stops only what needs the secret: cron refuses to run, and checkout
// refuses to issue a token. Each says why in the log.

const MIN_SECRET_LENGTH = 32;

const productionSchema = z.object({
  CRON_SECRET: z.string().min(MIN_SECRET_LENGTH),
  GUEST_TOKEN_SECRET: z.string().min(MIN_SECRET_LENGTH),
});

interface SecretEnv {
  NODE_ENV?: string;
  CRON_SECRET?: string;
  GUEST_TOKEN_SECRET?: string;
}

export interface EmailSecrets {
  cronSecret?: string;
  guestTokenSecret?: string;
}

/** Outside production anything goes. In production a weak secret counts as none. */
export function emailSecrets(env: SecretEnv = process.env): EmailSecrets {
  const { CRON_SECRET, GUEST_TOKEN_SECRET } = env;
  if (env.NODE_ENV !== "production") {
    return { cronSecret: CRON_SECRET, guestTokenSecret: GUEST_TOKEN_SECRET };
  }

  const parsed = productionSchema.safeParse(env);
  if (parsed.success) {
    return { cronSecret: CRON_SECRET, guestTokenSecret: GUEST_TOKEN_SECRET };
  }
  const bad = new Set(parsed.error.issues.map((issue) => issue.path[0]));
  for (const name of bad) {
    console.error(
      `${String(name)} is missing or under ${MIN_SECRET_LENGTH} characters`,
    );
  }
  return {
    cronSecret: bad.has("CRON_SECRET") ? undefined : CRON_SECRET,
    guestTokenSecret: bad.has("GUEST_TOKEN_SECRET")
      ? undefined
      : GUEST_TOKEN_SECRET,
  };
}
