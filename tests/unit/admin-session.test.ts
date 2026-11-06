import { describe, expect, it } from "vitest";
import {
  checkActivity,
  createActivityValue,
  readActivityValue,
} from "@/lib/admin/activity";
import { readClaims } from "@/lib/admin/claims";
import {
  ABSOLUTE_TIMEOUT_SECONDS,
  IDLE_TIMEOUT_SECONDS,
} from "@/lib/admin/config";
import {
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

describe("token claims", () => {
  const token = (payload: unknown) =>
    `h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.s`;

  it("reads the level, session and first sign-in time", () => {
    const claims = readClaims(
      token({
        session_id: SESSION,
        aal: "aal2",
        amr: [
          { method: "totp", timestamp: 200 },
          { method: "password", timestamp: 100 },
        ],
      }),
    );
    expect(claims).toEqual({
      sessionId: SESSION,
      aal: "aal2",
      methods: ["totp", "password"],
      signedInAt: 100,
    });
  });

  it("returns nothing usable for a bad token", () => {
    expect(readClaims("not-a-token")).toEqual({
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
  };

  it("normalises the login email", () => {
    const parsed = loginSchema.parse({ email: " A@B.test ", password: "x" });
    expect(parsed.email).toBe("a@b.test");
  });

  it("refuses a hold of 30 minutes and allows 31", () => {
    const short = { ...booking, holdMinutes: "30" };
    expect(bookingSettingsSchema.safeParse(short).success).toBe(false);
    const ok = { ...booking, holdMinutes: "31" };
    expect(bookingSettingsSchema.parse(ok).holdMinutes).toBe(31);
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
