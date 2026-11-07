import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import { athensDate } from "@/lib/domain/dates";
import { classifyEvent } from "./classify";
import { parseRunNotes, type RunNotes } from "./run-notes";
import { maskFeedUrl } from "./safe-url";
import {
  feedHealth,
  isAutomaticSyncMissing,
  isFeedActive,
  isSettingsDamaged,
  parseChannelSettings,
  SETTINGS_KEY,
  staleAfterHours,
  type ChannelSettings,
  type FeedHealth,
} from "./settings";
import { CHANNELS, isChannel, type Channel, type SyncErrorCode } from "./types";

// Reads for the screens, through the signed-in admin's own client. The raw
// import link stops here: nothing past this file sees more than the mask.

export interface FeedView {
  id: string | null;
  channel: Channel;
  maskedUrl: string | null;
  lastSyncedAt: string | null;
  consecutiveFailures: number;
  health: FeedHealth;
  isActive: boolean;
  /** Stored stays that have not begun, which only Yorgos can now free. */
  futureStays: number;
}

export interface SyncLogView {
  id: number;
  channel: Channel;
  startedAt: string;
  status: "running" | "success" | "failed";
  eventsSeen: number | null;
  error: SyncErrorCode | null;
  notes: RunNotes;
}

export interface ConflictView {
  id: string;
  channel: Channel;
  start: string;
  end: string;
}

export interface FeedAlert {
  channel: Channel;
  health: Exclude<FeedHealth, "ok"> | "unreadable";
  failures: number;
  unreadable: number;
}

export interface ReleaseNotice {
  channel: Channel;
  count: number;
  at: string;
}

export interface ChannelAlerts {
  conflicts: ConflictView[];
  feeds: FeedAlert[];
  releases: ReleaseNotice[];
  syncOff: boolean;
  settingsDamaged: boolean;
  noNotificationEmail: boolean;
  automaticSyncMissing: boolean;
  staleHours: number;
}

const MAX_CONFLICTS = 50;
const LOG_ROWS = 20;
const RECENT_RUNS = 500;
const RELEASE_NOTICE_MS = 24 * 3_600_000;

type Db = ReturnType<typeof createAdminClient>;

async function readSettingsValue(db: Db): Promise<unknown> {
  const { data, error } = await db
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

/** Double bookings still standing. Closed dates with no guest do not count. */
async function loadConflicts(db: Db): Promise<ConflictView[]> {
  const today = athensDate(new Date());
  const { data, error } = await db
    .from("external_events")
    .select(
      "id, start_date, end_date, summary, inventory_claims!inner (is_conflicted), external_calendars!inner (channel)",
    )
    .eq("inventory_claims.is_conflicted", true)
    .gte("end_date", today)
    .order("start_date")
    .limit(MAX_CONFLICTS);
  if (error) throw error;

  return data.flatMap((row): ConflictView[] => {
    const channel = row.external_calendars.channel;
    if (
      !isChannel(channel) ||
      classifyEvent(channel, row.summary) === "block"
    ) {
      return [];
    }
    return [{ id: row.id, channel, start: row.start_date, end: row.end_date }];
  });
}

interface RecentRun {
  calendarId: string;
  startedAt: string;
  status: string;
  unreadable: number;
  released: number;
}

async function loadRecentRuns(db: Db, ids: string[]): Promise<RecentRun[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("sync_logs")
    .select("calendar_id, started_at, status, error")
    .in("calendar_id", ids)
    .neq("status", "running")
    .order("id", { ascending: false })
    .limit(RECENT_RUNS);
  if (error) throw error;
  return data.map((row) => {
    const { notes } = parseRunNotes(row.error);
    return {
      calendarId: row.calendar_id,
      startedAt: row.started_at,
      status: row.status,
      unreadable: notes.unreadable ?? 0,
      released: notes.released ?? 0,
    };
  });
}

async function hasNotificationEmail(db: Db): Promise<boolean> {
  const { data, error } = await db
    .from("property")
    .select("email")
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.email);
}

/**
 * For the home page and the Channel sync screen. Staff see this too, but RLS
 * keeps the settings row from them, so it reads with the secret key after the
 * page's own role check. Only yes-or-no facts and counts leave this function.
 */
