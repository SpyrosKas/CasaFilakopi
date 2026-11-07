import { describe, expect, it, vi } from "vitest";
import { createIcalProvider } from "@/lib/channels/providers";
import { parseChannelSettings } from "@/lib/channels/settings";
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
    previousRun: async () => null,
    finishedUids: async () => [],
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
      exportHolds: true,
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

  it("queues one alert", async () => {
    const { deps, store } = setup([stale()]);
    await runDueSyncs(deps, 1_000);
    expect(store.queueAlert).toHaveBeenCalledWith({
      template: "host_channel_sync_stale",
      calendarId: "calendar",
      channel: "airbnb",
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
