import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import type { Database } from "../../lib/db/types";
import {
  createExportToken,
  exportFileName,
  hashExportToken,
  loadExportFeed,
} from "../../lib/channels/export";
import { parseIcal } from "../../lib/channels/ical-parser";
import { createIcalProvider } from "../../lib/channels/providers";
import { createChannelStore } from "../../lib/channels/store";
import { syncFeed, type Feed } from "../../lib/channels/sync";
import type { Channel } from "../../lib/channels/types";
import { confirm, createHold, createRoom, db } from "./helpers";

// The sync job against the real database functions, on rooms of its own. The
// shared local database has other tracks writing to it, so nothing here touches
// a row it did not create.

function localEnv(): { url: string; key: string } {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // CI runs these before it writes that file.
  }
  const { NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_SECRET_KEY: key } =
    process.env;
  if (url && key) return { url, key };

  const status = execSync("supabase status -o env", { encoding: "utf8" });
  const read = (name: string) =>
    new RegExp(`^${name}="?([^"\\n]+)"?$`, "m").exec(status)?.[1] ?? "";
  return { url: read("API_URL"), key: read("SECRET_KEY") };
}

const { url, key } = localEnv();
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
  throw new Error("Channel tests run against local Supabase only");
}

const client = createClient<Database>(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const store = createChannelStore(client);

const rooms: string[] = [];

async function newRoom() {
  const roomId = await createRoom();
  rooms.push(roomId);
  return roomId;
}

afterAll(async () => {
  await db.query(
    `delete from public.payments where booking_id in (
       select id from public.bookings where room_id = any($1::uuid[])
     )`,
    [rooms],
  );
  await db.query(
    `delete from public.email_logs
     where payload ->> 'calendar_id' in (
       select id::text from public.external_calendars where room_id = any($1::uuid[])
     )`,
    [rooms],
  );
  await db.query(
    `delete from public.inventory_claims where room_id = any($1::uuid[])`,
    [rooms],
  );
  await db.query(
    `delete from public.external_calendars where room_id = any($1::uuid[])`,
    [rooms],
  );
  await db.query(
    `delete from public.ical_export_tokens where room_id = any($1::uuid[])`,
    [rooms],
  );
  const { rows: guests } = await db.query(
    `delete from public.bookings where room_id = any($1::uuid[]) returning guest_id`,
    [rooms],
  );
  await db.query(`delete from public.guests where id = any($1::uuid[])`, [
    guests.map((row) => row.guest_id),
  ]);
  await db.query(`delete from public.rooms where id = any($1::uuid[])`, [
    rooms,
  ]);
  await db.end();
});

async function newFeed(
  roomId: string,
  channel: Channel = "airbnb",
): Promise<Feed> {
  const { rows } = await db.query(
    `insert into public.external_calendars (room_id, channel, import_url, is_enabled)
     values ($1, $2, 'https://example.test/feed.ics', true)
     returning id, created_at`,
    [roomId, channel],
  );
  return {
    id: rows[0].id,
    roomId,
    channel,
    url: "https://example.test/feed.ics",
    isEnabled: true,
    lastSyncedAt: null,
    createdAt: rows[0].created_at,
    consecutiveFailures: 0,
    lastStartedAt: null,
  };
}

interface Stay {
  uid: string;
  start: string;
  end: string;
  summary?: string;
  status?: string;
}

const compact = (date: string) => date.replaceAll("-", "");

const ics = (...stays: Stay[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...stays.flatMap((stay) => [
      "BEGIN:VEVENT",
      `UID:${stay.uid}`,
      `DTSTART;VALUE=DATE:${compact(stay.start)}`,
      `DTEND;VALUE=DATE:${compact(stay.end)}`,
      `SUMMARY:${stay.summary ?? "Reserved"}`,
      ...(stay.status ? [`STATUS:${stay.status}`] : []),
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const sync = (feed: Feed, text: string) =>
  syncFeed(feed, {
    store,
    provider: createIcalProvider(async () => ({ ok: true, text })),
  });

const syncFailing = (feed: Feed) =>
  syncFeed(feed, {
    store,
    provider: createIcalProvider(async () => ({
      ok: false,
      code: "network_error",
    })),
  });

const storedUids = async (feed: Feed) =>
  (
    await db.query(
      `select uid from public.external_events where calendar_id = $1 order by uid`,
      [feed.id],
    )
  ).rows.map((row) => row.uid as string);

const claimsOn = async (roomId: string) =>
  (
    await db.query(
      `select kind, lower(stay)::text as start, upper(stay)::text as "end", is_conflicted
       from public.inventory_claims where room_id = $1 order by lower(stay)`,
      [roomId],
    )
  ).rows;

const isConflicted = async (feed: Feed, uid: string) =>
  (
    await db.query(
      `select c.is_conflicted from public.inventory_claims c
       join public.external_events e on e.id = c.external_event_id
       where e.calendar_id = $1 and e.uid = $2`,
      [feed.id, uid],
    )
  ).rows[0]?.is_conflicted as boolean | undefined;

const alertsFor = async (feed: Feed, template: string) =>
  (
    await db.query(
      `select status, payload from public.email_logs
       where template_key = $1 and payload ->> 'calendar_id' = $2`,
      [template, feed.id],
    )
  ).rows;

const JUNE = { start: "2029-06-01", end: "2029-06-08" };
const JULY = { start: "2029-07-01", end: "2029-07-08" };

async function directBooking(roomId: string, stay = JUNE, name = "Test Guest") {
  const bookingId = await createHold({
    roomId,
    checkIn: stay.start,
    checkOut: stay.end,
    name,
  });
  await confirm(bookingId);
  return bookingId;
}

describe("importing", () => {
  it("stores events, blocks the dates, and updates by UID", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);

    const first = await sync(feed, ics({ uid: "a", ...JUNE }));
    expect(first).toMatchObject({ status: "success", eventsSeen: 1 });
    expect(await claimsOn(roomId)).toEqual([
      { kind: "external", ...JUNE, is_conflicted: false },
    ]);

    await sync(feed, ics({ uid: "a", ...JULY }));
    expect(await claimsOn(roomId)).toEqual([
      { kind: "external", ...JULY, is_conflicted: false },
    ]);
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("leaves the check-out day free for the next guest", async () => {
    const roomId = await newRoom();
    await sync(await newFeed(roomId), ics({ uid: "a", ...JUNE }));
    await expect(
      createHold({ roomId, checkIn: JUNE.end, checkOut: "2029-06-10" }),
    ).resolves.toBeTruthy();
  });

  it("refuses a direct booking on imported dates", async () => {
    const roomId = await newRoom();
    await sync(await newFeed(roomId), ics({ uid: "a", ...JUNE }));
    await expect(
      createHold({ roomId, checkIn: JUNE.start, checkOut: JUNE.end }),
    ).rejects.toThrow("dates_unavailable");
  });

  it("releases an event that has gone, and keeps the others", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "b", ...JULY }));
    const result = await sync(feed, ics({ uid: "b", ...JULY }));
    expect(result).toMatchObject({ released: 1 });
    expect(await storedUids(feed)).toEqual(["b"]);
    expect(await claimsOn(roomId)).toHaveLength(1);
  });

  it("releases a cancelled event", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "b", ...JULY }));
    await sync(
      feed,
      ics({ uid: "a", ...JUNE, status: "CANCELLED" }, { uid: "b", ...JULY }),
    );
    expect(await storedUids(feed)).toEqual(["b"]);
  });

  it("keeps both stays when a feed repeats a UID", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "a", ...JULY }));
    expect(await claimsOn(roomId)).toHaveLength(2);
  });

  it("records the run and the time of the last good sync", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    const { rows } = await db.query(
      `select status, events_seen, finished_at is not null as finished
       from public.sync_logs where calendar_id = $1`,
      [feed.id],
    );
    expect(rows).toEqual([
      { status: "success", events_seen: 1, finished: true },
    ]);
    const calendar = await db.query(
      `select last_synced_at, consecutive_failures from public.external_calendars where id = $1`,
      [feed.id],
    );
    expect(calendar.rows[0].last_synced_at).not.toBeNull();
    expect(calendar.rows[0].consecutive_failures).toBe(0);
  });

  it("keeps a finished stay, with Yorgos's amount, when it leaves the feed", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    const { rows } = await db.query(
      `select public.upsert_external_event($1, 'old', '2026-10-01', '2026-10-05') as r`,
      [feed.id],
    );
    await db.query(
      `update public.external_events set amount_cents = 90000 where id = $1`,
      [rows[0].r.event_id],
    );

    await sync(feed, ics({ uid: "a", ...JUNE }));
    await sync(feed, ics());
    await sync(feed, ics());

    expect(await storedUids(feed)).toEqual(["old"]);
  });
});

