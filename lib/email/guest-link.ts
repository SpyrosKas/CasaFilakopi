import { createHash, createHmac } from "node:crypto";
import type { EmailLocale } from "@/emails/types";
import { addDays } from "@/lib/domain/dates";
import type { EmailDb } from "./db";

// How an email carries a guest's private link, when the raw token is stored
// nowhere (bookings keeps only its hash, email_logs never holds it).
//
// The token is computed, not kept: HMAC(GUEST_TOKEN_SECRET, booking id). The
// worker recomputes it at send time. The secret lives only in the server's
// environment, so staff reading email_logs, or anyone with a database dump,
// still cannot build a link.
//
// PAY calls issueGuestToken right after create_hold, because the id does not
// exist until then. Its hash then matches what booking_for_token looks up.

/** Where the guest booking page lives. PAY builds the page at this path. */
export const guestBookingPath = (locale: EmailLocale, token: string) =>
  `/${locale}/booking/${token}`;

/** A link keeps working for a while after the stay, for receipts and refunds. */
const LINK_DAYS_AFTER_CHECK_OUT = 30;

const linkExpiry = (checkOut: string) =>
  `${addDays(checkOut, LINK_DAYS_AFTER_CHECK_OUT)}T00:00:00Z`;

export function deriveGuestToken(secret: string, bookingId: string): string {
  return createHmac("sha256", secret)
    .update(`guest-link-v1:${bookingId}`)
    .digest("base64url");
}

/** Same as booking_for_token: sha256 of the token's UTF-8 bytes, in hex. */
export const hashGuestToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Points the booking at its computed token and returns the raw token for the
 * redirect after checkout. Safe to repeat. Throws if the secret is missing, so
 * a misconfigured site fails at checkout rather than sending dead links.
 */
export async function issueGuestToken(
  db: EmailDb,
  bookingId: string,
  secret: string | undefined,
): Promise<string> {
  if (!secret) throw new Error("GUEST_TOKEN_SECRET is not set");
  const token = deriveGuestToken(secret, bookingId);

  const { data: booking, error: readError } = await db
    .from("bookings")
    .select("check_out, access_token_expires_at")
    .eq("id", bookingId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!booking) throw new Error("booking_not_found");

  // Never shortens a later expiry that create_hold was given.
  const stayExpiry = linkExpiry(booking.check_out);
  const stored = booking.access_token_expires_at;
  const keepStored = stored && Date.parse(stored) > Date.parse(stayExpiry);

  const { error } = await db
    .from("bookings")
    .update({
      access_token_hash: hashGuestToken(token),
      access_token_expires_at: keepStored ? stored : stayExpiry,
    })
    .eq("id", bookingId);
  if (error) throw new Error(error.message);
  return token;
}

interface LinkBooking {
  id: string;
  locale: string;
  check_out: string;
  access_token_hash: string | null;
  access_token_expires_at: string | null;
}

export interface GuestLinkEnv {
  siteUrl: string;
  guestTokenSecret?: string;
}

/**
 * The link for one email, or null if none can be built. Runs at send time, and
 * the result only ever goes into the rendered email, never back into a row.
 */
export async function resolveGuestLink(
  db: EmailDb,
  booking: LinkBooking,
  env: GuestLinkEnv,
  now: Date,
): Promise<string | null> {
  if (!env.guestTokenSecret) return null;
  const token = deriveGuestToken(env.guestTokenSecret, booking.id);
  const hash = hashGuestToken(token);
  let expiresAt = booking.access_token_expires_at;

  if (booking.access_token_hash === null) {
    // A manual booking starts with no token, so there is none to disturb.
    expiresAt ??= linkExpiry(booking.check_out);
    const { error } = await db
      .from("bookings")
      .update({ access_token_hash: hash, access_token_expires_at: expiresAt })
      .eq("id", booking.id)
      .is("access_token_hash", null);
    if (error) throw new Error(error.message);
  } else if (booking.access_token_hash !== hash) {
    // Made with some other token. Replacing it would kill a live link.
    console.warn(`booking ${booking.id}: token hash is not ours, no link`);
    return null;
  }

  if (!expiresAt || Date.parse(expiresAt) <= now.getTime()) return null;
  const locale = booking.locale === "el" ? "el" : "en";
  return new URL(guestBookingPath(locale, token), env.siteUrl).toString();
}
