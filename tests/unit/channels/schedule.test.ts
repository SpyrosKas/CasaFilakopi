import { describe, expect, it, vi } from "vitest";
import { createIcalProvider } from "@/lib/channels/providers";
import {
  isAutomaticSyncMissing,
  isSettingsDamaged,
  parseChannelSettings,
  staleAfterHours,
} from "@/lib/channels/settings";
import {
  runDueSyncs,
  syncNow,
  type ChannelStore,
  type Feed,
} from "@/lib/channels/sync";

const NOW = new Date("2027-05-01T12:00:00Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const feed = (fields: Partial<Feed> = {}): Feed => ({
  id: "calendar",
  roomId: "room",
  channel: "airbnb",
  url: "https://example.com/feed.ics",
  isEnabled: true,
  lastSyncedAt: minutesAgo(5),
  createdAt: minutesAgo(100_000),
  consecutiveFailures: 0,
  lastStartedAt: minutesAgo(5),
  ...fields,
});

const ON = { enabled: true, intervalMinutes: 15 };

function setup(feeds: Feed[], settings: unknown = ON) {
  const pull = vi.fn(async () => ({
    ok: true,
    text: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  }));
  const store = {
    settings: async () => parseChannelSettings(settings),
    feeds: async () => feeds,
    beginRun: async () => 1,
    finishRun: async () => {},
    emptySince: async () => null,
    lastCleanRunAt: async () => null,
    startedUids: async () => [],
    roomClaims: async () => [],
    upsertEvent: async () => ({ isConflicted: false, isNewConflict: false }),
    releaseMissing: async () => 0,
    recordSuccess: async () => {},
    recordFailure: async () => 1,
    queueAlert: vi.fn(async () => true),
    alertQueuedSince: vi.fn(async () => false),
  } satisfies ChannelStore;
  return {
    store,
    pull,
    deps: {
      store,
      provider: createIcalProvider(pull as never),
      now: () => NOW,
    },
  };
}

describe("which feeds run", () => {
  it("skips a feed that ran inside the interval", async () => {
    const { deps, pull } = setup([feed()]);
    expect((await runDueSyncs(deps, 1_000)).ran).toBe(0);
    expect(pull).not.toHaveBeenCalled();
  });

  it("runs a feed whose interval is up, or has never run", async () => {
    const { deps } = setup([
      feed({ id: "a", lastStartedAt: minutesAgo(15) }),
      feed({ id: "b", lastStartedAt: null }),
    ]);
    expect((await runDueSyncs(deps, 1_000)).ran).toBe(2);
  });

  it("lets a tick a few seconds early still count", async () => {
    const { deps } = setup([feed({ lastStartedAt: minutesAgo(14.8) })]);
    expect((await runDueSyncs(deps, 1_000)).ran).toBe(1);
  });

  it.each([
    ["sync is off", { enabled: false }, {}],
    ["the channel is off", { enabled: true, channels: { airbnb: false } }, {}],
    ["the feed is off", ON, { isEnabled: false }],
    ["there is no link", ON, { url: null }],
  ])("runs nothing when %s", async (_name, settings, fields) => {
    const { deps, pull } = setup(
      [feed({ lastStartedAt: null, ...fields })],
      settings,
    );
    await runDueSyncs(deps, 1_000);
    await syncNow(deps, 1_000);
    expect(pull).not.toHaveBeenCalled();
  });

  it("keeps exporting checkout holds off by default (D28)", () => {
    expect(parseChannelSettings({}).exportHolds).toBe(false);
    expect(parseChannelSettings(null).exportHolds).toBe(false);
  });

  it("says when the settings row is damaged, but not when it is missing", () => {
    expect(isSettingsDamaged({ enabled: "yes" })).toBe(true);
    expect(isSettingsDamaged("nonsense")).toBe(true);
    expect(isSettingsDamaged(null)).toBe(false);
    expect(isSettingsDamaged({ enabled: true, intervalMinutes: 15 })).toBe(
      false,
    );
  });

  it("carries on with the next feed when one cannot write its log", async () => {
    const { deps, store, pull } = setup([
      feed({ id: "a", lastStartedAt: null }),
      feed({ id: "b", lastStartedAt: null }),
    ]);
    const finishRun = vi
      .fn<typeof store.finishRun>()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue(undefined);
    const report = await runDueSyncs(
      { ...deps, store: { ...store, finishRun } },
      1_000,
    );
    expect(pull).toHaveBeenCalledTimes(2);
    expect(report).toMatchObject({ ran: 2, failed: 1 });
  });

  it("treats a damaged settings row as off", () => {
    expect(parseChannelSettings({ enabled: "yes" }).enabled).toBe(false);
    expect(parseChannelSettings({ intervalMinutes: 3 }).enabled).toBe(false);
    expect(parseChannelSettings(null).enabled).toBe(false);
  });

  it("reads the row the seed writes", () => {
    expect(
      parseChannelSettings({ enabled: true, intervalMinutes: 15 }),
    ).toMatchObject({
      enabled: true,
      intervalMinutes: 15,
      exportHolds: false,
      channels: { airbnb: true, booking_com: true },
    });
  });

  it("stops starting feeds when time runs out", async () => {
    let time = NOW.getTime();
    const { deps } = setup([
      feed({ id: "a", lastStartedAt: null }),
      feed({ id: "b", lastStartedAt: null }),
    ]);
    const report = await runDueSyncs(
      {
        ...deps,
        now: () => {
          time += 10_000;
          return new Date(time);
        },
      },
      1_000,
    );
    expect(report.skipped).toBeGreaterThan(0);
  });

  it("syncs one channel on request, ignoring the interval", async () => {
    const { deps, pull } = setup([
      feed({ id: "a", channel: "airbnb" }),
      feed({ id: "b", channel: "booking_com" }),
    ]);
    expect((await syncNow(deps, 1_000, "booking_com")).ran).toBe(1);
    expect(pull).toHaveBeenCalledTimes(1);
  });
});

