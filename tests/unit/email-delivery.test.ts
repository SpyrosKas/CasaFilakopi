import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCronAuthorised } from "@/lib/email/cron-auth";
import { emailSecrets } from "@/lib/email/env";
import {
  deriveGuestToken,
  guestBookingPath,
  hashGuestToken,
} from "@/lib/email/guest-link";
import { buildStayIcs } from "@/lib/email/ics";
import { attachmentRefs, dedupeId, EMAIL_DATA } from "@/lib/email/queue";
import { athensInstant, sendMoment } from "@/lib/email/scheduled";
import {
  DEFAULT_EMAIL_SETTINGS,
  parseEmailSettings,
} from "@/lib/email/settings";
import { selectTransport, TransportError } from "@/lib/email/transport";
import { quoteSender, resendTransport } from "@/lib/email/transports/resend";
import { verifyEvent } from "@/lib/email/webhook";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const email = {
  logId: "00000000-0000-4000-8000-000000000001",
  idempotencyKey: "email-log/00000000-0000-4000-8000-000000000001/0",
  from: { name: "Casa Filakopi", address: "bookings@mail.example.com" },
  to: "guest@example.com",
  replyTo: "host@example.com",
  subject: "Hello",
  html: "<p>Hello</p>",
  text: "Hello",
  attachments: [],
};

describe("choosing a transport", () => {
  it("uses Resend as soon as there is a key", () => {
    expect(
      selectTransport({ NODE_ENV: "production", RESEND_API_KEY: "re_x" })?.name,
    ).toBe("resend");
  });

  it("has none in production without a key, so nothing fakes a send", () => {
    expect(selectTransport({ NODE_ENV: "production" })).toBeNull();
    expect(
      selectTransport({
        NODE_ENV: "production",
        EMAIL_DEV_TRANSPORT: "memory",
      }),
    ).toBeNull();
  });

  it("uses Mailpit in development, or memory if asked", () => {
    expect(selectTransport({ NODE_ENV: "development" })?.name).toBe("mailpit");
    expect(
      selectTransport({
        NODE_ENV: "development",
        EMAIL_DEV_TRANSPORT: "memory",
      })?.name,
    ).toBe("memory");
  });
});

describe("Resend transport", () => {
  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => unknown>(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends once per row, whatever the retries, by idempotency key", async () => {
    const fetchMock = stubFetch(200, { id: "re_1" });
    await expect(resendTransport("re_x").send(email)).resolves.toEqual({
      id: "re_1",
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init.headers);
    expect(headers.get("idempotency-key")).toBe(email.idempotencyKey);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = JSON.parse(String(init.body));
    expect(sent.reply_to).toBe("host@example.com");
    expect(sent.tags).toEqual([{ name: "email_log_id", value: email.logId }]);
  });

  it.each([
    [429, "rate_limit_exceeded", "retry"],
    [500, "internal_server_error", "retry"],
    [422, "validation_error", "permanent"],
    [401, "missing_api_key", "config"],
    [403, "invalid_api_key", "config"],
    [409, "concurrent_idempotent_requests", "retry"],
    [409, "invalid_idempotent_request", "already_accepted"],
  ])("sorts a %i %s as %s", async (status, name, kind) => {
    stubFetch(status, { name, message: "no", statusCode: status });
    const failure = await resendTransport("re_x")
      .send(email)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TransportError);
    expect((failure as TransportError).kind).toBe(kind);
  });

  it("retries when the network fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const failure = await resendTransport("re_x")
      .send(email)
      .catch((error: unknown) => error);
    expect((failure as TransportError).kind).toBe("retry");
  });

  it("keeps a sender name inside its quotes", () => {
    expect(quoteSender('Casa "F"\r\nBcc: x', "a@b.gr")).toBe(
      '"Casa FBcc: x" <a@b.gr>',
    );
  });
});

