import { describe, expect, it } from "vitest";
import {
  attemptHash,
  checkActivity,
  createActivityValue,
  createDeviceValue,
  isFreshSignIn,
  isKnownDevice,
  readActivityValue,
} from "@/lib/admin/activity";
import { pickClientAddress } from "@/lib/admin/client-address";
import { readClaims } from "@/lib/admin/claims";
import {
  ABSOLUTE_TIMEOUT_SECONDS,
  ATTEMPT_LIMITS,
  ENROL_MAX_SESSION_AGE_SECONDS,
  IDLE_TIMEOUT_SECONDS,
} from "@/lib/admin/config";
import { securityHeaders } from "@/lib/admin/headers";
import {
  bookingSettingsErrors,
  bookingSettingsSchema,
  houseSchema,
  loginSchema,
  mfaVerifySchema,
  newPasswordSchema,
  propertySchema,
} from "@/lib/admin/schemas";

const SECRET = "test-secret";
const SESSION = "11111111-1111-4111-8111-111111111111";
const NOW = 1_800_000_000;

describe("activity cookie", () => {
  it("reads back the time it was written", () => {
    const value = createActivityValue(SESSION, NOW, SECRET);
    expect(readActivityValue(value, SESSION, SECRET)).toBe(NOW);
  });

  it("rejects an edited time", () => {
    const [, signature] = createActivityValue(SESSION, NOW, SECRET).split(".");
    const edited = `${NOW + 3600}.${signature}`;
    expect(readActivityValue(edited, SESSION, SECRET)).toBeNull();
  });

  it("rejects a cookie from another session", () => {
    const value = createActivityValue(SESSION, NOW, SECRET);
    expect(readActivityValue(value, "other", SECRET)).toBeNull();
  });

  it("rejects a cookie signed with another secret", () => {
    const value = createActivityValue(SESSION, NOW, "another");
    expect(readActivityValue(value, SESSION, SECRET)).toBeNull();
  });

  it("rejects junk and a missing cookie", () => {
    expect(readActivityValue("junk", SESSION, SECRET)).toBeNull();
    expect(readActivityValue(undefined, SESSION, SECRET)).toBeNull();
  });
});

describe("session timeout", () => {
  const signedInAt = NOW - 100;

  it("keeps an active session", () => {
    expect(checkActivity({ lastActive: NOW - 5, signedInAt, now: NOW })).toBe(
      "fresh",
    );
  });

  it("asks for a rewrite once a minute", () => {
    expect(checkActivity({ lastActive: NOW - 90, signedInAt, now: NOW })).toBe(
      "write",
    );
  });

  it("ends a session left idle", () => {
    const lastActive = NOW - IDLE_TIMEOUT_SECONDS - 1;
    expect(checkActivity({ lastActive, signedInAt, now: NOW })).toBe("expired");
  });

  it("ends an active session at the absolute limit", () => {
    expect(
      checkActivity({
        lastActive: NOW,
        signedInAt: NOW - ABSOLUTE_TIMEOUT_SECONDS - 1,
        now: NOW,
      }),
    ).toBe("expired");
  });

  it("treats a missing or untrusted cookie as expired", () => {
    expect(checkActivity({ lastActive: null, signedInAt, now: NOW })).toBe(
      "expired",
    );
    expect(checkActivity({ lastActive: NOW, signedInAt: null, now: NOW })).toBe(
      "expired",
    );
  });
});

describe("adding a second factor", () => {
  it("needs a recent password", () => {
    const age = ENROL_MAX_SESSION_AGE_SECONDS;
    expect(isFreshSignIn(NOW - age, NOW)).toBe(true);
    expect(isFreshSignIn(NOW - age - 1, NOW)).toBe(false);
    expect(isFreshSignIn(null, NOW)).toBe(false);
  });
});

describe("known device cookie", () => {
  it("is tied to the email and the secret", () => {
    const value = createDeviceValue("a@b.test", SECRET);
    expect(isKnownDevice(value, "a@b.test", SECRET)).toBe(true);
    expect(isKnownDevice(value, "c@d.test", SECRET)).toBe(false);
    expect(isKnownDevice(value, "a@b.test", "another")).toBe(false);
    expect(isKnownDevice("junk", "a@b.test", SECRET)).toBe(false);
    expect(isKnownDevice(undefined, "a@b.test", SECRET)).toBe(false);
  });
});

describe("lockout limits", () => {
  it("keeps the email ceiling out of reach of one address", () => {
    expect(ATTEMPT_LIMITS.login_email).toBeGreaterThan(ATTEMPT_LIMITS.login_ip);
    expect(ATTEMPT_LIMITS.reset_email).toBeGreaterThan(
      ATTEMPT_LIMITS.reset_pair,
    );
  });

  it("hashes so that no value can be read back", () => {
    const hash = attemptHash(SECRET, "a@b.test");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toBe(attemptHash("another", "a@b.test"));
  });
});

