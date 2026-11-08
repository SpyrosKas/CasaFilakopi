import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());
const jobs = vi.hoisted(() => ({
  startJob: vi.fn(async () => 7),
  finishJob: vi.fn(async () => {}),
  alertIfRepeating: vi.fn(async () => false),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/channels/sync", () => ({ runDueSyncs: run }));
vi.mock("@/lib/email/jobs", () => jobs);
vi.mock("@/lib/email/settings", () => ({
  loadEmailSettings: async () => ({ hostLocale: "el" }),
}));

import { GET, POST } from "@/app/api/cron/channel-sync/route";
import { isCronAuthorized } from "@/lib/channels/cron-auth";

const SECRET = "c".repeat(40);

const call = (handler: typeof GET, authorization?: string) =>
  handler(
    new Request("http://localhost/api/cron/channel-sync", {
      headers: authorization ? { authorization } : {},
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  run.mockReset();
  Object.values(jobs).forEach((fn) => fn.mockClear());
});

describe("isCronAuthorized", () => {
  it("accepts the exact header", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it.each([
    [null],
    [""],
    ["Bearer"],
    [SECRET],
    [`bearer ${SECRET}`],
    [`Bearer ${SECRET}x`],
    [`Bearer ${SECRET.slice(1)}`],
  ])("refuses %s", (header) => {
    expect(isCronAuthorized(header, SECRET)).toBe(false);
  });

  it("lets nobody in when the secret is missing or weak", () => {
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer short", "short")).toBe(false);
  });
});

describe("the cron route", () => {
  it("runs nothing without the secret", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await call(GET)).status).toBe(401);
    expect((await call(POST, "Bearer wrong")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs nothing when the server has no secret set", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call(GET, "Bearer ")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the job and returns only counts", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const report = { ran: 2, failed: 0, skipped: 0, newConflicts: 1 };
    run.mockResolvedValue(report);
    for (const handler of [GET, POST]) {
      const response = await call(handler, `Bearer ${SECRET}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(report);
    }
  });

  it("does not leak details when the job cannot start", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    run.mockRejectedValue(new Error("https://secret.example/feed"));
    const response = await call(GET, `Bearer ${SECRET}`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });

  it("logs a run that did work, and stays quiet when nothing was due", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    run.mockResolvedValue({ ran: 0, failed: 0, skipped: 2, newConflicts: 0 });
    await call(POST, `Bearer ${SECRET}`);
    expect(jobs.startJob).not.toHaveBeenCalled();

    run.mockResolvedValue({ ran: 1, failed: 0, skipped: 0, newConflicts: 0 });
    await call(POST, `Bearer ${SECRET}`);
    expect(jobs.startJob).toHaveBeenCalledWith({}, "channel_sync");
    expect(jobs.finishJob).toHaveBeenCalledWith(
      {},
      7,
      "success",
      expect.any(String),
    );
    expect(jobs.alertIfRepeating).not.toHaveBeenCalled();
  });

  it("logs a run that could not start and alerts in the host's language", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    vi.spyOn(console, "error").mockImplementation(() => {});
    run.mockRejectedValue(new Error("database down"));
    await call(POST, `Bearer ${SECRET}`);
    expect(jobs.finishJob).toHaveBeenCalledWith({}, 7, "failed", "see logs");
    expect(jobs.alertIfRepeating).toHaveBeenCalledWith(
      {},
      "channel_sync",
      "Έλεγχος ημερολογίων Airbnb και Booking.com",
      "",
      expect.any(Date),
    );
  });
});
