import type { IsoDate } from "../domain/contracts";
import { athensDate } from "../domain/dates";
import {
  FAILURE_ALERT_AT,
  feedHealth,
  isFeedActive,
  type ChannelSettings,
} from "./settings";
import type {
  Channel,
  ChannelProvider,
  FeedEvent,
  SyncErrorCode,
} from "./types";

// The import job (CHN-06, CHN-07). The rules that protect money:
//   A failed or incomplete read releases nothing.
//   An empty feed releases nothing until the fetch before it was empty too.
//   Events are added before anything is released, so dates never open up.
//   A stay that has finished is never released: Yorgos's amounts live on it.

export interface Feed {
  id: string;
  roomId: string;
  channel: Channel;
  url: string | null;
  isEnabled: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  consecutiveFailures: number;
  lastStartedAt: string | null;
}

export interface ClaimOnRoom {
  start: IsoDate;
  end: IsoDate;
  isConflicted: boolean;
  /** Set when the claim is an imported event. */
  calendarId: string | null;
  uid: string | null;
}

export interface UpsertResult {
  isConflicted: boolean;
  isNewConflict: boolean;
}

export type HostAlert =
  | {
      template: "host_channel_conflict";
      calendarId: string;
      channel: Channel;
      start: IsoDate;
      end: IsoDate;
    }
  | {
      template: "host_channel_sync_failing" | "host_channel_sync_stale";
      calendarId: string;
      channel: Channel;
    };

/** Everything the job needs from the database, so tests can run it in memory. */
export interface ChannelStore {
  settings(): Promise<ChannelSettings>;
  feeds(): Promise<Feed[]>;
  /** Null when another run holds this feed. */
  beginRun(calendarId: string, now: Date): Promise<number | null>;
  finishRun(
    runId: number,
    now: Date,
    result:
      | { status: "success"; eventsSeen: number }
      | { status: "failed"; error: SyncErrorCode },
  ): Promise<void>;
  /** The run finished just before this one. */
  previousRun(
    calendarId: string,
    runId: number,
  ): Promise<{ status: string; eventsSeen: number | null } | null>;
  /** UIDs of stored stays that have already ended. */
  finishedUids(calendarId: string, today: IsoDate): Promise<string[]>;
  roomClaims(roomId: string): Promise<ClaimOnRoom[]>;
  upsertEvent(calendarId: string, event: FeedEvent): Promise<UpsertResult>;
  releaseMissing(
    calendarId: string,
    keep: string[],
    allowEmpty: boolean,
  ): Promise<number>;
  recordSuccess(calendarId: string, now: Date): Promise<void>;
  /** Returns the new count of failures in a row. */
  recordFailure(calendarId: string): Promise<number>;
  /** False when the host has no address to send to. */
  queueAlert(alert: HostAlert): Promise<boolean>;
  alertQueuedSince(
    template: HostAlert["template"],
    calendarId: string,
    since: string,
  ): Promise<boolean>;
}

export interface SyncDeps {
  store: ChannelStore;
  provider: ChannelProvider;
  now?: () => Date;
}

export type SyncOutcome =
  | {
      status: "success";
      eventsSeen: number;
      released: number;
      newConflicts: number;
    }
  | { status: "failed"; error: SyncErrorCode }
  | { status: "skipped" };

/**
 * Whether another claim already covers these dates. A closed date on a channel
 * under a stay we know about is our own dates coming back, not a new fact, and
 * storing it would flag a false conflict against a guest who is paying.
 */
function isEchoOfClaim(
  event: FeedEvent,
  calendarId: string,
  claims: ClaimOnRoom[],
): boolean {
  return claims.some(
    (claim) =>
      !claim.isConflicted &&
      !(claim.calendarId === calendarId && claim.uid === event.uid) &&
      claim.start <= event.start &&
      claim.end >= event.end,
  );
}

async function alert(store: ChannelStore, entry: HostAlert) {
  try {
    await store.queueAlert(entry);
  } catch {
    // The screens still show it, and a sync must not fail over an email.
    console.error("channels: could not queue a host alert");
  }
}

async function applyEvents(
  feed: Feed & { url: string },
  events: FeedEvent[],
  unreadable: number,
  today: IsoDate,
  { store, provider }: SyncDeps,
  runId: number,
) {
  const claims = await store.roomClaims(feed.roomId);
  const stored: string[] = [];
  const clashes: { event: FeedEvent; isNew: boolean }[] = [];

  for (const event of events) {
    const isBlock = provider.classify(feed.channel, event.summary) === "block";
    if (isBlock && isEchoOfClaim(event, feed.id, claims)) continue;

    const result = await store.upsertEvent(feed.id, event);
    stored.push(event.uid);
    if (result.isConflicted) {
      clashes.push({ event, isNew: result.isNewConflict });
    }
  }

  let released = 0;
  if (unreadable === 0) {
    const finished = await store.finishedUids(feed.id, today);
    if (events.length > 0) {
      const keep = [...new Set([...stored, ...finished])];
      // Only echoes in a feed that does have events: this is not an empty feed.
      released = await store.releaseMissing(feed.id, keep, keep.length === 0);
    } else {
      const previous = await store.previousRun(feed.id, runId);
      if (previous?.status === "success" && previous.eventsSeen === 0) {
        released = await store.releaseMissing(feed.id, finished, true);
      }
    }
  }

  // A changed booking can arrive with a new UID, so it clashed with its own old
  // version until that was released just now. Only what still clashes is real.
  let newConflicts = 0;
  for (const { event, isNew } of clashes) {
    const { isConflicted } =
      released > 0
        ? await store.upsertEvent(feed.id, event)
        : { isConflicted: true };
    const isBlock = provider.classify(feed.channel, event.summary) === "block";
    if (isNew && isConflicted && !isBlock) {
      newConflicts += 1;
      await alert(store, {
        template: "host_channel_conflict",
        calendarId: feed.id,
        channel: feed.channel,
        start: event.start,
        end: event.end,
      });
    }
  }

  return { released, newConflicts };
}

