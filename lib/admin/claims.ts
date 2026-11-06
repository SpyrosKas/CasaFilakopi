// Reads the claims of an access token the auth server has already accepted.
// This does not verify anything: call getUser with the token first.

export interface AdminClaims {
  sessionId: string | null;
  aal: string | null;
  /** Sign-in methods used in this session. */
  methods: string[];
  /** When this session first signed in, in seconds. */
  signedInAt: number | null;
}

interface RawClaims {
  session_id?: unknown;
  aal?: unknown;
  amr?: unknown;
}

export function readClaims(accessToken: string): AdminClaims {
  let raw: RawClaims = {};
  try {
    const payload = accessToken.split(".")[1] ?? "";
    raw = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    // Treated below as a token with no claims, which fails every check.
  }

  const entries = Array.isArray(raw.amr)
    ? raw.amr.filter(
        (e): e is { method: string; timestamp: number } =>
          typeof e?.method === "string" && typeof e?.timestamp === "number",
      )
    : [];

  return {
    sessionId: typeof raw.session_id === "string" ? raw.session_id : null,
    aal: typeof raw.aal === "string" ? raw.aal : null,
    methods: entries.map((e) => e.method),
    signedInAt: entries.length
      ? Math.min(...entries.map((e) => e.timestamp))
      : null,
  };
}
