import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database, Json } from "../db/types";
import { parseChannelSettings, SETTINGS_KEY } from "./settings";
import { loadEmailSettings } from "@/lib/email/settings";
import { channelsEn, type ChannelStrings } from "./strings";
import { channelsEl } from "./strings.el";
import type { ChannelStore, ClaimOnRoom, Feed, HostAlert } from "./sync";
import { isChannel, type Channel } from "./types";

// The job's window on the database. Takes the secret-key client, because cron
// has no signed-in user. Pass it in: this file stays free of server-only so the
// database tests can run it against real functions.

type Db = SupabaseClient<Database>;

/** A run still marked running after this crashed or was killed. */
const RUN_STALE_MS = 10 * 60_000;
const KEEP_LOGS_DAYS = 30;

const upsertResult = z.object({
  is_conflicted: z.boolean(),
  is_new_conflict: z.boolean(),
});

/** Postgres writes a stay as [2027-06-01,2027-06-08). */
export function parseStay(stay: unknown): { start: string; end: string } {
  const match = /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(
    String(stay),
  );
  if (!match) throw new Error("unexpected stay format");
  return { start: match[1], end: match[2] };
}

/**
 * MAIL offers one template for a conflict and one for anything else wrong with
 * a sync, which reads "has failed N times in a row". The plain sentence in
 * `error` says what really happened. calendar_id and alert_kind are not used by
 * the templates: they are how a repeat is found.
 */
function alertEmail(
  alert: HostAlert,
  channelStrings: ChannelStrings,
): {
  template_key: "host_sync_conflict" | "host_sync_failure";
  payload: NonNullable<Json>;
} {
  const channel = channelStrings.names[alert.channel];
  const keys = { calendar_id: alert.calendarId, alert_kind: alert.kind };
  const failure = (failures: number, error: string) => ({
    template_key: "host_sync_failure" as const,
    payload: { ...keys, channel, failures: Math.max(failures, 1), error },
  });

  switch (alert.kind) {
    case "conflict":
      return {
        template_key: "host_sync_conflict",
        payload: {
          ...keys,
          channel,
          checkIn: alert.start,
          checkOut: alert.end,
          ...(alert.summary ? { summary: alert.summary } : {}),
        },
      };
    case "failing":
      return failure(alert.failures, channelStrings.failure[alert.error]);
    case "stale":
      return failure(alert.failures, channelStrings.mail.stale(alert.hours));
    case "unread_events":
      return failure(1, channelStrings.mail.unreadable(alert.count));
    case "stays_released":
      return failure(1, channelStrings.mail.released(alert.count));
  }
}

/** Saves an import link. Signed-in sessions cannot touch this column. */
export async function saveFeedLink(
  db: Db,
  feed: { roomId: string; channel: Channel; url: string },
): Promise<void> {
  const { error } = await db.from("external_calendars").upsert(
    {
      room_id: feed.roomId,
      channel: feed.channel,
      import_url: feed.url,
      is_enabled: true,
      consecutive_failures: 0,
    },
    { onConflict: "room_id,channel" },
  );
  if (error) throw error;
}

