import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * True only for `Authorization: Bearer <CRON_SECRET>`. Both sides are hashed
 * first, because timingSafeEqual needs equal lengths and a length check would
 * itself leak. With no secret set, nothing is allowed.
 */
export function isCronAuthorised(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