describe("safety: an empty feed", () => {
  it("releases nothing the first time", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));

    const result = await sync(feed, ics());
    expect(result).toMatchObject({ status: "success", released: 0 });
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("releases only on the second empty fetch in a row", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await sync(feed, ics());
    const result = await sync(feed, ics());
    expect(result).toMatchObject({ released: 1 });
    expect(await storedUids(feed)).toEqual([]);
  });

  it("starts counting again after a fetch with events", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await sync(feed, ics());
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await sync(feed, ics());
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("starts counting again after a failed fetch between them", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await sync(feed, ics());
    await syncFailing(feed);
    await sync(feed, ics());
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("the database function refuses it too", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await expect(store.releaseMissing(feed.id, [], false)).rejects.toThrow();
    expect(await storedUids(feed)).toEqual(["a"]);
  });
});

describe("safety: a failed or unreadable fetch", () => {
  it("releases nothing when the fetch fails", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));

    expect(await syncFailing(feed)).toEqual({
      status: "failed",
      error: "network_error",
    });
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("releases nothing from a malformed feed", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));

    const result = await sync(feed, "<html>We are down for maintenance</html>");
    expect(result).toEqual({ status: "failed", error: "malformed" });
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("releases nothing from a feed cut off part-way", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "b", ...JULY }));
    const whole = ics({ uid: "b", ...JULY });
    await sync(feed, whole.slice(0, whole.indexOf("END:VCALENDAR")));
    expect(await storedUids(feed)).toEqual(["a", "b"]);
  });

  it("releases nothing while some events cannot be read", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "b", ...JULY }));
    const damaged = ics({ uid: "b", ...JULY }).replace(
      "BEGIN:VEVENT",
      "BEGIN:VEVENT\r\nUID:bad\r\nDTSTART:never\r\nEND:VEVENT\r\nBEGIN:VEVENT",
    );
    await sync(feed, damaged);
    expect(await storedUids(feed)).toEqual(["a", "b"]);
  });

  it("does not take a run with unreadable events for an empty one", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    const onlyBad = ics().replace(
      "END:VCALENDAR",
      "BEGIN:VEVENT\r\nUID:bad\r\nDTSTART:never\r\nEND:VEVENT\r\nEND:VCALENDAR",
    );
    await sync(feed, onlyBad);
    await sync(feed, ics());
    expect(await storedUids(feed)).toEqual(["a"]);
  });

  it("rides out a feed that is down for hours, then back", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }, { uid: "b", ...JULY }));

    for (let run = 0; run < 12; run += 1) await syncFailing(feed);
    expect(await storedUids(feed)).toEqual(["a", "b"]);
    expect(await alertsFor(feed, "host_channel_sync_failing")).toHaveLength(1);

    const back = await sync(feed, ics({ uid: "b", ...JULY }));
    expect(back).toMatchObject({ status: "success", released: 1 });
    const { rows } = await db.query(
      `select consecutive_failures from public.external_calendars where id = $1`,
      [feed.id],
    );
    expect(rows[0].consecutive_failures).toBe(0);
  });

  it("logs only a code, never the link", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await syncFailing(feed);
    const { rows } = await db.query(
      `select status, error from public.sync_logs where calendar_id = $1`,
      [feed.id],
    );
    expect(rows).toEqual([{ status: "failed", error: "network_error" }]);
  });
});

