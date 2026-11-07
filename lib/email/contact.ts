import { z } from "zod";

// The contact form's rules (CNT-01, CNT-04). No framework imports, so the
// browser form can share the limits and the route stays easy to test.

export const CONTACT_POLICY_VERSION = "draft-1";

/** A value that could become a mail header stays on one line. */
const oneLine = (value: string) => !/[\r\n\0]/.test(value);

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(oneLine),
  email: z.email().max(254).refine(oneLine),
  phone: z
    .string()
    .trim()
    .max(40)
    .regex(/^[+0-9 ()./-]*$/)
    .optional(),
  dates: z.string().trim().max(120).refine(oneLine).optional(),
  message: z.string().trim().min(1).max(5000),
  locale: z.enum(["en", "el"]),
  consent: z.literal(true),
  /** Hidden from people. Anything here means a bot filled it in. */
  website: z.string().max(500).optional(),
  turnstileToken: z.string().max(2048).optional(),
});

export type ContactInput = z.output<typeof contactSchema>;

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

interface TurnstileEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

/**
 * Required in production (D28). `closed` means the form takes nothing, and the
 * visitor is pointed to the phone and email instead. Skipped only outside
 * production, and never with one key of the pair set, which is a mistake.
 */
export function turnstileMode(
  env: TurnstileEnv,
): "enforced" | "skipped" | "closed" {
  const hasSite = !!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const hasSecret = !!env.TURNSTILE_SECRET_KEY;
  if (hasSite && hasSecret) return "enforced";

  if (hasSite || hasSecret) {
    console.error(
      `CONTACT FORM CLOSED: only ${hasSite ? "the site key" : "the secret key"} of Turnstile is set`,
    );
    return "closed";
  }
  if (env.NODE_ENV === "production") {
    console.error("CONTACT FORM CLOSED: Turnstile keys are not set");
    return "closed";
  }
  console.info("contact: Turnstile not configured, check skipped");
  return "skipped";
}

/**
 * Fails closed: if Cloudflare cannot be asked, the visitor sees an error and
 * can try again or use the phone or email on the page, and nothing unverified
 * is stored. No IP is passed along, as Cloudflare does not need one.
 */
export async function verifyTurnstile(
  token: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch(SITEVERIFY, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`contact: Turnstile check failed: ${message}`);
    return false;
  }
}
