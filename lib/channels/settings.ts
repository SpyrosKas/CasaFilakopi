import { z } from "zod";
import { athensDate } from "../domain/dates";
import type { Channel } from "./types";

// Stored in the private settings row "channel_sync".

export const SETTINGS_KEY = "channel_sync";
export const SYNC_INTERVALS = [10, 15, 30, 60] as const;

/** A failing feed raises the alarm on this try, once. */
export const FAILURE_ALERT_AT = 3;

const settingsSchema = z.object({
  enabled: z.boolean().default(false),
  channels: z
    .object({
      airbnb: z.boolean().default(true),
      booking_com: z.boolean().default(true),
      other_ical: z.boolean().default(true),
    })
    .prefault({}),
  intervalMinutes: z.literal(SYNC_INTERVALS).default(15),
  /**
   * Off until real feeds are checked (D28). A channel showing a hold back to us
   * as closed could trigger an automatic refund for a guest who is paying.
   */
  exportHolds: z.boolean().default(false),
});

export type ChannelSettings = z.infer<typeof settingsSchema>;

/** Anything unreadable means off, so a damaged row cannot run a job. */
export function parseChannelSettings(value: unknown): ChannelSettings {
  const parsed = settingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

/** The screens warn about this, because it silently means off. */
export function isSettingsDamaged(value: unknown): boolean {
  return !settingsSchema.safeParse(value ?? {}).success;
}

const SEASON_MONTHS = ["06", "07", "08", "09"];

/** No good sync for this long raises the alarm: sooner in the busy months. */
export function staleAfterHours(now: Date): number {
  return SEASON_MONTHS.includes(athensDate(now).slice(5, 7)) ? 3 : 6;
}

export interface FeedHealthInput {
  channel: Channel;
  isEnabled: boolean;
  hasUrl: boolean;
  lastSyncedAt: string | null;
  createdAt: string;
  consecutiveFailures: number;
}

export function isFeedActive(
  feed: Pick<FeedHealthInput, "channel" | "isEnabled" | "hasUrl">,
  settings: ChannelSettings,
): boolean {
  return (
    settings.enabled &&
    settings.channels[feed.channel] &&
    feed.isEnabled &&
    feed.hasUrl
  );
}

export type FeedHealth = "ok" | "failing" | "stale";

export function feedHealth(feed: FeedHealthInput, now: Date): FeedHealth {
  if (feed.consecutiveFailures >= FAILURE_ALERT_AT) return "failing";
  const since = Date.parse(feed.lastSyncedAt ?? feed.createdAt);
  return now.getTime() - since > staleAfterHours(now) * 3_600_000
    ? "stale"
    : "ok";
}

/** How long after the last run a missing scheduler becomes worth saying. */
export function isAutomaticSyncMissing(
  lastRunAt: string,
  intervalMinutes: number,
  now: Date,
): boolean {
  const allowed = Math.max(intervalMinutes * 2 + 5, 30) * 60_000;
  return now.getTime() - Date.parse(lastRunAt) > allowed;
}
