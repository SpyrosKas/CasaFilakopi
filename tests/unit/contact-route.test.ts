import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  insertMessage: vi.fn(),
  insertConsent: vi.fn(),
  insertAttempt: vi.fn(),
  countAttempts: vi.fn(),
  countMessages: vi.fn(),
  queueEmail: vi.fn(),
  kickEmails: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "contact_messages") {
        return {
          insert: (row: unknown) => {
            const result = mocks.insertMessage(row);
            return { select: () => ({ single: async () => result }) };
          },
          select: () => ({ gt: mocks.countMessages }),
        };
      }
      if (table === "consent_log") return { insert: mocks.insertConsent };
      return {
        insert: mocks.insertAttempt,
        select: () => ({
          eq: () => ({ eq: () => ({ gt: mocks.countAttempts }) }),
        }),
      };
    },
  }),
}));

vi.mock("@/lib/email", () => ({
  queueEmail: mocks.queueEmail,
  kickEmails: mocks.kickEmails,
}));

vi.mock("@/lib/env.server", () => ({
  getServerEnv: () => ({ SUPABASE_SECRET_KEY: "test-secret" }),
}));

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (task: () => unknown) => task(),
}));

import { POST } from "@/app/api/contact/route";

const site = "https://miloscasa.test";
const valid = {
  name: "Alex Example",
  email: "alex@example.com",
  phone: "+30 690 000 0000",
  dates: "July",
  message: "Hello there",
  locale: "en",
  consent: true,
  website: "",
};

const post = (body: unknown = valid, headers: Record<string, string> = {}) =>
  new Request(`${site}/api/contact`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      origin: site,
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
  });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});

  mocks.insertMessage
    .mockReset()
    .mockReturnValue({ data: { id: "m1" }, error: null });
  mocks.insertConsent.mockReset().mockResolvedValue({ error: null });
  mocks.insertAttempt.mockReset().mockResolvedValue({ error: null });
  mocks.countAttempts.mockReset().mockResolvedValue({ count: 0, error: null });
  mocks.countMessages.mockReset().mockResolvedValue({ count: 0, error: null });
  mocks.queueEmail
    .mockReset()
    .mockResolvedValue({ ok: true, ids: ["e1"], duplicate: false });
  mocks.kickEmails.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/contact", () => {
  it("saves the message, then queues the host email and auto-reply", async () => {
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(mocks.insertMessage).toHaveBeenCalledWith({
      name: "Alex Example",
      email: "alex@example.com",
      phone: "+30 690 000 0000",
      dates_of_interest: "July",
      message: "Hello there",
      locale: "en",
    });
    expect(mocks.queueEmail).toHaveBeenCalledWith("host_contact_message", {
      contactMessageId: "m1",
    });
    expect(mocks.queueEmail).toHaveBeenCalledWith(
      "contact_auto_reply",
      { contactMessageId: "m1" },
      {
        dedupeKey: expect.stringMatching(
          /^contact_auto_reply:\d{4}-\d\d-\d\d$/,
        ),
      },
    );
    expect(mocks.kickEmails).toHaveBeenCalledWith(["e1", "e1"]);
  });

  it("records the GDPR consent", async () => {
    await POST(post());
    expect(mocks.insertConsent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "contact_form",
        subject: "m1",
        granted: true,
      }),
    );
  });

  it("refuses a message without consent", async () => {
    const response = await POST(post({ ...valid, consent: false }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fields: ["consent"] });
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("answers a filled honeypot as if it worked, and stores nothing", async () => {
    const response = await POST(post({ ...valid, website: "spam.example" }));
    expect(response.status).toBe(200);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
    expect(mocks.queueEmail).not.toHaveBeenCalled();
  });

  it.each([
    ["name", { name: "Eve\r\nBcc: victim@example.com" }],
    ["email", { email: "eve@example.com\r\nBcc: victim@example.com" }],
    ["dates", { dates: "July\nBcc: victim@example.com" }],
  ])("refuses a line break in %s", async (field, change) => {
    const response = await POST(post({ ...valid, ...change }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ fields: [field] });
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses another site's form", async () => {
    const response = await POST(post(valid, { origin: "https://evil.test" }));
    expect(response.status).toBe(403);
  });

  it("refuses an oversized body", async () => {
    const response = await POST(
      post({ ...valid, message: "x".repeat(20_000) }),
    );
    expect(response.status).toBe(413);
  });

  it("stops reading a stream that lies about its size", async () => {
    const big = new TextEncoder().encode("x".repeat(20_000));
    const stream = new ReadableStream({
      pull(controller) {
        controller.enqueue(big);
      },
    });
    const request = new Request(`${site}/api/contact`, {
      method: "POST",
      body: stream,
      duplex: "half",
      headers: { origin: site, "content-length": "10" },
    } as RequestInit);
    expect((await POST(request)).status).toBe(413);
  });

  it("still sends the emails if the consent log fails", async () => {
    mocks.insertConsent.mockResolvedValue({ error: { message: "down" } });
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(mocks.queueEmail).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("contact.consent_not_logged"),
    );
  });

  it("limits by address, once the count is over", async () => {
    mocks.countAttempts.mockResolvedValue({ count: 5, error: null });
    const response = await POST(post());
    expect(response.status).toBe(429);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
    expect(mocks.insertAttempt).not.toHaveBeenCalled();
  });

  it("limits a burst: the count after the row decides", async () => {
    mocks.countAttempts
      .mockResolvedValueOnce({ count: 4, error: null })
      .mockResolvedValueOnce({ count: 6, error: null });
    const response = await POST(post());
    expect(response.status).toBe(429);
  });

  it("stops a flood from many addresses", async () => {
    mocks.countMessages.mockResolvedValue({ count: 60, error: null });
    const response = await POST(post());
    expect(response.status).toBe(429);
  });

  it("never stores the raw address", async () => {
    await POST(post());
    const [row] = mocks.insertAttempt.mock.calls[0];
    expect(row.scope).toBe("contact_form");
    expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/);
    const everything = JSON.stringify([
      mocks.insertAttempt.mock.calls,
      mocks.insertMessage.mock.calls,
      mocks.insertConsent.mock.calls,
      mocks.queueEmail.mock.calls,
    ]);
    expect(everything).not.toContain("203.0.113.7");
  });

  it("keeps the saved message if email cannot be queued", async () => {
    mocks.queueEmail.mockRejectedValue(new Error("queue down"));
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(mocks.insertMessage).toHaveBeenCalledTimes(1);
  });

  it("tells the visitor if the message could not be saved", async () => {
    mocks.insertMessage.mockReturnValue({
      data: null,
      error: { message: "down" },
    });
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(mocks.queueEmail).not.toHaveBeenCalled();
  });
});

