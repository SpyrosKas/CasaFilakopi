import { z } from "zod";

// The contact form's rules (CNT-01, CNT-04). No framework imports, so the
// browser form can share the limits and the route stays easy to test.

export const CONTACT_POLICY_VERSION = "draft-1";

/** A value that could become a mail header stays on one line. */
const oneLine = (value: string) => !/[\r\n\0]/.test(value);

/** The name is echoed in the auto-reply, so it must not carry a link. */
const noLink = (value: string) => !/:\/\/|www\./i.test(value);

export const contactSchema = z.strictObject({
  name: z.string().trim().min(1).max(100).refine(oneLine).refine(noLink),
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

/**
 * Enforced as soon as the secret is set, and skipped before that. Fails closed:
 * if Cloudflare cannot be asked, the visitor sees an error and can try again or
 * use the phone or email on the page, and nothing unverified is stored. No IP
 * is passed along, as Cloudflare does not need one.
 */
export async function verifyTurnstile(
  token: string | undefined,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) {
    console.info("contact: Turnstile not configured, check skipped");
    return true;
  }
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