export function createChannelStore(db: Db): ChannelStore {
  return {
    async settings() {
      const { data, error } = await db
        .from("settings")
        .select("value")
        .eq("key", SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      return parseChannelSettings(data?.value);
    },

    async feeds() {
      const { data, error } = await db
        .from("external_calendars")
        .select(
          "id, room_id, channel, import_url, is_enabled, last_synced_at, created_at, consecutive_failures",
        )
        .eq("is_enabled", true)
        .not("import_url", "is", null);
      if (error) throw error;
      if (data.length === 0) return [];

      const { data: logs, error: logError } = await db
        .from("sync_logs")
        .select("calendar_id, started_at")
        .in(
          "calendar_id",
          data.map((row) => row.id),
        )
        .order("started_at", { ascending: false })
        .limit(data.length * 20);
      if (logError) throw logError;

      const lastStarted = new Map<string, string>();
      for (const log of logs) {
        if (!lastStarted.has(log.calendar_id)) {
          lastStarted.set(log.calendar_id, log.started_at);
        }
      }

      return data.flatMap((row): Feed[] =>
        isChannel(row.channel)
          ? [
              {
                id: row.id,
                roomId: row.room_id,
                channel: row.channel,
                url: row.import_url,
                isEnabled: row.is_enabled,
                lastSyncedAt: row.last_synced_at,
                createdAt: row.created_at,
                consecutiveFailures: row.consecutive_failures,
                lastStartedAt: lastStarted.get(row.id) ?? null,
              },
            ]
          : [],
      );
    },

    /**
     * Each run adds its row first and then looks for any other. Whichever
     * commits second must see the first, so two runs can never both go ahead.
     * At worst both step aside and the next tick tries again.
     */
    async beginRun(calendarId, now) {
      const staleBefore = new Date(now.getTime() - RUN_STALE_MS).toISOString();
      const { error: sweepError } = await db
        .from("sync_logs")
        .update({
          status: "failed",
          error: "interrupted",
          finished_at: now.toISOString(),
        })
        .eq("calendar_id", calendarId)
        .eq("status", "running")
        .lt("started_at", staleBefore);
      if (sweepError) throw sweepError;

      const { data: mine, error } = await db
        .from("sync_logs")
        .insert({
          calendar_id: calendarId,
          status: "running",
          started_at: now.toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;

      const { data: others, error: readError } = await db
        .from("sync_logs")
        .select("id")
        .eq("calendar_id", calendarId)
        .eq("status", "running")
        .neq("id", mine.id)
        .limit(1);
      if (readError) throw readError;

      if (others.length > 0) {
        await db.from("sync_logs").delete().eq("id", mine.id);
        return null;
      }
      return mine.id;
    },

    async finishRun(runId, now, result) {
      const { error } = await db
        .from("sync_logs")
        .update({
          status: result.status,
          finished_at: now.toISOString(),
          events_seen: result.eventsSeen,
          error: result.detail,
        })
        .eq("id", runId);
      if (error) throw error;

      const cutoff = new Date(now.getTime() - KEEP_LOGS_DAYS * 86_400_000);
      await db
        .from("sync_logs")
        .delete()
        .lt("started_at", cutoff.toISOString());
    },

    async emptySince(calendarId, runId) {
      const { data: breaker, error } = await db
        .from("sync_logs")
        .select("id")
        .eq("calendar_id", calendarId)
        .lt("id", runId)
        .or("status.eq.failed,events_seen.is.null,events_seen.neq.0")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      const { data, error: readError } = await db
        .from("sync_logs")
        .select("started_at")
        .eq("calendar_id", calendarId)
        .eq("status", "success")
        .eq("events_seen", 0)
        .gt("id", breaker?.id ?? 0)
        .lt("id", runId)
        .order("id")
        .limit(1)
        .maybeSingle();
      if (readError) throw readError;
      return data?.started_at ?? null;
    },

    async lastCleanRunAt(calendarId) {
      const { data, error } = await db
        .from("sync_logs")
        .select("started_at")
        .eq("calendar_id", calendarId)
        .eq("status", "success")
        .order("id", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data?.started_at ?? null;
    },

    async startedUids(calendarId, today) {
      const { data, error } = await db
        .from("external_events")
        .select("uid")
        .eq("calendar_id", calendarId)
        .lte("start_date", today);
      if (error) throw error;
      return data.map((row) => row.uid);
    },

    async roomClaims(roomId) {
      const { data, error } = await db
        .from("inventory_claims")
        .select("kind, stay, is_conflicted, external_events (uid, calendar_id)")
        .eq("room_id", roomId);
      if (error) throw error;
      return data.map((row): ClaimOnRoom => {
        const event = row.external_events;
        return {
          kind: row.kind,
          ...parseStay(row.stay),
          isConflicted: row.is_conflicted,
          calendarId: event?.calendar_id ?? null,
          uid: event?.uid ?? null,
        };
      });
    },

    async upsertEvent(calendarId, event) {
      const { data, error } = await db.rpc("upsert_external_event", {
        p_calendar_id: calendarId,
        p_uid: event.uid,
        p_start: event.start,
        p_end: event.end,
        p_summary: event.summary ?? undefined,
      });
      if (error) throw error;
      const result = upsertResult.parse(data);
      return {
        isConflicted: result.is_conflicted,
        isNewConflict: result.is_new_conflict,
      };
    },

    async releaseMissing(calendarId, keep, allowEmpty) {
      const { data, error } = await db.rpc("remove_missing_external_events", {
        p_calendar_id: calendarId,
        p_seen_uids: keep,
        p_allow_empty: allowEmpty,
      });
      if (error) throw error;
      return data;
    },

    async recordSuccess(calendarId, now) {
      const { error } = await db
        .from("external_calendars")
        .update({
          last_synced_at: now.toISOString(),
          consecutive_failures: 0,
        })
        .eq("id", calendarId);
      if (error) throw error;
    },

    async recordFailure(calendarId) {
      const { data, error } = await db
        .from("external_calendars")
        .select("consecutive_failures")
        .eq("id", calendarId)
        .single();
      if (error) throw error;
      // Only the run holding this feed writes here, so the count cannot race.
      const failures = data.consecutive_failures + 1;
      const { error: writeError } = await db
        .from("external_calendars")
        .update({ consecutive_failures: failures })
        .eq("id", calendarId);
      if (writeError) throw writeError;
      return failures;
    },

    async queueAlert(alert) {
      const { data, error } = await db
        .from("property")
        .select("email")
        .maybeSingle();
      if (error) throw error;
      if (!data?.email) return false;

      // The sentence goes into the host's email, so it is in their language.
      const { hostLocale } = await loadEmailSettings(db);
      const words = hostLocale === "el" ? channelsEl : channelsEn;
      const { error: insertError } = await db.from("email_logs").insert({
        ...alertEmail(alert, words),
        locale: hostLocale,
        recipient: data.email,
        status: "queued",
      });
      if (insertError) throw insertError;
      return true;
    },

    async alertQueuedSince(kind, calendarId, since) {
      const { count, error } = await db
        .from("email_logs")
        .select("id", { count: "exact", head: true })
        .eq("payload->>alert_kind", kind)
        .eq("payload->>calendar_id", calendarId)
        .gte("created_at", since);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
  };
}
