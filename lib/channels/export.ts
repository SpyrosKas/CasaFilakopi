import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../db/types";
import type { IsoDate } from "../domain/contracts";
import { addDays, athensDate } from "../domain/dates";
import { classifyEvent } from "./classify";
import { SETTINGS_KEY, parseChannelSettings } from "./settings";
import { parseStay } from "./store";
import { CHANNELS, isChannel, type Channel } from "./types";

// The calendar each channel reads from us (CHN-10). It says one thing per
// stay: these dates are taken. It works from inventory_claims, the single
// record of occupied dates, and never selects a guest column, so no name, email
// or note can reach the file.
//
// What each channel gets:
//   Direct and manual bookings, blocks and, if switched on, live holds.
//   Stays imported from the other channels, because a guest on Airbnb must
//   close Booking.com. Never the channel's own stays (CHN-11).
//   Never another channel's closed dates. Those have no guest to protect, and
//   they are how a loop starts: Booking.com shows our export as closed, we pass
//   that to Airbnb, Airbnb shows it as closed, we pass that back, and the dates
//   hold each other shut for good after the real stay is cancelled. Airbnb
//   labels a closure differently from a sale, which breaks that circle.
//   Booking.com does not, so its events all pass through as possible sales.

const SUMMARY = "Reserved";
const DOMAIN = "casafilakopi.ical";
const KEEP_PAST_DAYS = 30;

export interface ExportClaim {
  kind: "hold" | "booking" | "block" | "external";
  /** The booking, block or event behind the claim. Survives hold to booking. */
  sourceId: string;
  start: IsoDate;
  end: IsoDate;
  /** For an imported event. */
  channel: Channel | null;
  summary: string | null;
  /** For a hold. */
  holdExpiresAt: string | null;
}

export interface ExportEvent {
  uid: string;
  start: IsoDate;
  end: IsoDate;
}

function isExported(
  claim: ExportClaim,
  target: Channel,
  includeHolds: boolean,
  now: Date,
): boolean {
  switch (claim.kind) {
    case "booking":
    case "block":
      return true;
    case "hold":
      return (
        includeHolds &&
        claim.holdExpiresAt !== null &&
        Date.parse(claim.holdExpiresAt) > now.getTime()
      );
    case "external":
      return (
        claim.channel !== null &&
        claim.channel !== target &&
        classifyEvent(claim.channel, claim.summary) !== "block"
      );
  }
}

/** The UID is a hash, so it stays the same and shows nothing about us. */
function exportUid(sourceId: string): string {
  const hash = createHash("sha256").update(sourceId).digest("hex");
  return `${hash.slice(0, 40)}@${DOMAIN}`;
}

export function selectExportEvents(
  claims: ExportClaim[],
  target: Channel,
  includeHolds: boolean,
  now: Date,
): ExportEvent[] {
  return claims
    .filter((claim) => isExported(claim, target, includeHolds, now))
    .map(({ sourceId, start, end }) => ({
      uid: exportUid(sourceId),
      start,
      end,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

const compactDate = (date: IsoDate) => date.replaceAll("-", "");

function stampOf(now: Date): string {
  return now.toISOString().replace(/[-:]|\.\d{3}/g, "");
}

/** Takes only UIDs and dates: nothing else about a stay can be written. */
export function renderCalendar(events: ExportEvent[], now: Date): string {
  const stamp = stampOf(now);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Casa Filakopi//Availability//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];
  for (const { uid, start, end } of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compactDate(start)}`,
      `DTEND;VALUE=DATE:${compactDate(end)}`,
      `SUMMARY:${SUMMARY}`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

const TOKEN_BYTES = 32;
const EXPORT_FILE = new RegExp(
  `^(${CHANNELS.join("|")})-([A-Za-z0-9_-]{43})\\.ics$`,
);

export function createExportToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashExportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * One secret per room, as the table holds. The channel goes in the file name
 * so the feed knows whose stays to leave out. Changing it by hand gets the
 * same dates a different way, so it opens nothing new.
 */
export function exportFileName(channel: Channel, token: string): string {
  return `${channel}-${token}.ics`;
}

export function parseExportFileName(
  name: string,
): { channel: Channel; token: string } | null {
  const match = EXPORT_FILE.exec(name);
  if (!match || !isChannel(match[1])) return null;
  return { channel: match[1], token: match[2] };
}

type Db = SupabaseClient<Database>;

const CLAIM_COLUMNS = `
  kind, stay, booking_id, block_id, external_event_id,
  bookings (holds (expires_at)),
  external_events (summary, external_calendars (channel))
`;

/** Null when the token is not a live one. */
export async function loadExportFeed(
  db: Db,
  fileName: string,
  now: Date,
): Promise<string | null> {
  const parsed = parseExportFileName(fileName);
  if (!parsed) return null;

  const { data: token, error } = await db
    .from("ical_export_tokens")
    .select("room_id")
    .eq("token_hash", hashExportToken(parsed.token))
    .maybeSingle();
  if (error) throw error;
  if (!token) return null;

  const { data: setting, error: settingError } = await db
    .from("settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  if (settingError) throw settingError;
  const { exportHolds } = parseChannelSettings(setting?.value);

  const from = addDays(athensDate(now), -KEEP_PAST_DAYS);
  const { data: rows, error: claimError } = await db
    .from("inventory_claims")
    .select(CLAIM_COLUMNS)
    .eq("room_id", token.room_id)
    .overlaps("stay", `[${from},9999-12-31)`);
  if (claimError) throw claimError;

  const claims = rows.flatMap((row): ExportClaim[] => {
    const sourceId = row.booking_id ?? row.block_id ?? row.external_event_id;
    if (!sourceId) return [];
    const channel = row.external_events?.external_calendars?.channel ?? null;
    return [
      {
        kind: row.kind,
        sourceId,
        ...parseStay(row.stay),
        channel: isChannel(channel) ? channel : null,
        summary: row.external_events?.summary ?? null,
        holdExpiresAt: row.bookings?.holds?.expires_at ?? null,
      },
    ];
  });

  return renderCalendar(
    selectExportEvents(claims, parsed.channel, exportHolds, now),
    now,
  );
}