describe("conflicts", () => {
  it("flags an overlap with a direct booking and queues one email", async () => {
    const roomId = await newRoom();
    await directBooking(roomId);
    const feed = await newFeed(roomId);

    const stay = { uid: "a", ...JUNE, summary: "Reserved" };
    const first = await sync(feed, ics(stay));
    expect(first).toMatchObject({ status: "success", newConflicts: 1 });
    expect(await isConflicted(feed, "a")).toBe(true);

    await sync(feed, ics(stay));
    await sync(feed, ics(stay));

    const alerts = await alertsFor(feed, "host_channel_conflict");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].status).toBe("queued");
    expect(alerts[0].payload).toMatchObject({
      channel: "airbnb",
      start: JUNE.start,
      end: JUNE.end,
    });
    expect(JSON.stringify(alerts[0].payload)).not.toContain("example.test");
  });

  it("clears the flag once the dates no longer overlap", async () => {
    const roomId = await newRoom();
    const bookingId = await directBooking(roomId);
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    await db.query(`select public.cancel_booking($1, 'test')`, [bookingId]);
    await sync(feed, ics({ uid: "a", ...JUNE }));
    expect(await isConflicted(feed, "a")).toBe(false);
  });

  it("does not alarm when a booking changes and gets a new UID", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "old", ...JUNE }));

    const moved = { uid: "new", start: "2029-06-03", end: "2029-06-10" };
    const result = await sync(feed, ics(moved));

    expect(result).toMatchObject({ newConflicts: 0 });
    expect(await isConflicted(feed, "new")).toBe(false);
    expect(await alertsFor(feed, "host_channel_conflict")).toHaveLength(0);
    expect(await storedUids(feed)).toEqual(["new"]);
  });

  it("treats a closure on Airbnb over our booking as our own dates", async () => {
    const roomId = await newRoom();
    await directBooking(roomId);
    const feed = await newFeed(roomId);

    const echo = { uid: "e", ...JUNE, summary: "Airbnb (Not available)" };
    const result = await sync(feed, ics(echo));

    expect(result).toMatchObject({ status: "success", newConflicts: 0 });
    expect(await storedUids(feed)).toEqual([]);
    expect(await claimsOn(roomId)).toHaveLength(1);
  });

  it("does not put a paying guest's hold at risk from that echo", async () => {
    const roomId = await newRoom();
    const bookingId = await createHold({
      roomId,
      checkIn: JUNE.start,
      checkOut: JUNE.end,
    });
    const feed = await newFeed(roomId);
    await sync(feed, ics({ uid: "e", ...JUNE, summary: "Not available" }));
    expect((await confirm(bookingId)).outcome).toBe("confirmed");
  });

  it("still imports a closure once the booking under it has gone", async () => {
    const roomId = await newRoom();
    const bookingId = await directBooking(roomId);
    const feed = await newFeed(roomId);
    const closed = { uid: "e", ...JUNE, summary: "Airbnb (Not available)" };
    await sync(feed, ics(closed));
    await db.query(`select public.cancel_booking($1, 'test')`, [bookingId]);
    await sync(feed, ics(closed));
    expect(await storedUids(feed)).toEqual(["e"]);
  });

  it("never treats a possible sale as an echo", async () => {
    const roomId = await newRoom();
    await directBooking(roomId);
    const feed = await newFeed(roomId, "booking_com");

    const closed = { uid: "b", ...JUNE, summary: "CLOSED - Not available" };
    const result = await sync(feed, ics(closed));

    expect(result).toMatchObject({ newConflicts: 1 });
    expect(await isConflicted(feed, "b")).toBe(true);
  });

  it("does not raise the alarm for a closure that only partly overlaps", async () => {
    const roomId = await newRoom();
    await directBooking(roomId);
    const feed = await newFeed(roomId);
    const closed = {
      uid: "e",
      start: "2029-06-05",
      end: "2029-06-12",
      summary: "Airbnb (Not available)",
    };
    expect(await sync(feed, ics(closed))).toMatchObject({ newConflicts: 0 });
    expect(await isConflicted(feed, "e")).toBe(true);
  });
});