describe("no good sync for too long (CHN-15)", () => {
  const stale = () =>
    feed({ lastSyncedAt: minutesAgo(7 * 60), lastStartedAt: minutesAgo(1) });

  const athens = (iso: string) => new Date(iso);

  it("allows 3 hours from June to September and 6 otherwise, on Milos", () => {
    expect(staleAfterHours(athens("2027-05-31T12:00:00Z"))).toBe(6);
    expect(staleAfterHours(athens("2027-06-15T12:00:00Z"))).toBe(3);
    expect(staleAfterHours(athens("2027-09-30T12:00:00Z"))).toBe(3);
    expect(staleAfterHours(athens("2027-10-01T12:00:00Z"))).toBe(6);
    // Already 1 June in Greece, still 31 May in UTC.
    expect(staleAfterHours(athens("2027-05-31T22:30:00Z"))).toBe(3);
    // Already 1 October in Greece.
    expect(staleAfterHours(athens("2027-09-30T22:30:00Z"))).toBe(6);
  });

  it("notices when nothing has run for too long", () => {
    expect(isAutomaticSyncMissing(minutesAgo(29), 10, NOW)).toBe(false);
    expect(isAutomaticSyncMissing(minutesAgo(31), 10, NOW)).toBe(true);
    expect(isAutomaticSyncMissing(minutesAgo(100), 60, NOW)).toBe(false);
    expect(isAutomaticSyncMissing(minutesAgo(130), 60, NOW)).toBe(true);
  });

  it("queues one alert", async () => {
    const { deps, store } = setup([stale()]);
    await runDueSyncs(deps, 1_000);
    expect(store.queueAlert).toHaveBeenCalledWith({
      kind: "stale",
      calendarId: "calendar",
      channel: "airbnb",
      failures: 0,
      hours: 6,
    });
  });

  it("does not repeat it on every tick", async () => {
    const { deps, store } = setup([stale()]);
    store.alertQueuedSince.mockResolvedValue(true);
    await runDueSyncs(deps, 1_000);
    expect(store.queueAlert).not.toHaveBeenCalled();
  });

  it("stays quiet about a healthy feed", async () => {
    const { deps, store } = setup([feed()]);
    await runDueSyncs(deps, 1_000);
    expect(store.queueAlert).not.toHaveBeenCalled();
  });
});