describe("webhook signature", () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  const body = JSON.stringify({
    type: "email.delivered",
    data: { email_id: "re_1" },
  });

  /** Signed here by hand, so the test does not trust the library it checks. */
  function sign(
    payload: string,
    at = Math.floor(Date.now() / 1000),
    signingKey = key,
  ) {
    const id = "msg_1";
    const signature = createHmac("sha256", signingKey)
      .update(`${id}.${at}.${payload}`)
      .digest("base64");
    return { id, timestamp: String(at), signature: `v1,${signature}` };
  }

  it("accepts the exact bytes that were signed", () => {
    expect(verifyEvent(body, sign(body), secret)).toMatchObject({
      type: "email.delivered",
    });
  });

  it("refuses a changed body", () => {
    expect(verifyEvent(`${body} `, sign(body), secret)).toBeNull();
  });

  it("refuses the wrong key", () => {
    expect(
      verifyEvent(body, sign(body, undefined, randomBytes(24)), secret),
    ).toBeNull();
  });

  it("refuses an old timestamp, so a captured event cannot be replayed", () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyEvent(body, sign(body, old), secret)).toBeNull();
  });

  it("refuses missing headers", () => {
    expect(
      verifyEvent(
        body,
        { id: null, timestamp: "1", signature: "v1,x" },
        secret,
      ),
    ).toBeNull();
  });
});

describe("production secrets", () => {
  const long = "x".repeat(32);

  it("keeps good secrets", () => {
    expect(
      emailSecrets({
        NODE_ENV: "production",
        CRON_SECRET: long,
        GUEST_TOKEN_SECRET: long,
      }),
    ).toEqual({ cronSecret: long, guestTokenSecret: long });
  });

  it("treats a short secret as none, and says so", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(
      emailSecrets({
        NODE_ENV: "production",
        CRON_SECRET: "short",
        GUEST_TOKEN_SECRET: long,
      }),
    ).toEqual({ cronSecret: undefined, guestTokenSecret: long });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("CRON_SECRET"));
  });

  it("does not bother local work", () => {
    expect(emailSecrets({ NODE_ENV: "development", CRON_SECRET: "a" })).toEqual(
      { cronSecret: "a", guestTokenSecret: undefined },
    );
  });
});

