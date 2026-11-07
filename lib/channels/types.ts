import type { IsoDate } from "../domain/contracts";

// The words shared by everything in lib/channels. Booking and availability
// logic knows none of this: it only ever sees rows in inventory_claims.

export const CHANNELS = ["airbnb", "booking_com", "other_ical"] as const;
export type Channel = (typeof CHANNELS)[number];

export function isChannel(value: unknown): value is Channel {
  return CHANNELS.includes(value as Channel);
}

/** An event read from a channel, in stay terms: the end date is free again. */
export interface FeedEvent {
  uid: string;
  start: IsoDate;
  end: IsoDate;
  summary: string | null;
}

/**
 * reservation: a guest is staying.
 * block: closed dates with no guest, so never a double booking.
 * ambiguous: could be either. Booking.com labels both the same way.
 */
export type EventKind = "reservation" | "block" | "ambiguous";

/** Why a feed could not be used. Codes, so no address ever reaches a log. */
export type FeedErrorCode =
  | "bad_url"
  | "not_https"
  | "blocked_address"
  | "timeout"
  | "too_large"
  | "too_many_redirects"
  | "http_error"
  | "network_error"
  | "malformed"
  | "too_many_events";

export type SyncErrorCode = FeedErrorCode | "storage_error" | "interrupted";

export type PullResult =
  | {
      ok: true;
      events: FeedEvent[];
      /** Events that could not be read. Any at all stops the release step. */
      unreadable: number;
    }
  | { ok: false; code: FeedErrorCode };

/**
 * One way of talking to a channel (CHN-17). iCal is the only one today. A
 * real-time channel manager such as Beds24 adds a second provider, chosen in
 * providers.ts. It hands back the same events, so the sync job, the RPCs and
 * the booking logic stay as they are.
 */
export interface ChannelProvider {
  id: string;
  /** Reads everything the channel currently shows, or says why it cannot. */
  pull(source: string, today: IsoDate): Promise<PullResult>;
  /** What an event means, from its channel and label. */
  classify(channel: Channel, summary: string | null): EventKind;
}
