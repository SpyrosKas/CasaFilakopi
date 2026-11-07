import type { IsoDate } from "../domain/contracts";
import { addDays, athensDate, isValidIsoDate } from "../domain/dates";
import type { FeedErrorCode, FeedEvent } from "./types";

// A small RFC 5545 reader, written here rather than taken from a library. The
// feeds use a tiny part of the format, and the libraries bring recurrence
// engines and time zone databases this does not need. It reads untrusted text,
// so it has hard limits and one strict rule: a feed it cannot read in full is
// refused as a whole, because a half-read feed looks like cancelled bookings.

export const FEED_LIMITS = {
  maxEvents: 5_000,
  maxLines: 200_000,
  maxLineLength: 16_384,
  maxDepth: 8,
  maxUidLength: 512,
  maxSummaryLength: 200,
  /** Stays that ended longer ago than this are ignored. */
  pastDays: 30,
  /** Stays starting later are ignored, and longer ones are cut off here. */
  futureDays: 1_461,
};

const DAY_MS = 86_400_000;

export type ParseResult =
  | {
      ok: true;
      events: FeedEvent[];
      /** Events whose dates cannot be understood, or that repeat. */
      unreadable: number;
      cancelled: number;
      ignored: number;
    }
  | {
      ok: false;
      code: Extract<FeedErrorCode, "malformed" | "too_many_events">;
    };

interface Property {
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  uid?: string;
  dtstart?: Property;
  dtend?: Property;
  duration?: string;
  status?: string;
  summary?: string;
  sequence?: string;
  recurs: boolean;
}

/** Joins folded lines. Returns null when the text is over a limit. */
function unfold(text: string): string[] | null {
  const lines: string[] = [];
  let parts: string[] = [];
  let length = 0;

  const flush = () => {
    if (parts.length > 0) lines.push(parts.join(""));
    parts = [];
    length = 0;
  };

  for (const line of text.split(/\r\n|\n|\r/)) {
    const folded = line.startsWith(" ") || line.startsWith("\t");
    if (!folded) flush();
    const piece = folded ? line.slice(1) : line;
    length += piece.length;
    if (length > FEED_LIMITS.maxLineLength) return null;
    if (lines.length > FEED_LIMITS.maxLines) return null;
    parts.push(piece);
  }
  flush();
  return lines;
}

/** Splits NAME;PARAM=value:VALUE. A colon inside quotes is not the divider. */
function parseProperty(line: string): (Property & { name: string }) | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    if (char === ":" && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;

  const [name, ...rawParams] = line.slice(0, colon).split(";");
  const params: Record<string, string> = {};
  for (const raw of rawParams) {
    const equals = raw.indexOf("=");
    if (equals > 0) {
      params[raw.slice(0, equals).toUpperCase()] = raw
        .slice(equals + 1)
        .replace(/^"|"$/g, "");
    }
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** RFC 5545 TEXT escapes. */
function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );
}

/** Removes what Postgres text cannot hold and what no label needs. */
function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(zone: string): Intl.DateTimeFormat {
  let format = zoneFormats.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    zoneFormats.set(zone, format);
  }
  return format;
}

