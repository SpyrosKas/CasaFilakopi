import { createHash, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Checks `Authorization: Bearer <CRON_SECRET>`, the header Vercel Cron sends
 * and pg_net can send. Hashing first gives equal lengths, so the comparison
 * leaks nothing about length either. No secret set means nobody gets in.
 */
export function isCronAuthorized(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return false;
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}
