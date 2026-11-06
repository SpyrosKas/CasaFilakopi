import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ABSOLUTE_TIMEOUT_SECONDS,
  ACTIVITY_WRITE_INTERVAL_SECONDS,
  ENROL_MAX_SESSION_AGE_SECONDS,
  IDLE_TIMEOUT_SECONDS,
} from "@/lib/admin/config";

// Session timeout (ADM-01). The app keeps a signed last-activity cookie, bound
// to the session, so timeouts work on any Supabase plan. The signature means a
// stolen session cannot be kept alive by editing the cookie.

/** Keys one purpose from the server secret. Never sent to the browser. */
export function deriveKey(secret: string, purpose: string): string {
  return createHmac("sha256", secret).update(purpose).digest("hex");
}

/** How a lockout key is stored, so no email or address is readable. */
export function attemptHash(secret: string, value: string): string {
  return createHmac("sha256", deriveKey(secret, "admin-attempts-v1"))
    .update(value)
    .digest("hex");
}

export function createDeviceValue(email: string, secret: string): string {
  return createHmac("sha256", deriveKey(secret, "admin-device-v1"))
    .update(email)
    .digest("base64url");
}

export function isKnownDevice(
  value: string | undefined,
  email: string,
  secret: string,
): boolean {
  if (!value) return false;
  const given = Buffer.from(value);
  const expected = Buffer.from(createDeviceValue(email, secret));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether the password was typed recently enough to add a second factor. */
export function isFreshSignIn(signedInAt: number | null, now: number): boolean {
  return (
    signedInAt !== null && now - signedInAt <= ENROL_MAX_SESSION_AGE_SECONDS
  );
}

function sign(sessionId: string, seconds: number, secret: string): string {
  return createHmac("sha256", deriveKey(secret, "admin-activity-v1"))
    .update(`${sessionId}.${seconds}`)
    .digest("base64url");
}

export function createActivityValue(
  sessionId: string,
  nowSeconds: number,
  secret: string,
): string {
  return `${nowSeconds}.${sign(sessionId, nowSeconds, secret)}`;
}

/** When the cookie says this session was last active, if it can be trusted. */
export function readActivityValue(
  value: string | undefined,
  sessionId: string,
  secret: string,
): number | null {
  const match = value ? /^(\d{1,12})\.([\w-]+)$/.exec(value) : null;
  if (!match) return null;
  const seconds = Number(match[1]);
  const given = Buffer.from(match[2]);
  const expected = Buffer.from(sign(sessionId, seconds, secret));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? seconds : null;
}

export type ActivityCheck = "fresh" | "write" | "expired";

export function checkActivity(input: {
  lastActive: number | null;
  signedInAt: number | null;
  now: number;
}): ActivityCheck {
  const { lastActive, signedInAt, now } = input;
  if (lastActive === null || signedInAt === null) return "expired";
  if (now - signedInAt > ABSOLUTE_TIMEOUT_SECONDS) return "expired";
  if (now - lastActive > IDLE_TIMEOUT_SECONDS) return "expired";
  return now - lastActive >= ACTIVITY_WRITE_INTERVAL_SECONDS
    ? "write"
    : "fresh";
}