function zoneOffsetMs(instant: number, zone: string): number {
  const parts = Object.fromEntries(
    zoneFormat(zone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const wall = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wall - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall clock in this zone showed this time. */
function wallToInstant(wall: number, zone: string): number {
  const first = wall - zoneOffsetMs(wall, zone);
  return wall - zoneOffsetMs(first, zone);
}

/**
 * All-day values and floating times keep the date they state. A time with a
 * zone is an instant, read as a date on Milos.
 */
type Moment =
  | { type: "date" | "floating"; wall: number }
  | { type: "instant"; instant: number };

const DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/;
const TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;

function parseMoment({ params, value }: Property): Moment | null {
  const text = value.trim();

  const dateOnly = DATE_VALUE.exec(text);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    const date = `${y}-${m}-${d}`;
    return isValidIsoDate(date)
      ? { type: "date", wall: Date.parse(`${date}T00:00:00Z`) }
      : null;
  }

  const time = TIME_VALUE.exec(text);
  if (!time || params.VALUE === "DATE") return null;
  const [, y, m, d, hh, mm, ss, zulu] = time;
  const date = `${y}-${m}-${d}`;
  if (!isValidIsoDate(date) || +hh > 23 || +mm > 59 || +ss > 60) return null;
  const wall = Date.parse(`${date}T${hh}:${mm}:${ss === "60" ? "59" : ss}Z`);

  if (zulu) return { type: "instant", instant: wall };
  if (params.TZID) {
    try {
      return { type: "instant", instant: wallToInstant(wall, params.TZID) };
    } catch {
      // A zone name only this feed knows. Its wall clock is the best we have.
    }
  }
  return { type: "floating", wall };
}

function plus(moment: Moment, ms: number): Moment {
  return moment.type === "instant"
    ? { ...moment, instant: moment.instant + ms }
    : { ...moment, wall: moment.wall + ms };
}

function dateOf(moment: Moment): IsoDate | null {
  const ms = moment.type === "instant" ? moment.instant : moment.wall;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return null;
  const iso =
    moment.type === "instant"
      ? athensDate(date)
      : date.toISOString().slice(0, 10);
  return isValidIsoDate(iso) ? iso : null;
}

const DURATION =
  /^\+?P(?:(\d{1,6})W)?(?:(\d{1,6})D)?(?:T(?:(\d{1,6})H)?(?:(\d{1,6})M)?(?:(\d{1,6})S)?)?$/;

function durationMs(value: string): number | null {
  const match = DURATION.exec(value.trim());
  if (!match) return null;
  const [weeks, days, hours, minutes, seconds] = match
    .slice(1)
    .map((part) => Number(part ?? 0));
  return (
    (weeks * 7 + days) * DAY_MS +
    (hours * 3_600 + minutes * 60 + seconds) * 1_000
  );
}

function stayDates(raw: RawEvent): { start: IsoDate; end: IsoDate } | null {
  if (!raw.dtstart) return null;
  const startMoment = parseMoment(raw.dtstart);
  if (!startMoment) return null;
  const start = dateOf(startMoment);
  if (!start) return null;

  let end: IsoDate | null = null;
  if (raw.dtend) {
    const endMoment = parseMoment(raw.dtend);
    if (!endMoment) return null;
    end = dateOf(endMoment);
    if (!end) return null;
  } else if (raw.duration !== undefined) {
    const ms = durationMs(raw.duration);
    if (ms === null) return null;
    end = dateOf(plus(startMoment, ms));
  }

  // No end at all, or an end on or before the start: at least that day is gone.
  return { start, end: end && end > start ? end : addDays(start, 1) };
}

function sequenceOf(raw: RawEvent): number {
  const value = Number.parseInt(raw.sequence ?? "0", 10);
  return Number.isSafeInteger(value) ? value : 0;
}

interface Dated {
  raw: RawEvent;
  uid: string;
  start: IsoDate;
  end: IsoDate;
  summary: string | null;
}

/**
 * A UID may appear twice, and the table keeps one row per UID, so the last
 * copy would silently free the other's dates. The highest SEQUENCE is the
 * current version. Copies of the same version all count: overlapping ones
 * become one stay, and a separate one keeps its dates under a derived UID.
 */
function resolveDuplicates(all: Dated[]): {
  events: FeedEvent[];
  cancelled: number;
} {
  const byUid = new Map<string, Dated[]>();
  for (const event of all) {
    const copies = byUid.get(event.uid);
    if (copies) copies.push(event);
    else byUid.set(event.uid, [event]);
  }

  const events: FeedEvent[] = [];
  let cancelled = 0;

  for (const [uid, copies] of byUid) {
    const latest = copies.reduce(
      (highest, { raw }) => Math.max(highest, sequenceOf(raw)),
      Number.MIN_SAFE_INTEGER,
    );
    const active = copies
      .filter(
        ({ raw }) => sequenceOf(raw) === latest && raw.status !== "CANCELLED",
      )
      .sort((a, b) => a.start.localeCompare(b.start));

    if (active.length === 0) {
      cancelled += 1;
      continue;
    }

    const merged: FeedEvent[] = [];
    for (const { start, end, summary } of active) {
      const last = merged[merged.length - 1];
      if (last && start <= last.end) {
        if (end > last.end) last.end = end;
      } else {
        merged.push({
          uid: merged.length === 0 ? uid : `${uid}#${start}`,
          start,
          end,
          summary,
        });
      }
    }
    events.push(...merged);
  }

  return { events, cancelled };
}

function applyProperty(event: RawEvent, property: Property & { name: string }) {
  const { name, value } = property;
  switch (name) {
    case "UID":
      event.uid ??= value;
      break;
    case "DTSTART":
      event.dtstart ??= property;
      break;
    case "DTEND":
      event.dtend ??= property;
      break;
    case "DURATION":
      event.duration ??= value;
      break;
    case "STATUS":
      event.status ??= value.trim().toUpperCase();
      break;
    case "SUMMARY":
      event.summary ??= value;
      break;
    case "SEQUENCE":
      event.sequence ??= value;
      break;
    case "RRULE":
    case "RDATE":
      event.recurs = true;
      break;
  }
}

/** The shape of the file, before any event is judged. Null when malformed. */
function readEvents(
  text: string,
): RawEvent[] | Extract<ParseResult, { ok: false }> {
  const malformed = { ok: false, code: "malformed" } as const;
  const lines = unfold(text.replace(/^﻿/, ""));
  if (!lines) return malformed;

  const stack: string[] = [];
  const raws: RawEvent[] = [];
  let calendars = 0;
  let current: RawEvent | null = null;

  for (const line of lines) {
    if (line.trim() === "") continue;

    const property = parseProperty(line);
    const value = property?.value.trim().toUpperCase() ?? "";

    if (property?.name === "BEGIN") {
      if (stack.length === 0 && value !== "VCALENDAR") return malformed;
      if (stack.length >= FEED_LIMITS.maxDepth) return malformed;
      stack.push(value);
      if (stack.length === 1) calendars += 1;
      if (value === "VEVENT" && stack.length === 2) {
        if (raws.length >= FEED_LIMITS.maxEvents) {
          return { ok: false, code: "too_many_events" };
        }
        current = { recurs: false };
        raws.push(current);
      }
    } else if (property?.name === "END") {
      if (stack.pop() !== value) return malformed;
      if (value === "VEVENT" && stack.length === 1) current = null;
    } else if (stack.length === 0) {
      // Text outside any calendar: this is not a calendar, or not all of one.
      return malformed;
    } else if (current && property && stack.length === 2) {
      applyProperty(current, property);
    }
  }

  // Cut off part-way, such as a dropped connection. Never treat it as complete.
  return stack.length === 0 && calendars > 0 ? raws : malformed;
}

/** `today` is the date on Milos, which sets the window of dates kept. */
export function parseIcal(text: string, today: IsoDate): ParseResult {
  const raws = readEvents(text);
  if (!Array.isArray(raws)) return raws;

  const oldest = addDays(today, -FEED_LIMITS.pastDays);
  const furthest = addDays(today, FEED_LIMITS.futureDays);
  const dated: Dated[] = [];
  let unreadable = 0;
  let ignored = 0;

  for (const raw of raws) {
    const stay = stayDates(raw);
    const uid = cleanText(raw.uid ?? "");
    if (!stay || uid.length > FEED_LIMITS.maxUidLength) {
      unreadable += 1;
      continue;
    }
    // Repeating events are not expanded. The first date still blocks.
    if (raw.recurs) unreadable += 1;
    if (stay.end < oldest || stay.start >= furthest) {
      ignored += 1;
      continue;
    }
    const summary = cleanText(unescapeText(raw.summary ?? "")).slice(
      0,
      FEED_LIMITS.maxSummaryLength,
    );
    dated.push({
      raw,
      // Without a UID the event still blocks, under a name that stays the same.
      uid: uid || `no-uid-${stay.start}-${stay.end}`,
      start: stay.start,
      end: stay.end > furthest ? furthest : stay.end,
      summary: summary || null,
    });
  }

  const { events, cancelled } = resolveDuplicates(dated);
  return { ok: true, events, unreadable, cancelled, ignored };
}
