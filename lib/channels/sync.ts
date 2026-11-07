import type { IsoDate } from "../domain/contracts";
import { athensDate } from "../domain/dates";
import { formatRunNotes, type RunNotes } from "./run-notes";
import {
  FAILURE_ALERT_AT,
  feedHealth,
  isFeedActive,
  staleAfterHours,
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
//   While any event cannot be read, nothing is released.
//   A feed that gave us nothing to store releases only once that has lasted
//   6 hours and two or more runs in a row. Sync now cannot shorten this.
//   Events are added before anything is released, so dates never open up.
//   A stay that has started or finished is never released: the guest may be in
//   the house, and Yorgos's amounts live on it.
//   Every release of a future stay is logged and raises an alert.

export const EMPTY_RELEASE_AFTER_MS = 6 * 60 * 60_000;
const DAY_MS = 86_400_000;

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
  kind: "hold" | "booking" | "block" | "external";
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

/** Something Yorgos must hear about. store.ts turns these into emails. */
export type HostAlert = { calendarId: string; channel: Channel } & (
  | { kind: "conflict"; start: IsoDate; end: IsoDate; summary: string | null }
  | { kind: "stays_released" | "unread_events"; count: number }
  | { kind: "failing"; failures: number; error: SyncErrorCode }
  | { kind: "stale"; failures: number; hours: number }
);

/** Everything the job needs from the database, so tests can run it in memory. */
export interface ChannelStore {
  settings(): Promise<ChannelSettings>;
  feeds(): Promise<Feed[]>;
  /** Null when another run holds this feed. */
  beginRun(calendarId: string, now: Date): Promise<number | null>;
  finishRun(
    runId: number,
    now: Date,
    result: {
      status: "success" | "failed";
      eventsSeen: number | null;
      /** A failure code, run notes, or both. Never a link. */
      detail: string | null;
    },
  ): Promise<void>;
  /**
   * When the unbroken row of finished, successful, empty runs just before this
   * one began. Null when the run before this one was anything else.
   */
  emptySince(calendarId: string, runId: number): Promise<string | null>;
  /** When the feed last read in full, or null. */
  lastCleanRunAt(calendarId: string): Promise<string | null>;
  /** UIDs of stored stays that have already begun on this date. */
  startedUids(calendarId: string, today: IsoDate): Promise<string[]>;
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
    kind: HostAlert["kind"],
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
      /** Events we could not read. The readable ones were still imported. */
      unreadable: number;
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

/** The same dates as a stay of ours that this feed's channel was told about. */
function matchesExportedClaim(
  event: FeedEvent,
  claims: ClaimOnRoom[],
  exportHolds: boolean,
): boolean {
  return claims.some(
    (claim) =>
      (claim.kind === "booking" ||
        claim.kind === "block" ||
        (claim.kind === "hold" && exportHolds)) &&
      claim.start === event.start &&
      claim.end === event.end,
  );
}

/** True when the alert is on its way. The screens show the problem either way. */
async function alert(store: ChannelStore, entry: HostAlert): Promise<boolean> {
  try {
    return await store.queueAlert(entry);
  } catch {
    // A sync must not fail over an email.
    console.error("channels: could not queue a host alert");
    return false;
  }
}

interface EventsResult {
  storedCount: number;
  released: number;
  newConflicts: number;
  notes: RunNotes;
}

/** Whether a feed with nothing to store has been that way for long enough. */
async function emptyLongEnough(
  feed: Feed,
  runId: number,
  { store }: SyncDeps,
  now: Date,
): Promise<boolean> {
  const since = await store.emptySince(feed.id, runId);
  return (
    since !== null &&
    now.getTime() - Date.parse(since) >= EMPTY_RELEASE_AFTER_MS
  );
}

async function releaseGone(
  feed: Feed,
  stored: string[],
  today: IsoDate,
  runId: number,
  deps: SyncDeps,
  now: Date,
): Promise<number> {
  const { store } = deps;
  if (stored.length === 0 && !(await emptyLongEnough(feed, runId, deps, now))) {
    return 0;
  }
  const started = await store.startedUids(feed.id, today);
  const keep = [...new Set([...stored, ...started])];
  return store.releaseMissing(feed.id, keep, stored.length === 0);
}

async function applyEvents(
  feed: Feed & { url: string },
  events: FeedEvent[],
  unreadable: number,
  today: IsoDate,
  deps: SyncDeps,
  runId: number,
  now: Date,
): Promise<EventsResult> {
  const { store, provider } = deps;
  const notes: RunNotes = {};
  const claims = await store.roomClaims(feed.roomId);
  const { exportHolds } = await store.settings();
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

  const released =
    unreadable === 0
      ? await releaseGone(feed, stored, today, runId, deps, now)
      : 0;

  if (released > 0) {
    notes.released = released;
    const sent = await alert(store, {
      kind: "stays_released",
      calendarId: feed.id,
      channel: feed.channel,
      count: released,
    });
    if (!sent) notes.alertUnsent = (notes.alertUnsent ?? 0) + 1;
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
    if (!isNew || !isConflicted || isBlock) continue;

    // Stored and flagged all the same: only the alarm is held back, because
    // this looks like our own export coming back from the channel.
    if (matchesExportedClaim(event, claims, exportHolds)) {
      notes.echoed = (notes.echoed ?? 0) + 1;
      continue;
    }
    newConflicts += 1;
    const sent = await alert(store, {
      kind: "conflict",
      calendarId: feed.id,
      channel: feed.channel,
      start: event.start,
      end: event.end,
      summary: event.summary,
    });
    if (!sent) notes.alertUnsent = (notes.alertUnsent ?? 0) + 1;
  }

  return { storedCount: stored.length, released, newConflicts, notes };
}

/** One alert per feed, until the feed next reads in full. */
async function raiseUnreadable(
  feed: Feed,
  count: number,
  store: ChannelStore,
  notes: RunNotes,
) {
  const since = (await store.lastCleanRunAt(feed.id)) ?? feed.createdAt;
  if (await store.alertQueuedSince("unread_events", feed.id, since)) return;
  const sent = await alert(store, {
    kind: "unread_events",
    calendarId: feed.id,
    channel: feed.channel,
    count,
  });
  if (!sent) notes.alertUnsent = (notes.alertUnsent ?? 0) + 1;
}

/** From the third failure in a row, then once a day while it lasts. */
async function raiseFailing(
  feed: Feed,
  store: ChannelStore,
  now: Date,
  failures: number,
  error: SyncErrorCode,
) {
  const dayAgo = new Date(now.getTime() - DAY_MS).toISOString();
  if (await store.alertQueuedSince("failing", feed.id, dayAgo)) return true;
  return alert(store, {
    kind: "failing",
    calendarId: feed.id,
    channel: feed.channel,
    failures,
    error,
  });
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
    const failures = await store.recordFailure(feed.id);
    const sent =
      failures < FAILURE_ALERT_AT ||
      (await raiseFailing(feed, store, now(), failures, error));
    await store.finishRun(runId, now(), {
      status: "failed",
      eventsSeen: null,
      detail: formatRunNotes(sent ? {} : { alertUnsent: 1 }, error),
    });
    return { status: "failed", error };
  };

  try {
    const today = athensDate(now());
    const pulled = await provider.pull(feed.url, today);
    if (!pulled.ok) return await fail(pulled.code);

    const { events, unreadable } = pulled;
    const { storedCount, released, newConflicts, notes } = await applyEvents(
      { ...feed, url: feed.url },
      events,
      unreadable,
      today,
      deps,
      runId,
      now(),
    );

    if (unreadable > 0) {
      notes.unreadable = unreadable;
      await raiseUnreadable(feed, unreadable, store, notes);
    }

    // Marked failed so it can never look like a clean run, or count as an empty
    // one. The site did answer, though, so it is not a failure to reach it.
    const eventsSeen = storedCount;
    await store.finishRun(runId, now(), {
      status: unreadable > 0 ? "failed" : "success",
      eventsSeen,
      detail: formatRunNotes(notes),
    });
    await store.recordSuccess(feed.id, now());
    return {
      status: "success",
      eventsSeen,
      released,
      newConflicts,
      unreadable,
    };
  } catch {
    return await fail("storage_error");
  }
}

export interface SyncReport {
  ran: number;
  failed: number;
  /** Feeds that answered, but with events we could not read. */
  partial: number;
  skipped: number;
  newConflicts: number;
}

async function runAll(feeds: Feed[], deps: SyncDeps, deadlineMs: number) {
  const now = deps.now ?? (() => new Date());
  const report: SyncReport = {
    ran: 0,
    failed: 0,
    partial: 0,
    skipped: 0,
    newConflicts: 0,
  };

  for (const feed of feeds) {
    if (now().getTime() > deadlineMs) {
      report.skipped += 1;
      continue;
    }
    // One feed's trouble, even writing its own log, must not stop the others.
    const outcome = await syncFeed(feed, deps).catch((): SyncOutcome => ({
      status: "failed",
      error: "storage_error",
    }));
    if (outcome.status === "skipped") report.skipped += 1;
    else report.ran += 1;
    if (outcome.status === "failed") report.failed += 1;
    if (outcome.status === "success") {
      report.newConflicts += outcome.newConflicts;
      if (outcome.unreadable > 0) report.partial += 1;
    }
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
    const health = feedHealth({ ...feed, hasUrl: true }, now);
    if (health !== "stale") continue;
    const since = feed.lastSyncedAt ?? feed.createdAt;
    if (!(await store.alertQueuedSince("stale", feed.id, since))) {
      await alert(store, {
        kind: "stale",
        calendarId: feed.id,
        channel: feed.channel,
        failures: feed.consecutiveFailures,
        hours: staleAfterHours(now),
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