describe("cron secret", () => {
  it("accepts only the exact bearer value", () => {
    expect(isCronAuthorised("Bearer s3cret", "s3cret")).toBe(true);
    expect(isCronAuthorised("Bearer wrong", "s3cret")).toBe(false);
    expect(isCronAuthorised("s3cret", "s3cret")).toBe(false);
    expect(isCronAuthorised(null, "s3cret")).toBe(false);
  });

  it("refuses everything when no secret is set", () => {
    expect(isCronAuthorised("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorised("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorised("Bearer ", "")).toBe(false);
  });
});

describe("guest links", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("computes the same token each time, unique to booking and secret", () => {
    const token = deriveGuestToken("secret", id);
    expect(deriveGuestToken("secret", id)).toBe(token);
    expect(token).not.toBe(deriveGuestToken("other", id));
    expect(token).not.toBe(
      deriveGuestToken("secret", "22222222-2222-4222-8222-222222222222"),
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("hashes as booking_for_token does", () => {
    expect(hashGuestToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("builds the page path in the guest's language", () => {
    expect(guestBookingPath("el", "tok")).toBe("/el/booking/tok");
  });
});

describe("what callers can pass", () => {
  const bookingId = "11111111-1111-4111-8111-111111111111";

  it("has no way in for a raw token or a link", () => {
    for (const [type, schema] of Object.entries(EMAIL_DATA)) {
      const withToken = { bookingId, token: "raw", bookingLink: "https://x" };
      expect(schema.safeParse(withToken).success, type).toBe(false);
    }
  });

  it("refuses stillOwedCents on a cancellation (D24)", () => {
    expect(
      EMAIL_DATA.booking_cancellation.safeParse({
        bookingId,
        refundCents: 0,
        stillOwedCents: 5000,
      }).success,
    ).toBe(false);
  });
});

describe("attachment references", () => {
  const good = {
    bucket: "invoices",
    path: "2027/TEST-1.pdf",
    filename: "TEST-1.pdf",
    contentType: "application/pdf",
  };

  it("accepts a plain path", () => {
    expect(attachmentRefs.safeParse([good]).success).toBe(true);
  });

  it.each([
    ["path", "../secret.pdf"],
    ["path", "a/../../secret.pdf"],
    ["path", "/etc/passwd"],
    ["path", "a\\b.pdf"],
    ["path", ""],
    ["bucket", "media"],
    ["filename", "a\r\nBcc: x"],
    ["filename", "../x.pdf"],
    ["contentType", "text/html\r\nX: y"],
  ])("refuses %s %j", (field, value) => {
    expect(
      attachmentRefs.safeParse([{ ...good, [field]: value }]).success,
    ).toBe(false);
  });

  it("refuses a field it does not know", () => {
    expect(attachmentRefs.safeParse([{ ...good, url: "x" }]).success).toBe(
      false,
    );
  });
});

describe("dedupe ids", () => {
  it("gives a valid, stable UUID for a key", () => {
    const id = dedupeId("balance_request:abc");
    expect(id).toBe(dedupeId("balance_request:abc"));
    expect(id).not.toBe(dedupeId("balance_reminder:abc"));
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe("Athens time", () => {
  it("knows summer and winter offsets", () => {
    expect(athensInstant("2027-07-01", 9).toISOString()).toBe(
      "2027-07-01T06:00:00.000Z",
    );
    expect(athensInstant("2027-01-15", 9).toISOString()).toBe(
      "2027-01-15T07:00:00.000Z",
    );
  });

  it("waits for the send hour, and not once it has passed", () => {
    const settings = DEFAULT_EMAIL_SETTINGS;
    const early = new Date("2027-07-01T03:00:00Z");
    expect(sendMoment(early, settings).toISOString()).toBe(
      "2027-07-01T06:00:00.000Z",
    );
    const late = new Date("2027-07-01T10:00:00Z");
    expect(sendMoment(late, settings)).toBe(late);
  });
});

describe("email settings", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("starts from the agreed defaults (D27)", () => {
    expect(parseEmailSettings(null)).toMatchObject({
      senderName: "Casa Filakopi",
      fromAddress: "bookings@mail.miloscasa.com",
      replyTo: "host@miloscasa.com",
      hostRecipients: ["host@miloscasa.com"],
      balanceReminderDays: 3,
      preArrivalDays: 3,
      thankYouEnabled: false,
      invoiceEmailEnabled: false,
    });
  });

  it("keeps stored values, and fills in what is missing", () => {
    const value = parseEmailSettings({ senderName: "Other" });
    expect(value.senderName).toBe("Other");
    expect(value.preArrivalDays).toBe(3);
  });

  it("falls back rather than stopping guest emails", () => {
    expect(parseEmailSettings({ hostRecipients: "nope" })).toEqual(
      DEFAULT_EMAIL_SETTINGS,
    );
  });
});

describe("calendar file", () => {
  const ics = buildStayIcs({
    uid: "abc",
    title: "Casa Filakopi, Milos; a stay",
    location: "Filakopi, Milos",
    checkIn: "2027-07-12",
    checkOut: "2027-07-19",
    createdAt: new Date("2027-01-01T10:00:00.000Z"),
  });

  it("has all-day dates, ending after check-out day", () => {
    expect(ics).toContain("DTSTART;VALUE=DATE:20270712\r\n");
    expect(ics).toContain("DTEND;VALUE=DATE:20270720\r\n");
    expect(ics).toContain("DTSTAMP:20270101T100000Z\r\n");
  });

  it("escapes text and uses CRLF", () => {
    expect(ics).toContain("SUMMARY:Casa Filakopi\\, Milos\\; a stay\r\n");
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("folds long lines without breaking Greek letters", () => {
    const long = buildStayIcs({
      uid: "abc",
      title: "Διαμονή ".repeat(20),
      checkIn: "2027-07-12",
      checkOut: "2027-07-19",
      createdAt: new Date(),
    });
    for (const line of long.split("\r\n")) {
      expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
    }
    expect(long).not.toContain("�");
  });
});