export async function syncFeed(
  feed: Feed,
  deps: SyncDeps,
): Promise<SyncOutcome> {
  const { store, provider, now = () => new Date() } = deps;
  if (!feed.url) return { status: "skipped" };

  const runId = await store.beginRun(feed.id, now());
  if (runId === null) return { status: "skipped" };

  const fail = async (error: SyncErrorCode): Promise<SyncOutcome> => {
    await store.finishRun(runId, now(), { status: "failed", error });
    const failures = await store.recordFailure(feed.id);
    if (failures === FAILURE_ALERT_AT) {
      await alert(store, {
        template: "host_channel_sync_failing",
        calendarId: feed.id,
        channel: feed.channel,
      });
    }
    return { status: "failed", error };
  };

  try {
    const today = athensDate(now());
    const pulled = await provider.pull(feed.url, today);
    if (!pulled.ok) return await fail(pulled.code);

    const { events, unreadable } = pulled;
    const { released, newConflicts } = await applyEvents(
      { ...feed, url: feed.url },
      events,
      unreadable,
      today,
      deps,
      runId,
    );

    // Counting unreadable events means this run is never taken for an empty one.
    const eventsSeen = events.length + unreadable;
    await store.finishRun(runId, now(), { status: "success", eventsSeen });
    await store.recordSuccess(feed.id, now());
    return { status: "success", eventsSeen, released, newConflicts };
  } catch {
    return await fail("storage_error");
  }
}

export interface SyncReport {
  ran: number;
  failed: number;
  skipped: number;
  newConflicts: number;
}

async function runAll(feeds: Feed[], deps: SyncDeps, deadlineMs: number) {
  const now = deps.now ?? (() => new Date());
  const report: SyncReport = { ran: 0, failed: 0, skipped: 0, newConflicts: 0 };

  for (const feed of feeds) {
    if (now().getTime() > deadlineMs) {
      report.skipped += 1;
      continue;
    }
    const outcome = await syncFeed(feed, deps);
    if (outcome.status === "skipped") report.skipped += 1;
    else report.ran += 1;
    if (outcome.status === "failed") report.failed += 1;
    if (outcome.status === "success")
      report.newConflicts += outcome.newConflicts;
  }
  return report;
}

function activeFeeds(feeds: Feed[], settings: ChannelSettings): Feed[] {
  return feeds.filter((feed) =>
    isFeedActive({ ...feed, hasUrl: Boolean(feed.url) }, settings),
  );
}

/** A tick landing just before the interval is up should still count. */
const DUE_TOLERANCE_MS = 30_000;

function isDue(feed: Feed, intervalMinutes: number, now: Date): boolean {
  if (!feed.lastStartedAt) return true;
  return (
    now.getTime() - Date.parse(feed.lastStartedAt) >=
    intervalMinutes * 60_000 - DUE_TOLERANCE_MS
  );
}

async function raiseStaleAlerts(
  feeds: Feed[],
  settings: ChannelSettings,
  store: ChannelStore,
  now: Date,
) {
  for (const feed of feeds) {
    const health = feedHealth({ ...feed, hasUrl: true }, settings, now);
    if (health !== "stale") continue;
    const since = feed.lastSyncedAt ?? feed.createdAt;
    const template = "host_channel_sync_stale";
    if (!(await store.alertQueuedSince(template, feed.id, since))) {
      await alert(store, {
        template,
        calendarId: feed.id,
        channel: feed.channel,
      });
    }
  }
}

/** What the cron route runs. Stops starting feeds near the time limit. */
export async function runDueSyncs(
  deps: SyncDeps,
  budgetMs: number,
): Promise<SyncReport> {
  const { store, now = () => new Date() } = deps;
  const settings = await store.settings();
  const active = activeFeeds(await store.feeds(), settings);
  const started = now();
  const report = await runAll(
    active.filter((feed) => isDue(feed, settings.intervalMinutes, started)),
    deps,
    started.getTime() + budgetMs,
  );
  await raiseStaleAlerts(
    activeFeeds(await store.feeds(), settings),
    settings,
    store,
    now(),
  );
  return report;
}

/** The Sync now buttons (CHN-09). Ignores the interval, never the switches. */
export async function syncNow(
  deps: SyncDeps,
  budgetMs: number,
  channel?: Channel,
): Promise<SyncReport> {
  const { store, now = () => new Date() } = deps;
  const settings = await store.settings();
  const active = activeFeeds(await store.feeds(), settings).filter(
    (feed) => !channel || feed.channel === channel,
  );
  return runAll(active, deps, now().getTime() + budgetMs);
}