describe("running at the same time", () => {
  const countingProvider = () => {
    const seen = { running: 0, most: 0 };
    const provider = createIcalProvider(async () => {
      seen.running += 1;
      seen.most = Math.max(seen.most, seen.running);
      await new Promise((resolve) => setTimeout(resolve, 30));
      seen.running -= 1;
      return { ok: true, text: ics({ uid: "a", ...JUNE }) };
    });
    return { seen, provider };
  };

  it("never lets one feed run twice at once", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    const { seen, provider } = countingProvider();

    for (let round = 0; round < 10; round += 1) {
      await Promise.all(
        Array.from({ length: 4 }, () => syncFeed(feed, { store, provider })),
      );
    }
    expect(seen.most).toBeLessThanOrEqual(1);

    const { rows } = await db.query(
      `select count(*)::int as n from public.sync_logs where calendar_id = $1 and status = 'running'`,
      [feed.id],
    );
    expect(rows[0].n).toBe(0);

    // Stepping aside leaves nothing behind that blocks the next run.
    expect((await syncFeed(feed, { store, provider })).status).toBe("success");
  });

  it("makes a second run step aside while the first is going", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    let finish = () => {};
    const started = Promise.withResolvers<void>();
    const provider = createIcalProvider(async () => {
      started.resolve();
      await new Promise<void>((resolve) => (finish = resolve));
      return { ok: true, text: ics({ uid: "a", ...JUNE }) };
    });

    const first = syncFeed(feed, { store, provider });
    await started.promise;
    expect(await syncFeed(feed, { store, provider })).toEqual({
      status: "skipped",
    });
    finish();
    expect(await first).toMatchObject({ status: "success" });
  });

  it("recovers from a run that died part-way", async () => {
    const roomId = await newRoom();
    const feed = await newFeed(roomId);
    await db.query(
      `insert into public.sync_logs (calendar_id, status, started_at)
       values ($1, 'running', now() - interval '1 hour')`,
      [feed.id],
    );
    expect(await sync(feed, ics({ uid: "a", ...JUNE }))).toMatchObject({
      status: "success",
    });
  });

  it("gives every hold racing a sync one clear result", async () => {
    for (let round = 0; round < 15; round += 1) {
      const roomId = await newRoom();
      const feed = await newFeed(roomId);

      const [hold] = await Promise.allSettled([
        createHold({ roomId, checkIn: JUNE.start, checkOut: JUNE.end }),
        sync(feed, ics({ uid: "a", ...JUNE })),
      ]);

      const conflicted = await isConflicted(feed, "a");
      // The hold won and the import is flagged, or the import won and the hold
      // was refused. Never both standing unflagged.
      expect(conflicted).toBe(hold.status === "fulfilled");

      const { rows } = await db.query(
        `select count(*)::int as n from public.inventory_claims a
         join public.inventory_claims b
           on a.room_id = b.room_id and a.id < b.id and a.stay && b.stay
         where a.room_id = $1 and not a.is_conflicted and not b.is_conflicted`,
        [roomId],
      );
      expect(rows[0].n).toBe(0);
    }
  });
});

