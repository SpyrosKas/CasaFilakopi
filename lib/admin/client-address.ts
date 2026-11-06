/**
 * The caller's address, for rate limits. Only values a trusted proxy wrote
 * count, because a browser can send any header it likes.
 *
 * - On Vercel, x-vercel-forwarded-for is set by the platform. Off Vercel the
 *   same header is plain client input, so it is ignored.
 * - Elsewhere each proxy appends to x-forwarded-for, so only the last hop was
 *   written by our own proxy. Hops to its left came from the caller.
 */
export function pickClientAddress(
  header: (name: string) => string | null | undefined,
  onVercel: boolean,
): string {
  const lastHop = (value: string | null | undefined) =>
    value?.split(",").at(-1)?.trim();

  const trusted = onVercel ? lastHop(header("x-vercel-forwarded-for")) : null;
  return trusted || lastHop(header("x-forwarded-for")) || "unknown";
}

/** One email from one address. The hard lock uses this. */
export const emailAtAddress = (email: string, address: string) =>
  `${email}|${address}`;
