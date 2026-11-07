import { z } from "zod";
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
  /** Dates a guest is paying for right now also show as taken on the channels. */
  exportHolds: z.boolean().default(true),
});

export type ChannelSettings = z.infer<typeof settingsSchema>;

/** Anything unreadable means off, so a damaged row cannot run a job. */
export function parseChannelSettings(value: unknown): ChannelSettings {
  const parsed = settingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : settingsSchema.parse({});
}

/** No good sync for this long raises the alarm. */
export function staleAfterMs(intervalMinutes: number): number {
  return Math.max(6 * 60, intervalMinutes * 6) * 60_000;
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

export function feedHealth(
  feed: FeedHealthInput,
  settings: ChannelSettings,
  now: Date,
): FeedHealth {
  if (feed.consecutiveFailures >= FAILURE_ALERT_AT) return "failing";
  const since = Date.parse(feed.lastSyncedAt ?? feed.createdAt);
  return now.getTime() - since > staleAfterMs(settings.intervalMinutes)
    ? "stale"
    : "ok";
}