describe("the export feed", () => {
  async function exportLink(roomId: string) {
    const token = createExportToken();
    await db.query(
      `insert into public.ical_export_tokens (room_id, token_hash) values ($1, $2)
       on conflict (room_id) do update set token_hash = excluded.token_hash`,
      [roomId, hashExportToken(token)],
    );
    return (channel: Channel) =>
      loadExportFeed(client, exportFileName(channel, token), new Date());
  }

  const datesIn = (text: string | null) => {
    const parsed = parseIcal(text ?? "", "2026-11-07");
    if (!parsed.ok) throw new Error(parsed.code);
    return parsed.events.map(({ start, end }) => `${start}/${end}`);
  };

  it("returns nothing for a wrong or replaced token", async () => {
    const roomId = await newRoom();
    await exportLink(roomId);
    const wrong = exportFileName("airbnb", createExportToken());
    expect(await loadExportFeed(client, wrong, new Date())).toBeNull();

    const read = await exportLink(roomId);
    expect(await read("airbnb")).not.toBeNull();
    await exportLink(roomId);
    expect(await read("airbnb")).toBeNull();
  });

  it("contains no personal data", async () => {
    const roomId = await newRoom();
    const read = await exportLink(roomId);
    const name = `Zebedee ${randomUUID()}`;
    const email = `${randomUUID()}@private.example`;
    const bookingId = await createHold({
      roomId,
      checkIn: JUNE.start,
      checkOut: JUNE.end,
      name,
      email,
    });
    await confirm(bookingId);
    await db.query(
      `update public.bookings
       set guest_phone = '+30 699 111 2222', special_requests = 'Secret note'
       where id = $1`,
      [bookingId],
    );

    const feed = await newFeed(roomId);
    const { rows } = await db.query(
      `select public.upsert_external_event($1, 'stay', $2, $3, 'Maria P. +30 2222') as r`,
      [feed.id, JULY.start, JULY.end],
    );
    await db.query(
      `select public.update_external_event_details($1, 'Maria Private', 'maria@private.example', '+30 2222', 'A note', 5000)`,
      [rows[0].r.event_id],
    );

    const text = (await read("booking_com")) ?? "";
    expect(datesIn(text)).toHaveLength(2);
    for (const secret of [
      name,
      email,
      "private.example",
      "2222",
      "Secret note",
      "Maria",
      "A note",
      bookingId,
      roomId,
      rows[0].r.event_id,
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text.match(/^SUMMARY:.*$/gm)?.map((s) => s.trim())).toEqual([
      "SUMMARY:Reserved",
      "SUMMARY:Reserved",
    ]);
  });

  it("shows a change at the very next read (AVL-08)", async () => {
    const roomId = await newRoom();
    const read = await exportLink(roomId);
    expect(datesIn(await read("airbnb"))).toEqual([]);
    const bookingId = await directBooking(roomId);
    expect(datesIn(await read("airbnb"))).toEqual([
      `${JUNE.start}/${JUNE.end}`,
    ]);
    await db.query(`select public.cancel_booking($1, 'test')`, [bookingId]);
    expect(datesIn(await read("airbnb"))).toEqual([]);
  });

  it("shows manual blocks", async () => {
    const roomId = await newRoom();
    const read = await exportLink(roomId);
    await db.query(
      `select public.create_block($1, $2::date, $3::date, 'owner_use')`,
      [roomId, JUNE.start, JUNE.end],
    );
    expect(datesIn(await read("airbnb"))).toHaveLength(1);
  });

  it("keeps a channel's stay from itself, and shows it to the others", async () => {
    const roomId = await newRoom();
    const read = await exportLink(roomId);
    await sync(await newFeed(roomId), ics({ uid: "a", ...JUNE }));
    expect(datesIn(await read("airbnb"))).toEqual([]);
    expect(datesIn(await read("booking_com"))).toEqual([
      `${JUNE.start}/${JUNE.end}`,
    ]);
    expect(datesIn(await read("other_ical"))).toHaveLength(1);
  });

  it("reads back through our own import as the same dates", async () => {
    const roomId = await newRoom();
    const read = await exportLink(roomId);
    await directBooking(roomId, JUNE);
    await directBooking(roomId, JULY);

    const otherRoom = await newRoom();
    const feed = await newFeed(otherRoom, "other_ical");
    await sync(feed, (await read("other_ical")) ?? "");

    expect(await claimsOn(otherRoom)).toEqual([
      { kind: "external", ...JUNE, is_conflicted: false },
      { kind: "external", ...JULY, is_conflicted: false },
    ]);
  });
});

describe("loops", () => {
  /** Two channels that show everything we export as closed, as they may do. */
  async function world() {
    const roomId = await newRoom();
    const airbnb = await newFeed(roomId, "airbnb");
    const booking = await newFeed(roomId, "booking_com");
    const token = createExportToken();
    await db.query(
      `insert into public.ical_export_tokens (room_id, token_hash) values ($1, $2)`,
      [roomId, hashExportToken(token)],
    );
    const read = async (channel: Channel) => {
      const parsed = parseIcal(
        (await loadExportFeed(
          client,
          exportFileName(channel, token),
          new Date(),
        )) ?? "",
        "2026-11-07",
      );
      return parsed.ok ? parsed.events : [];
    };

    const own = { airbnb: [] as Stay[], booking: [] as Stay[] };

    const round = async () => {
      const closedOnAirbnb = (await read("airbnb")).map((event) => ({
        uid: `shown-${event.start}`,
        start: event.start,
        end: event.end,
        summary: "Airbnb (Not available)",
      }));
      await sync(airbnb, ics(...own.airbnb, ...closedOnAirbnb));

      const closedOnBooking = (await read("booking_com")).map((event) => ({
        uid: `shown-${event.start}`,
        start: event.start,
        end: event.end,
        summary: "CLOSED - Not available",
      }));
      await sync(booking, ics(...own.booking, ...closedOnBooking));
    };

    const rounds = async (count: number) => {
      for (let run = 0; run < count; run += 1) await round();
    };

    return { roomId, airbnb, booking, read, own, rounds };
  }

  it("does not bounce a stay back to the channel it came from", async () => {
    const { airbnb, read, own, rounds } = await world();
    own.airbnb.push({ uid: "guest", ...JUNE });
    await rounds(3);

    const uids = await storedUids(airbnb);
    expect(uids).toContain("guest");
    // Airbnb's closed copy of its own stay never becomes a second event.
    expect(uids).toEqual(["guest"]);
    expect((await read("booking_com")).length).toBe(1);
  });

  it("does not let closed dates pass from channel to channel", async () => {
    const { roomId, read } = await world();
    const feed = (
      await db.query(
        `select id from public.external_calendars where room_id = $1 and channel = 'airbnb'`,
        [roomId],
      )
    ).rows[0];
    await db.query(
      `select public.upsert_external_event($1, 'closed', $2, $3, 'Airbnb (Not available)')`,
      [feed.id, JULY.start, JULY.end],
    );
    expect(await read("booking_com")).toEqual([]);
  });

  it("frees the dates everywhere when an Airbnb guest cancels", async () => {
    const { roomId, airbnb, booking, read, own, rounds } = await world();
    own.airbnb.push({ uid: "guest", ...JUNE });
    await rounds(3);

    own.airbnb.length = 0;
    await rounds(6);

    expect(await storedUids(airbnb)).toEqual([]);
    expect(await storedUids(booking)).toEqual([]);
    expect(await claimsOn(roomId)).toEqual([]);
    expect(await read("airbnb")).toEqual([]);
    expect(await read("booking_com")).toEqual([]);
  });

  it("frees the dates everywhere when a Booking.com guest cancels", async () => {
    const { roomId, own, rounds } = await world();
    own.booking.push({
      uid: "guest",
      ...JUNE,
      summary: "CLOSED - Not available",
    });
    await rounds(3);

    own.booking.length = 0;
    await rounds(6);

    expect(await claimsOn(roomId)).toEqual([]);
  });

  it("frees the dates everywhere when a direct guest cancels", async () => {
    const { roomId, rounds } = await world();
    const bookingId = await directBooking(roomId);
    await rounds(3);

    await db.query(`select public.cancel_booking($1, 'test')`, [bookingId]);
    await rounds(6);

    expect(await claimsOn(roomId)).toEqual([]);
  });
});
