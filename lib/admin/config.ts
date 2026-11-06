// Session and lockout limits for the admin panel. Changing them needs no
// database change.

/** Signed out after this long with no page visit or save. */
export const IDLE_TIMEOUT_SECONDS = 60 * 60;
/** Signed out this long after signing in, even if still active. */
export const ABSOLUTE_TIMEOUT_SECONDS = 12 * 60 * 60;
/** The activity cookie is rewritten at most this often. */
export const ACTIVITY_WRITE_INTERVAL_SECONDS = 60;

export const ACTIVITY_COOKIE = "cf_admin_activity";

/**
 * The browser never needs these cookies: every Supabase call in the admin
 * panel runs on the server. Lax, not Strict, because a link in a reset email
 * has to carry the sign-in verifier cookie back.
 */
export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: ABSOLUTE_TIMEOUT_SECONDS,
} as const;

export const LOCK_WINDOW_MINUTES = 15;

export const ATTEMPT_LIMITS = {
  /** Wrong passwords for one email address. */
  login_email: 5,
  /** Wrong passwords from one network address, across all emails. */
  login_ip: 20,
  /** Wrong authenticator codes for one user. */
  mfa_user: 5,
  /** Reset emails asked for, per email address. */
  reset_email: 3,
} as const;

export type AttemptKind = keyof typeof ATTEMPT_LIMITS;

/** Answers take at least this long, so timing does not reveal an account. */
export const LOGIN_MIN_MS = 700;
export const RESET_MIN_MS = 1500;

export const MIN_PASSWORD_LENGTH = 12;

/** A Stripe Checkout Session lives at least 30 minutes (hold_too_short). */
export const MIN_HOLD_MINUTES = 31;

/** Paths that work with no session at all. */
export const PUBLIC_ADMIN_PATHS = [
  "/admin/login",
  "/admin/forgot-password",
  "/admin/auth/confirm",
];
