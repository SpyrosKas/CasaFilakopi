import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pull: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/db/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/admin/audit", () => ({ writeAudit: mocks.audit }));
vi.mock("@/lib/admin/session", () => ({
  requireOwner: async () => ({
    userId: "owner",
    supabase: {
      from: () => ({ upsert: mocks.upsert }),
      rpc: async () => ({ data: "owner", error: null }),
    },
  }),
}));
vi.mock("@/lib/channels/providers", () => ({
  defaultProvider: () => ({ pull: mocks.pull }),
}));

import { idleState } from "@/lib/admin/form-state";
import { saveFeed, saveGeneral } from "@/lib/channels/actions";

const LINK = "https://www.airbnb.com/calendar/ical/1.ics?s=secret-token";
const ROOM = "00000000-0000-4000-8000-000000000001";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const feedForm = (url = LINK) => form({ roomId: ROOM, channel: "airbnb", url });

beforeEach(() => {
  mocks.pull.mockReset();
  mocks.upsert.mockReset();
  mocks.audit.mockReset();
  mocks.upsert.mockResolvedValue({ error: null });
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

  it("keeps the link out of what it returns and what it audits", async () => {
    mocks.pull.mockResolvedValue({ ok: true, events: [], unreadable: 0 });
    const state = await saveFeed(idleState, feedForm());
    expect(JSON.stringify(state)).not.toContain("secret-token");
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(
      "secret-token",
    );
  });
});

describe("saveGeneral", () => {
  it("refuses an interval that is not offered", async () => {
    const state = await saveGeneral(idleState, form({ intervalMinutes: "1" }));
    expect(state.status).toBe("error");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("stores the switches as true and false", async () => {
    await saveGeneral(
      idleState,
      form({ intervalMinutes: "30", enabled: "on", airbnb: "on" }),
    );
    expect(mocks.upsert.mock.calls[0][0]).toEqual({
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
});