describe("client address", () => {
  const from =
    (headers: Record<string, string>) =>
    (name: string): string | undefined =>
      headers[name];

  it("trusts Vercel's header on Vercel, over anything else", () => {
    const headers = from({
      "x-vercel-forwarded-for": "203.0.113.9",
      "x-forwarded-for": "1.1.1.1",
    });
    expect(pickClientAddress(headers, true)).toBe("203.0.113.9");
  });

  it("ignores that header off Vercel, where anyone can send it", () => {
    const headers = from({
      "x-vercel-forwarded-for": "1.1.1.1",
      "x-forwarded-for": "203.0.113.9",
    });
    expect(pickClientAddress(headers, false)).toBe("203.0.113.9");
  });

  it("takes the last x-forwarded-for hop, which our proxy wrote", () => {
    const headers = from({
      "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9",
    });
    expect(pickClientAddress(headers, false)).toBe("203.0.113.9");
  });

  it("has a fallback, and ignores x-real-ip", () => {
    expect(pickClientAddress(from({}), false)).toBe("unknown");
    expect(pickClientAddress(from({ "x-real-ip": "6.6.6.6" }), false)).toBe(
      "unknown",
    );
  });
});

describe("security headers", () => {
  const url = "https://abc.supabase.co/rest";

  it("allows what the app needs and nothing more in production", () => {
    const csp = securityHeaders(url, false)["Content-Security-Policy"];
    expect(csp).toContain("connect-src 'self' https://abc.supabase.co;");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(csp).toContain("object-src 'none'");
  });

  it("adds only what hot reload needs in development", () => {
    const csp = securityHeaders(url, true)["Content-Security-Policy"];
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("ws:");
  });
});

describe("token claims", () => {
  const token = (payload: unknown) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

  it("reads the level, session and first sign-in time", () => {
    const claims = readClaims(
      token({
        sub: "user-1",
        session_id: SESSION,
        aal: "aal2",
        amr: [
          { method: "totp", timestamp: 200 },
          { method: "password", timestamp: 100 },
        ],
      }),
    );
    expect(claims).toEqual({
      userId: "user-1",
      sessionId: SESSION,
      aal: "aal2",
      methods: ["totp", "password"],
      signedInAt: 100,
    });
  });

  it("returns nothing usable for a bad token", () => {
    expect(readClaims("not-a-token")).toEqual({
      userId: null,
      sessionId: null,
      aal: null,
      methods: [],
      signedInAt: null,
    });
  });
});

describe("form validation", () => {
  const house = {
    name_en: "Casa",
    name_el: "Casa",
    description_en: "",
    description_el: "",
    max_adults: "4",
    max_children: "2",
    base_occupancy: "2",
  };
  const booking = {
    holdMinutes: "35",
    sameDayCutoffHour: "12",
    horizonMonths: "18",
    minStayNights: "1",
    maxStayNights: "30",
  };

  it("normalises the login email", () => {
    const parsed = loginSchema.parse({ email: " A@B.test ", password: "x" });
    expect(parsed.email).toBe("a@b.test");
  });

  it("uses the domain's limit for the hold: 30 refused, 31 allowed", () => {
    const stored = { checkoutSessionMinutes: 30 };
    const settings = (holdMinutes: string) => ({
      ...stored,
      ...bookingSettingsSchema.parse({ ...booking, holdMinutes }),
    });
    expect(bookingSettingsErrors(settings("30"))?.holdMinutes).toMatch(/31/);
    expect(bookingSettingsErrors(settings("31"))).toBeNull();
  });

  it("accepts the domain's cutoff of 24, and nothing past it", () => {
    const at = (sameDayCutoffHour: string) =>
      bookingSettingsSchema.safeParse({ ...booking, sameDayCutoffHour });
    expect(at("24").success).toBe(true);
    expect(at("25").success).toBe(false);
  });

  it("refuses zero months through the domain", () => {
    const value = {
      checkoutSessionMinutes: 30,
      ...bookingSettingsSchema.parse({ ...booking, horizonMonths: "0" }),
    };
    expect(bookingSettingsErrors(value)?.horizonMonths).toBeTruthy();
  });

  it("refuses a hold that is not a whole number", () => {
    for (const holdMinutes of ["31.5", "abc", "", "-40"]) {
      const input = { ...booking, holdMinutes };
      expect(bookingSettingsSchema.safeParse(input).success).toBe(false);
    }
  });

  it("refuses more guests in the price than can stay", () => {
    expect(houseSchema.safeParse(house).success).toBe(true);
    const tooMany = { ...house, base_occupancy: "7" };
    expect(houseSchema.safeParse(tooMany).success).toBe(false);
  });

  it("refuses a house with no adults", () => {
    const empty = { ...house, max_adults: "0" };
    expect(houseSchema.safeParse(empty).success).toBe(false);
  });

  it("refuses social links that are not https", () => {
    const property = {
      name: "Casa",
      legal_name: "",
      address: "",
      phone: "",
      email: "",
      registration_number: "",
      check_in_time: "15:00",
      check_out_time: "11:00",
      instagram: "",
      facebook: "",
    };
    expect(propertySchema.safeParse(property).success).toBe(true);
    const unsafe = { ...property, instagram: "javascript:alert(1)" };
    expect(propertySchema.safeParse(unsafe).success).toBe(false);
  });

  it("requires a long password typed twice", () => {
    const good = "a long enough password";
    expect(
      newPasswordSchema.safeParse({ password: good, confirm: good }).success,
    ).toBe(true);
    expect(
      newPasswordSchema.safeParse({ password: "short", confirm: "short" })
        .success,
    ).toBe(false);
    expect(
      newPasswordSchema.safeParse({ password: good, confirm: "different" })
        .success,
    ).toBe(false);
  });

  it("only allows the one known place to go after a code", () => {
    const code = "123456";
    expect(mfaVerifySchema.safeParse({ code, next: "password" }).success).toBe(
      true,
    );
    expect(
      mfaVerifySchema.safeParse({ code, next: "https://evil.test" }).success,
    ).toBe(false);
  });
});