describe("Turnstile", () => {
  const siteverify = (success: boolean) =>
    vi.fn(async () => Response.json({ success }));

  it("is skipped with a log line when not configured", async () => {
    const fetchMock = siteverify(false);
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post());
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining("Turnstile not configured"),
    );
  });

  const setKeys = () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret");
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site");
  };

  it("closes the form in production with no keys, saving nothing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "closed" });
    expect(mocks.insertMessage).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("CONTACT FORM CLOSED"),
    );
  });

  it.each([
    ["TURNSTILE_SECRET_KEY", "the secret key"],
    ["NEXT_PUBLIC_TURNSTILE_SITE_KEY", "the site key"],
  ])("treats %s alone as a loud mistake", async (name, words) => {
    vi.stubEnv(name, "value");
    const response = await POST(post());
    expect(response.status).toBe(503);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(words));
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("is enforced when both keys are set", async () => {
    setKeys();
    vi.stubGlobal("fetch", siteverify(true));
    const response = await POST(post());
    expect(response.status).toBe(403);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("passes a good token, and sends no address to Cloudflare", async () => {
    setKeys();
    const fetchMock = siteverify(true);
    vi.stubGlobal("fetch", fetchMock);
    const response = await POST(post({ ...valid, turnstileToken: "tok" }));
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const sent = new URLSearchParams(String(init.body));
    expect(sent.get("response")).toBe("tok");
    expect(sent.has("remoteip")).toBe(false);
  });

  it("refuses a bad token", async () => {
    setKeys();
    vi.stubGlobal("fetch", siteverify(false));
    const response = await POST(post({ ...valid, turnstileToken: "bad" }));
    expect(response.status).toBe(403);
    expect(mocks.insertMessage).not.toHaveBeenCalled();
  });

  it("refuses when Cloudflare cannot be reached", async () => {
    setKeys();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await POST(post({ ...valid, turnstileToken: "tok" }));
    expect(response.status).toBe(403);
  });
});
