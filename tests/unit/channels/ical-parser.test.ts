import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyEvent } from "@/lib/channels/classify";
import { FEED_LIMITS, parseIcal } from "@/lib/channels/ical-parser";

const TODAY = "2026-11-07";

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/${name}`, import.meta.url), "utf8");

const calendar = (...events: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...events.flatMap((body) => ["BEGIN:VEVENT", body, "END:VEVENT"]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");

const event = (uid: string, start: string, end?: string, extra = "") =>
  [
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${start}`,
    end ? `DTEND;VALUE=DATE:${end}` : "",
    extra,
  ]
    .filter(Boolean)
    .join("\r\n");

function read(text: string) {
  const result = parseIcal(text, TODAY);
  if (!result.ok) throw new Error(`refused: ${result.code}`);
  return result;
}

const singleStay = (body: string) => {
  const [stay] = read(calendar(body)).events;
  return [stay.start, stay.end];
};

describe("real feed shapes", () => {
  it("reads an Airbnb feed, its folded lines and both labels", () => {
    const { events, unreadable } = read(fixture("airbnb.ics"));
    expect(unreadable).toBe(0);
    expect(events).toEqual([
      {
        uid: "1418fb94e984-0a1b2c3d4e5f60718293a4b5c6d7e8f9@airbnb.com",
        start: "2027-07-01",
        end: "2027-07-07",
        summary: "Reserved",
      },
      {
        uid: "7f5c2b1a9e30-9f8e7d6c5b4a39281706f5e4d3c2b1a0@airbnb.com",
        start: "2027-07-15",
        end: "2027-07-20",
        summary: "Airbnb (Not available)",
      },
    ]);
  });

  it("reads a Booking.com feed", () => {
    const { events } = read(fixture("booking.ics"));
    expect(events.map((e) => [e.start, e.end, e.summary])).toEqual([
      ["2027-08-01", "2027-08-08", "CLOSED - Not available"],
      ["2027-09-10", "2027-09-12", "CLOSED - Not available"],
    ]);
  });

  it("keeps nothing from the description, which holds phone digits", () => {
    expect(JSON.stringify(read(fixture("airbnb.ics")))).not.toContain("1234");
  });

  it("tells a sale from a closure only where the channel does", () => {
    expect(classifyEvent("airbnb", "Reserved")).toBe("reservation");
    expect(classifyEvent("airbnb", "Airbnb (Not available)")).toBe("block");
    expect(classifyEvent("airbnb", "Not available")).toBe("block");
    expect(classifyEvent("booking_com", "CLOSED - Not available")).toBe(
      "ambiguous",
    );
    expect(classifyEvent("other_ical", "Blocked")).toBe("block");
    expect(classifyEvent("other_ical", "J. Smith")).toBe("ambiguous");
    expect(classifyEvent("airbnb", null)).toBe("ambiguous");
  });
});