export async function loadChannelAlerts(): Promise<ChannelAlerts> {
  const db = createAdminClient();
  const value = await readSettingsValue(db);
  const settings = parseChannelSettings(value);
  const now = new Date();

  const { data, error } = await db
    .from("external_calendars")
    .select(
      "id, channel, is_enabled, last_synced_at, created_at, updated_at, consecutive_failures",
    )
    .eq("is_enabled", true);
  if (error) throw error;

  const active = data.flatMap((row) =>
    isChannel(row.channel) &&
    isFeedActive(
      { channel: row.channel, isEnabled: true, hasUrl: true },
      settings,
    )
      ? [{ ...row, channel: row.channel }]
      : [],
  );
  const runs = await loadRecentRuns(
    db,
    active.map((row) => row.id),
  );

  const feeds = active.flatMap((row): FeedAlert[] => {
    const latest = runs.find((run) => run.calendarId === row.id);
    const failures = row.consecutive_failures;
    if (latest && latest.unreadable > 0) {
      return [
        {
          channel: row.channel,
          health: "unreadable",
          failures,
          unreadable: latest.unreadable,
        },
      ];
    }
    const health = feedHealth(
      {
        channel: row.channel,
        isEnabled: true,
        hasUrl: true,
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        consecutiveFailures: failures,
      },
      now,
    );
    return health === "ok"
      ? []
      : [{ channel: row.channel, health, failures, unreadable: 0 }];
  });

  const releases = runs.flatMap((run): ReleaseNotice[] => {
    const channel = active.find((row) => row.id === run.calendarId)?.channel;
    const age = now.getTime() - Date.parse(run.startedAt);
    return channel && run.released > 0 && age < RELEASE_NOTICE_MS
      ? [{ channel, count: run.released, at: run.startedAt }]
      : [];
  });

  // Saving a link counts as a start, so a new feed gets time for its first run.
  const lastRunAt = [
    ...runs.map((run) => run.startedAt),
    ...active.map((row) => row.updated_at),
  ].reduce<string | null>(
    (latest, at) =>
      latest === null || Date.parse(at) > Date.parse(latest) ? at : latest,
    null,
  );

  return {
    conflicts: await loadConflicts(db),
    feeds,
    releases,
    syncOff: !settings.enabled,
    settingsDamaged: isSettingsDamaged(value),
    noNotificationEmail: !(await hasNotificationEmail(db)),
    automaticSyncMissing:
      lastRunAt !== null &&
      isAutomaticSyncMissing(lastRunAt, settings.intervalMinutes, now),
    staleHours: staleAfterHours(now),
  };
}

const logStatus = z.enum(["running", "success", "failed"]);

async function loadLog(
  admin: AdminContext,
  channels: Map<string, Channel>,
): Promise<SyncLogView[]> {
  if (channels.size === 0) return [];
  const { data, error } = await admin.supabase
    .from("sync_logs")
    .select("id, calendar_id, started_at, status, events_seen, error")
    .in("calendar_id", [...channels.keys()])
    .order("id", { ascending: false })
    .limit(LOG_ROWS);
  if (error) throw error;

  return data.flatMap((row): SyncLogView[] => {
    const channel = channels.get(row.calendar_id);
    const status = logStatus.safeParse(row.status);
    if (!channel || !status.success) return [];
    return [
      {
        id: row.id,
        channel,
        startedAt: row.started_at,
        status: status.data,
        eventsSeen: row.events_seen,
        ...parseRunNotes(row.error),
      },
    ];
  });
}

export interface IntegrationsData {
  roomId: string;
  settings: ChannelSettings;
  feeds: FeedView[];
  log: SyncLogView[];
  exportCreatedAt: string | null;
}

/** Owner only. The one house is the only room for now (D1). */
export async function loadIntegrations(
  admin: AdminContext,
  roomId: string,
): Promise<IntegrationsData> {
  const value = await readSettingsValue(createAdminClient());
  const settings = parseChannelSettings(value);

  // The page has passed requireOwner. Read with the secret key so the link
  // column can be closed to signed-in roles, staff included.
  const { data, error } = await createAdminClient()
    .from("external_calendars")
    .select(
      "id, channel, import_url, is_enabled, last_synced_at, created_at, consecutive_failures",
    )
    .eq("room_id", roomId);
  if (error) throw error;

  const { data: future, error: futureError } = await createAdminClient()
    .from("external_events")
    .select("calendar_id")
    .in(
      "calendar_id",
      data.map((row) => row.id),
    )
    .gt("start_date", athensDate(new Date()));
  if (futureError) throw futureError;
  const futureStays = new Map<string, number>();
  for (const { calendar_id: id } of future) {
    futureStays.set(id, (futureStays.get(id) ?? 0) + 1);
  }

  const now = new Date();
  const feeds = CHANNELS.map((channel): FeedView => {
    const row = data.find((one) => one.channel === channel);
    const input = {
      channel,
      isEnabled: row?.is_enabled ?? false,
      hasUrl: Boolean(row?.import_url),
      lastSyncedAt: row?.last_synced_at ?? null,
      createdAt: row?.created_at ?? now.toISOString(),
      consecutiveFailures: row?.consecutive_failures ?? 0,
    };
    return {
      id: row?.id ?? null,
      channel,
      maskedUrl: row?.import_url ? maskFeedUrl(row.import_url) : null,
      lastSyncedAt: input.lastSyncedAt,
      consecutiveFailures: input.consecutiveFailures,
      health: feedHealth(input, now),
      isActive: isFeedActive(input, settings),
      futureStays: row?.id ? (futureStays.get(row.id) ?? 0) : 0,
    };
  });

  const ids = new Map(
    feeds.flatMap((feed) =>
      feed.id ? [[feed.id, feed.channel] as const] : [],
    ),
  );

  // The token table has no policy for admins, by design.
  const { data: token, error: tokenError } = await createAdminClient()
    .from("ical_export_tokens")
    .select("rotated_at")
    .eq("room_id", roomId)
    .maybeSingle();
  if (tokenError) throw tokenError;

  return {
    roomId,
    settings,
    feeds,
    log: await loadLog(admin, ids),
    exportCreatedAt: token?.rotated_at ?? null,
  };
}
