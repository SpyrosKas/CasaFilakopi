import "server-only";
import { z } from "zod";
import type { AdminContext } from "@/lib/admin/session";
import { createAdminClient } from "@/lib/db/admin";
import { athensDate } from "@/lib/domain/dates";
import { classifyEvent } from "./classify";
import { maskFeedUrl } from "./safe-url";
import {
  feedHealth,
  isFeedActive,
  parseChannelSettings,
  SETTINGS_KEY,
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
}

export interface SyncLogView {
  id: number;
  channel: Channel;
  startedAt: string;
  status: "running" | "success" | "failed";
  eventsSeen: number | null;
  error: SyncErrorCode | null;
}

export interface ConflictView {
  id: string;
  channel: Channel;
  start: string;
  end: string;
}

export interface FeedAlert {
  channel: Channel;
  health: Exclude<FeedHealth, "ok">;
  failures: number;
}

export interface ChannelAlerts {
  conflicts: ConflictView[];
  feeds: FeedAlert[];
}

const MAX_CONFLICTS = 50;
const LOG_ROWS = 20;

async function loadSettings(admin: AdminContext): Promise<ChannelSettings> {
  const { data, error } = await admin.supabase
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (error) throw error;
  return parseChannelSettings(data?.value);
}

/** Double bookings still standing. Closed dates with no guest do not count. */
async function loadConflicts(admin: AdminContext): Promise<ConflictView[]> {
  const today = athensDate(new Date());
  const { data, error } = await admin.supabase
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

/** For the home page and the Channel sync screen. Safe for staff. */
export async function loadChannelAlerts(
  admin: AdminContext,
): Promise<ChannelAlerts> {
  const settings = await loadSettings(admin);
  const conflicts = await loadConflicts(admin);

  // The link column is not selected: this runs for staff too.
  const { data, error } = await admin.supabase
    .from("external_calendars")
    .select(
      "channel, is_enabled, last_synced_at, created_at, consecutive_failures",
    )
    .eq("is_enabled", true);
  if (error) throw error;

  const now = new Date();
  const feeds = data.flatMap((row): FeedAlert[] => {
    if (!isChannel(row.channel) || !settings.enabled) return [];
    if (!settings.channels[row.channel]) return [];
    const health = feedHealth(
      {
        channel: row.channel,
        isEnabled: row.is_enabled,
        hasUrl: true,
        lastSyncedAt: row.last_synced_at,
        createdAt: row.created_at,
        consecutiveFailures: row.consecutive_failures,
      },
      settings,
      now,
    );
    return health === "ok"
      ? []
      : [
          {
            channel: row.channel,
            health,
            failures: row.consecutive_failures,
          },
        ];
  });

  return { conflicts, feeds };
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
        error: row.error as SyncErrorCode | null,
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
  const settings = await loadSettings(admin);

  // The page has passed requireOwner. Read with the secret key so the link
  // column can be closed to signed-in roles, staff included.
  const { data, error } = await createAdminClient()
    .from("external_calendars")
    .select(
      "id, channel, import_url, is_enabled, last_synced_at, created_at, consecutive_failures",
    )
    .eq("room_id", roomId);
  if (error) throw error;

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
      health: feedHealth(input, settings, now),
      isActive: isFeedActive(input, settings),
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