describe("dates", () => {
  it("leaves the check-out day free for all-day events", () => {
    expect(singleStay(event("a", "20270601", "20270605"))).toEqual([
      "2027-06-01",
      "2027-06-05",
    ]);
  });

  it("reads a date-time in UTC as the date on Milos", () => {
    // 22:30 UTC on 31 May is already 1 June in Greece.
    const body = "UID:a\r\nDTSTART:20270531T223000Z\r\nDTEND:20270605T080000Z";
    expect(singleStay(body)).toEqual(["2027-06-01", "2027-06-05"]);
  });

  it("keeps a floating date-time on the date it states", () => {
    const body = "UID:a\r\nDTSTART:20270601T150000\r\nDTEND:20270605T110000";
    expect(singleStay(body)).toEqual(["2027-06-01", "2027-06-05"]);
  });

  it("reads a named zone", () => {
    const body =
      "UID:a\r\nDTSTART;TZID=America/New_York:20270601T200000\r\nDTEND;TZID=America/New_York:20270605T060000";
    expect(singleStay(body)).toEqual(["2027-06-02", "2027-06-05"]);
  });

  it("does not trust a zone name only the feed knows", () => {
    const body =
      "UID:a\r\nDTSTART;TZID=Custom Zone:20270601T150000\r\nDTEND;TZID=Custom Zone:20270605T110000";
    expect(singleStay(body)).toEqual(["2027-06-01", "2027-06-05"]);
  });

  it("stays on the right day either side of the clock change", () => {
    // Greece moves to summer time at 01:00 UTC on 28 March 2027.
    const spring =
      "UID:a\r\nDTSTART:20270327T220000Z\r\nDTEND:20270328T210000Z";
    expect(singleStay(spring)).toEqual(["2027-03-28", "2027-03-29"]);
    // And back at 01:00 UTC on 31 October 2027.
    const autumn =
      "UID:a\r\nDTSTART;TZID=Europe/Athens:20271031T003000\r\nDTEND;TZID=Europe/Athens:20271101T000000";
    expect(singleStay(autumn)).toEqual(["2027-10-31", "2027-11-01"]);
  });

  it("gives one day to an event with no end", () => {
    expect(singleStay(event("a", "20270601"))).toEqual([
      "2027-06-01",
      "2027-06-02",
    ]);
  });

  it("uses DURATION when there is no end", () => {
    expect(
      singleStay(event("a", "20270601", undefined, "DURATION:P1W")),
    ).toEqual(["2027-06-01", "2027-06-08"]);
  });

  it("gives one day to an end at or before the start", () => {
    expect(singleStay(event("a", "20270601", "20270601"))).toEqual([
      "2027-06-01",
      "2027-06-02",
    ]);
    expect(singleStay(event("a", "20270601", "20270520"))).toEqual([
      "2027-06-01",
      "2027-06-02",
    ]);
  });

  it("counts a date that does not exist as unreadable", () => {
    const { events, unreadable } = read(
      calendar(event("a", "20270230", "20270301")),
    );
    expect(events).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("ignores stays far in the past and far ahead", () => {
    const { events, ignored, unreadable } = read(
      calendar(
        event("old", "20200101", "20200105"),
        event("far", "20400101", "20400105"),
      ),
    );
    expect(events).toEqual([]);
    expect(ignored).toBe(2);
    expect(unreadable).toBe(0);
  });

  it("keeps a recent stay, and cuts an endless one at the limit", () => {
    const { events } = read(
      calendar(
        event("recent", "20261001", "20261020"),
        event("long", "20270101", "99991231"),
      ),
    );
    expect(events.map((e) => e.uid)).toEqual(["recent", "long"]);
    expect(events[1].end).toBe("2030-11-07");
  });
});

describe("format details", () => {
  it("accepts bare newlines, a byte order mark and tab folding", () => {
    const text = `﻿BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:long\n\tuid\nDTSTART;VALUE=DATE:20270601\nDTEND;VALUE=DATE:20270605\nEND:VEVENT\nEND:VCALENDAR`;
    expect(read(text).events[0].uid).toBe("longuid");
  });

  it("undoes escaped characters", () => {
    const body = event(
      "a",
      "20270601",
      "20270605",
      "SUMMARY:Closed\\, for works\\; back soon\\\\ok",
    );
    expect(read(calendar(body)).events[0].summary).toBe(
      "Closed, for works; back soon\\ok",
    );
  });

  it("finds the value after a colon inside a quoted parameter", () => {
    const body = `UID:a\r\nDTSTART;X-NOTE="a:b";VALUE=DATE:20270601\r\nDTEND;VALUE=DATE:20270605`;
    expect(singleStay(body)).toEqual(["2027-06-01", "2027-06-05"]);
  });

  it("merges several calendars in one file", () => {
    const text =
      calendar(event("a", "20270601", "20270605")) +
      calendar(event("b", "20270701", "20270705"));
    expect(read(text).events.map((e) => e.uid)).toEqual(["a", "b"]);
  });

  it("ignores properties inside nested parts such as alarms", () => {
    const body = `${event("a", "20270601", "20270605")}\r\nBEGIN:VALARM\r\nUID:wrong\r\nSUMMARY:wrong\r\nEND:VALARM`;
    const [stay] = read(calendar(body)).events;
    expect(stay.uid).toBe("a");
    expect(stay.summary).toBeNull();
  });

  it("gives an event with no UID a name that stays the same", () => {
    const body =
      "DTSTART;VALUE=DATE:20270601\r\nDTEND;VALUE=DATE:20270605\r\nSUMMARY:x";
    expect(read(calendar(body)).events[0].uid).toBe(
      "no-uid-2027-06-01-2027-06-05",
    );
  });

  it("removes control characters Postgres cannot store", () => {
    const body = event("a\u0000b", "20270601", "20270605", "SUMMARY:x\u0000y");
    const [stay] = read(calendar(body)).events;
    expect(stay.uid).toBe("a b");
    expect(stay.summary).toBe("x y");
  });

  it("limits how long a stored label can be", () => {
    const summary = "x".repeat(5_000);
    const body = event("a", "20270601", "20270605", `SUMMARY:${summary}`);
    expect(read(calendar(body)).events[0].summary).toHaveLength(
      FEED_LIMITS.maxSummaryLength,
    );
  });
});

describe("cancelled and repeated events", () => {
  it("drops a cancelled event", () => {
    const { events, cancelled } = read(
      calendar(event("a", "20270601", "20270605", "STATUS:CANCELLED")),
    );
    expect(events).toEqual([]);
    expect(cancelled).toBe(1);
  });

  it("merges overlapping copies of one UID", () => {
    const { events } = read(
      calendar(
        event("a", "20270601", "20270605"),
        event("a", "20270604", "20270608"),
      ),
    );
    expect(events.map((e) => [e.uid, e.start, e.end])).toEqual([
      ["a", "2027-06-01", "2027-06-08"],
    ]);
  });

  it("keeps the dates of a separate copy under a UID of its own", () => {
    const { events } = read(
      calendar(
        event("a", "20270701", "20270705"),
        event("a", "20270601", "20270605"),
      ),
    );
    expect(events.map((e) => [e.uid, e.start])).toEqual([
      ["a", "2027-06-01"],
      ["a#2027-07-01", "2027-07-01"],
    ]);
  });

  it("takes the highest SEQUENCE as the current version", () => {
    const { events } = read(
      calendar(
        event("a", "20270601", "20270605", "SEQUENCE:1"),
        event("a", "20270610", "20270615", "SEQUENCE:2"),
      ),
    );
    expect(events.map((e) => e.start)).toEqual(["2027-06-10"]);
  });

  it("lets a later cancellation win, and not an earlier one", () => {
    const later = read(
      calendar(
        event("a", "20270601", "20270605", "SEQUENCE:1"),
        event("a", "20270601", "20270605", "SEQUENCE:2\r\nSTATUS:CANCELLED"),
      ),
    );
    expect(later.events).toEqual([]);

    const earlier = read(
      calendar(
        event("a", "20270601", "20270605", "SEQUENCE:1\r\nSTATUS:CANCELLED"),
        event("a", "20270601", "20270605", "SEQUENCE:2"),
      ),
    );
    expect(earlier.events).toHaveLength(1);
  });

  it("blocks the first date of a repeating event and flags the rest", () => {
    const { events, unreadable } = read(
      calendar(event("a", "20270601", "20270605", "RRULE:FREQ=WEEKLY")),
    );
    expect(events).toHaveLength(1);
    expect(unreadable).toBe(1);
  });
});

describe("refusing untrusted input", () => {
  const refused = (text: string) => {
    const result = parseIcal(text, TODAY);
    return result.ok ? null : result.code;
  };

  it("refuses an HTML page", () => {
    expect(refused("<!doctype html><html><body>Sign in</body></html>")).toBe(
      "malformed",
    );
  });

  it("refuses an empty body", () => {
    expect(refused("")).toBe("malformed");
  });

  it("refuses a file cut off part-way", () => {
    const whole = fixture("airbnb.ics");
    expect(refused(whole.slice(0, whole.lastIndexOf("END:VEVENT")))).toBe(
      "malformed",
    );
    expect(refused(whole.replace("END:VCALENDAR", ""))).toBe("malformed");
  });

  it("refuses crossed begin and end lines", () => {
    expect(refused("BEGIN:VCALENDAR\r\nEND:VEVENT\r\nEND:VCALENDAR")).toBe(
      "malformed",
    );
  });

  it("refuses text after the calendar has ended", () => {
    expect(refused(`${fixture("booking.ics")}garbage line`)).toBe("malformed");
  });

  it("refuses endless nesting", () => {
    const deep = `BEGIN:VCALENDAR\r\n${"BEGIN:X\r\n".repeat(50)}`;
    expect(refused(deep)).toBe("malformed");
  });

  it("refuses a huge feed rather than reading part of it", () => {
    const events = Array.from({ length: FEED_LIMITS.maxEvents + 1 }, (_, i) =>
      event(`e${i}`, "20270601", "20270605"),
    );
    expect(refused(calendar(...events))).toBe("too_many_events");
  });

  it("refuses a line folded to an enormous length", () => {
    const fold = " x\r\n".repeat(FEED_LIMITS.maxLineLength + 1);
    expect(refused(`BEGIN:VCALENDAR\r\nUID:a\r\n${fold}END:VCALENDAR`)).toBe(
      "malformed",
    );
  });

  it("counts an oversized UID as unreadable", () => {
    const uid = "u".repeat(FEED_LIMITS.maxUidLength + 1);
    const { events, unreadable } = read(
      calendar(event(uid, "20270601", "20270605")),
    );
    expect(events).toEqual([]);
    expect(unreadable).toBe(1);
  });

  it("is not slowed down by a long run of quotes", () => {
    const line = `X-A;P="${'"'.repeat(16_000)}`;
    const started = Date.now();
    parseIcal(`BEGIN:VCALENDAR\r\n${line}\r\nEND:VCALENDAR`, TODAY);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
