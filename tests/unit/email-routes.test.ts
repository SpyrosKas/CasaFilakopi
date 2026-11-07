import { createHmac, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runEmailQueue: vi.fn(),
  sendScheduledEmails: vi.fn(),
  applyEventDb: vi.fn(),
  jobUpdate: vi.fn(),
}));

const chain = () => {
  const link: Record<string, unknown> = {};
  for (const name of ["insert", "eq", "select", "order", "limit"]) {
    link[name] = () => link;
  }
  link.update = (values: unknown) => {
    mocks.jobUpdate(values);
    return link;
  };
  link.single = async () => ({ data: { id: 1 }, error: null });
  link.then = (done: (value: unknown) => void) =>
    done({ data: [], error: null });
  return link;
};

vi.mock("@/lib/db/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      mocks.applyEventDb(table);
      return chain();
    },
  }),
}));
vi.mock("@/lib/email", () => ({ runEmailQueue: mocks.runEmailQueue }));
vi.mock("@/lib/email/scheduled", () => ({
  sendScheduledEmails: mocks.sendScheduledEmails,
}));

import { GET as cronGet, POST as cronPost } from "@/app/api/cron/email/route";
import { POST as scheduledPost } from "@/app/api/cron/email/scheduled/route";
import { POST as webhookPost } from "@/app/api/email/webhook/route";

const bearer = (secret: string) => ({ authorization: `Bearer ${secret}` });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secret");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.applyEventDb.mockReset();
  mocks.jobUpdate.mockReset();
  mocks.runEmailQueue.mockReset().mockResolvedValue({
    status: "ok",
    claimed: 0,
  });
  mocks.sendScheduledEmails.mockReset().mockResolvedValue({ queued: 2 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("cron routes", () => {
  const url = "https://site.test/api/cron/email";

  it("refuses without the secret, and runs nothing", async () => {
    const response = await cronPost(new Request(url, { method: "POST" }));
    expect(response.status).toBe(401);
    expect(mocks.runEmailQueue).not.toHaveBeenCalled();
  });

  it("refuses the wrong secret on the scheduled job too", async () => {
    const response = await scheduledPost(
      new Request(url, { method: "POST", headers: bearer("wrong") }),
    );
    expect(response.status).toBe(401);
    expect(mocks.sendScheduledEmails).not.toHaveBeenCalled();
  });

  it("refuses everything when CRON_SECRET is not set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const response = await cronGet(new Request(url, { headers: bearer("") }));
    expect(response.status).toBe(401);
  });

  it("runs the queue on GET, as Vercel Cron calls it", async () => {
    const response = await cronGet(
      new Request(url, { headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(200);
    expect(mocks.runEmailQueue).toHaveBeenCalledTimes(1);
  });

  it("reports a missing key instead of crashing", async () => {
    mocks.runEmailQueue.mockResolvedValue({
      status: "not_configured",
      claimed: 0,
      waiting: 4,
    });
    const response = await cronGet(
      new Request(url, { headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "not_configured",
      waiting: 4,
    });
  });

  it("records a run with failed emails as failed", async () => {
    mocks.runEmailQueue.mockResolvedValue({
      status: "ok",
      claimed: 2,
      failed: 1,
    });
    const response = await cronGet(
      new Request(url, { headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(200);
    expect(mocks.jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("records a refused key as failed, and answers with an error", async () => {
    mocks.runEmailQueue.mockResolvedValue({
      status: "config_error",
      configError: "resend 401",
      claimed: 0,
      failed: 0,
    });
    const response = await cronGet(
      new Request(url, { headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(500);
    expect(mocks.jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("refuses a short secret in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await cronGet(
      new Request(url, { headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(401);
    expect(mocks.runEmailQueue).not.toHaveBeenCalled();
  });

  it("logs the scheduled run", async () => {
    const response = await scheduledPost(
      new Request(url, { method: "POST", headers: bearer("cron-secret") }),
    );
    expect(response.status).toBe(200);
    expect(mocks.applyEventDb).toHaveBeenCalledWith("job_runs");
  });
});

describe("webhook route", () => {
  const key = randomBytes(24);
  const secret = `whsec_${key.toString("base64")}`;
  // Odd spacing on purpose: parsing and re-serialising would change the bytes.
  const body = `{ "type": "email.opened",   "data": { "email_id": "x" } }`;

  function signed(payload: string) {
    const id = "msg_1";
    const at = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", key)
      .update(`${id}.${at}.${payload}`)
      .digest("base64");
    return {
      "svix-id": id,
      "svix-timestamp": at,
      "svix-signature": `v1,${signature}`,
    };
  }

  const post = (payload: string, headers: Record<string, string>) =>
    webhookPost(
      new Request("https://site.test/api/email/webhook", {
        method: "POST",
        body: payload,
        headers,
      }),
    );

  it("refuses to run without a secret", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await post(body, signed(body))).status).toBe(503);
  });

  it("checks the signature over the raw bytes", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    const response = await post(body, signed(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "ignored" });
  });

  it("refuses a forged event before touching the database", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    const response = await post(
      body.replace("opened", "delivered"),
      signed(body),
    );
    expect(response.status).toBe(401);
    expect(mocks.applyEventDb).not.toHaveBeenCalled();
  });

  it("refuses an oversized body", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    const big = "x".repeat(300_000);
    expect((await post(big, signed(big))).status).toBe(413);
  });

  it("refuses an unsigned event", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    expect((await post(body, {})).status).toBe(401);
  });
});
