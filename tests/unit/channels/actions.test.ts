import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  upsert: vi.fn(),
  userUpsert: vi.fn(),
  audit: vi.fn(),
  email: "host@example.test" as string | null,
  role: "owner",
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert: mocks.upsert }) }),
}));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/admin/session", () => ({
  requireOwner: async () => ({
    userId: "owner",
    supabase: {
      from: () => ({
        upsert: mocks.userUpsert,
        select: () => ({
          maybeSingle: async () => ({
            data: { email: mocks.email },
            error: null,
          }),
        }),
      }),
      rpc: async () => ({ data: mocks.role, error: null }),
    },
  }),
}));
vi.mock("@/lib/channels/providers", () => ({
  defaultProvider: () => ({ pull: mocks.pull }),
}));

import { idleState } from "@/lib/admin/form-state";
import {
  regenerateExport,
  saveFeed,
  saveGeneral,
} from "@/lib/channels/actions";

const LINK = "https://www.airbnb.com/calendar/ical/1.ics?s=secret-token";
const ROOM = "00000000-0000-4000-8000-000000000001";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const feedForm = (url = LINK) => form({ roomId: ROOM, channel: "airbnb", url });

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.miloscasa.com");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "key");
  mocks.pull.mockReset();
  mocks.upsert.mockReset();
  mocks.userUpsert.mockReset();
  mocks.audit.mockReset();
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.userUpsert.mockResolvedValue({ error: null });
  mocks.email = "host@example.test";
  mocks.role = "owner";
});

describe("saveFeed (CHN-05)", () => {
  it("saves a link only after reading it", async () => {
    mocks.pull.mockResolvedValue({ ok: true, events: [{}, {}], unreadable: 0 });
    const state = await saveFeed(idleState, feedForm());

    expect(state).toMatchObject({ status: "ok" });
    expect(state.message).toContain("2 stays");
    expect(mocks.upsert.mock.calls[0][0]).toMatchObject({
      room_id: ROOM,
      channel: "airbnb",
      import_url: LINK,
      is_enabled: true,
      consecutive_failures: 0,
    });
  });

  it("does not save a link that failed, and says why in plain words", async () => {
    mocks.pull.mockResolvedValue({ ok: false, code: "malformed" });
    const state = await saveFeed(idleState, feedForm());

    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
    expect(state.fieldErrors?.url).toContain("does not lead to a calendar");
  });

  it("refuses a missing link or an unknown channel before any fetch", async () => {
    await saveFeed(idleState, feedForm(""));
    await saveFeed(
      idleState,
      form({ roomId: ROOM, channel: "vrbo", url: LINK }),
    );
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("refuses the site's own host before any fetch", async () => {
    const state = await saveFeed(
      idleState,
      feedForm("https://miloscasa.com/api/ical/airbnb-x.ics"),
    );
    expect(state.fieldErrors?.url).toContain("own link");
    expect(mocks.pull).not.toHaveBeenCalled();
  });

  it("keeps the link out of what it returns and what it audits", async () => {
    mocks.pull.mockResolvedValue({ ok: true, events: [], unreadable: 0 });
    const state = await saveFeed(idleState, feedForm());
    expect(JSON.stringify(state)).not.toContain("secret-token");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(
      "secret-token",
    );
  });

  it("asks the database for the role before the secret-key write", async () => {
    mocks.pull.mockResolvedValue({ ok: true, events: [], unreadable: 0 });
    mocks.role = "staff";
    const state = await saveFeed(idleState, feedForm());
    expect(state.status).toBe("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("does not report failure when only the audit entry failed", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    mocks.pull.mockResolvedValue({ ok: true, events: [], unreadable: 0 });
    mocks.audit.mockRejectedValue(new Error("down"));
    expect(await saveFeed(idleState, feedForm())).toMatchObject({
      status: "ok",
    });
  });
});

describe("saveGeneral", () => {
  it("refuses an interval that is not offered", async () => {
    const state = await saveGeneral(idleState, form({ intervalMinutes: "1" }));
    expect(state.status).toBe("error");
    expect(mocks.userUpsert).not.toHaveBeenCalled();
  });

  it("stores the switches as true and false", async () => {
    await saveGeneral(
      idleState,
      form({ intervalMinutes: "30", enabled: "on", airbnb: "on" }),
    );
    expect(mocks.userUpsert.mock.calls[0][0]).toEqual({
      key: "channel_sync",
      is_public: false,
      value: {
        enabled: true,
        channels: { airbnb: true, booking_com: false, other_ical: false },
        intervalMinutes: 30,
        exportHolds: false,
      },
    });
  });

  it("cannot turn on exporting holds, even if the form tries", async () => {
    await saveGeneral(
      idleState,
      form({ intervalMinutes: "30", exportHolds: "on" }),
    );
    expect(mocks.userUpsert.mock.calls[0][0].value.exportHolds).toBe(false);
  });

  it("refuses to enable sync with no notification email", async () => {
    mocks.email = null;
    const state = await saveGeneral(
      idleState,
      form({ intervalMinutes: "30", enabled: "on" }),
    );
    expect(state.status).toBe("error");
    expect(state.message).toContain("notification email");
    expect(mocks.userUpsert).not.toHaveBeenCalled();
  });

  it("still lets sync be turned off with no notification email", async () => {
    mocks.email = null;
    await saveGeneral(idleState, form({ intervalMinutes: "30" }));
    expect(mocks.userUpsert).toHaveBeenCalled();
  });
});

describe("regenerateExport", () => {
  it("hands over the new links even if the audit entry fails", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    mocks.audit.mockRejectedValue(new Error("down"));
    const state = await regenerateExport(idleState, form({ roomId: ROOM }));
    expect(state.status).toBe("ok");
    expect(state.links).toHaveLength(3);
  });
});
