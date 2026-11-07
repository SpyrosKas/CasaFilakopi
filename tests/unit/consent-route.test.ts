import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COOKIE_POLICY_VERSION } from "@/content/consent";

const db = vi.hoisted(() => ({
  insert: vi.fn(),
  nthRecentRow: vi.fn(),
}));

vi.mock("@/lib/db/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: db.insert,
      select: () => ({
        order: () => ({
          range: () => ({ maybeSingle: db.nthRecentRow }),
        }),
      }),
    }),
  }),
}));

import { POST } from "@/app/api/consent/route";
import { resetClientLimits } from "@/app/api/consent/rate-limit";

const site = "https://miloscasa.test";
const body = {
  granted: true,
  policyVersion: COOKIE_POLICY_VERSION,
  subject: "00000000-0000-4000-8000-000000000000",
};

function post(payload: unknown = body, headers: Record<string, string> = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request(`${site}/api/consent`, {
    method: "POST",
    body: text,
    headers: {
      "content-type": "application/json",
      origin: site,
      host: "miloscasa.test",
      "x-forwarded-for": "203.0.113.7",
      ...headers,
    },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", site);
  vi.stubEnv("NODE_ENV", "production");
  resetClientLimits();
  db.insert.mockReset().mockResolvedValue({ error: null });
  db.nthRecentRow.mockReset().mockResolvedValue({ data: null, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/consent", () => {
  it("stores the choice and answers 204", async () => {
    const response = await POST(post());
    expect(response.status).toBe(204);
    expect(db.insert).toHaveBeenCalledWith({
      kind: "cookies",
      subject: body.subject,
      policy_version: COOKIE_POLICY_VERSION,
      granted: true,
    });
  });

  it("never passes an address to the database", async () => {
    await POST(post());
    expect(JSON.stringify(db.insert.mock.calls)).not.toContain("203.0.113.7");
  });

  it("refuses a declared size above the limit without reading the body", async () => {
    const request = post(body, { "content-length": "99999" });
    const read = vi.spyOn(request, "text");
    const reader = vi.spyOn(request.body!, "getReader");

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(read).not.toHaveBeenCalled();
    expect(reader).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("stops reading a stream that lies about its size", async () => {
    const pulled = vi.fn();
    const chunk = new Uint8Array(400);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled();
        controller.enqueue(chunk);
      },
    });
    const request = new Request(`${site}/api/consent`, {
      method: "POST",
      body: stream,
      headers: { origin: site, "content-length": "10" },
      duplex: "half",
    } as RequestInit);

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(pulled.mock.calls.length).toBeLessThan(6);
  });

  it("counts bytes, not characters", async () => {
    const response = await POST(post({ ...body, subject: "α".repeat(600) }));
    expect(response.status).toBe(413);
  });

  it.each([
    ["an old policy version", { ...body, policyVersion: "draft-0" }],
    ["an unknown field", { ...body, extra: 1 }],
    ["a wrong type", { ...body, granted: "yes" }],
    ["a subject that is not a uuid", { ...body, subject: "abc" }],
  ])("refuses %s", async (_, payload) => {
    expect((await POST(post(payload))).status).toBe(400);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("refuses broken JSON", async () => {
    expect((await POST(post("{"))).status).toBe(400);
  });

  it.each([
    ["no origin", ""],
    ["another site", "https://evil.test"],
    ["the right host on the wrong scheme", "http://miloscasa.test"],
  ])("refuses %s", async (_, origin) => {
    const response = await POST(post(body, { origin }));
    expect(response.status).toBe(403);
  });

  it("ignores x-forwarded-host", async () => {
    const response = await POST(
      post(body, {
        origin: "https://evil.test",
        "x-forwarded-host": "evil.test",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("limits one client to 10 a minute, leaving others alone", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await POST(post())).status).toBe(204);
    }
    const blocked = await POST(post());
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("retry-after")).toBe("60");

    const other = await POST(post(body, { "x-forwarded-for": "203.0.113.8" }));
    expect(other.status).toBe(204);
  });

  it("stops writing when the table fills too fast, from any address", async () => {
    db.nthRecentRow.mockResolvedValue({
      data: { created_at: new Date(Date.now() - 5_000).toISOString() },
      error: null,
    });
    expect((await POST(post())).status).toBe(429);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("allows writes when that row is older than a minute", async () => {
    db.nthRecentRow.mockResolvedValue({
      data: { created_at: new Date(Date.now() - 61_000).toISOString() },
      error: null,
    });
    expect((await POST(post())).status).toBe(204);
  });

  it("logs the database message and answers 503", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    db.insert.mockResolvedValue({ error: { message: "connection lost" } });

    const response = await POST(post());

    expect(response.status).toBe(503);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("connection lost"),
    );
  });

  it("answers 503 when the rate check itself fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    db.nthRecentRow.mockResolvedValue({
      data: null,
      error: { message: "timeout" },
    });
    expect((await POST(post())).status).toBe(503);
  });
});
