import { describe, expect, it } from "vitest";
import {
  createExportToken,
  exportFileName,
  hashExportToken,
  parseExportFileName,
  renderCalendar,
  selectExportEvents,
  type ExportClaim,
} from "@/lib/channels/export";
import { parseIcal } from "@/lib/channels/ical-parser";

const NOW = new Date("2027-05-01T10:00:00Z");
const TODAY = "2027-05-01";

const claim = (fields: Partial<ExportClaim>): ExportClaim => ({
  kind: "booking",
  sourceId: "source",
  start: "2027-06-01",
  end: "2027-06-05",
  channel: null,
  summary: null,
  holdExpiresAt: null,
  ...fields,
});

const count = (
  claims: ExportClaim[],
  target: "airbnb" | "booking_com" = "airbnb",
  holds = true,
) => selectExportEvents(claims, target, holds, NOW).length;

describe("what each channel is told", () => {
  it("includes direct and manual bookings and blocks", () => {
    expect(count([claim({ kind: "booking" }), claim({ kind: "block" })])).toBe(
      2,
    );
  });

  it("includes live holds only when switched on", () => {
    const hold = claim({
      kind: "hold",
      holdExpiresAt: "2027-05-01T10:30:00Z",
    });
    expect(count([hold], "airbnb", true)).toBe(1);
    expect(count([hold], "airbnb", false)).toBe(0);
  });

  it("leaves out a hold that has run out", () => {
    const hold = claim({
      kind: "hold",
      holdExpiresAt: "2027-05-01T09:59:00Z",
    });
    expect(count([hold])).toBe(0);
  });

  it("never sends a channel its own stays back (CHN-11)", () => {
    const stay = claim({
      kind: "external",
      channel: "airbnb",
      summary: "Reserved",
    });
    expect(count([stay], "airbnb")).toBe(0);
    expect(count([stay], "booking_com")).toBe(1);
  });

  it("passes every Booking.com event to Airbnb, as it may be a sale", () => {
    const stay = claim({
      kind: "external",
      channel: "booking_com",
      summary: "CLOSED - Not available",
    });
    expect(count([stay], "airbnb")).toBe(1);
    expect(count([stay], "booking_com")).toBe(0);
  });

  it("does not pass on closed dates, which is how loops start", () => {
    const closed = claim({
      kind: "external",
      channel: "airbnb",
      summary: "Airbnb (Not available)",
    });
    expect(count([closed], "booking_com")).toBe(0);
  });

  it("passes on an unknown label, because it could be a sale", () => {
    const stay = claim({
      kind: "external",
      channel: "other_ical",
      summary: "Some guest",
    });
    expect(count([stay], "airbnb")).toBe(1);
  });

  it("leaves out an imported event with no known channel", () => {
    expect(count([claim({ kind: "external", channel: null })])).toBe(0);
  });
});

describe("the calendar file", () => {
  const claims = [
    claim({ sourceId: "b", start: "2027-08-01", end: "2027-08-03" }),
    claim({ sourceId: "a", start: "2027-06-01", end: "2027-06-05" }),
  ];
  const events = selectExportEvents(claims, "airbnb", true, NOW);
  const file = renderCalendar(events, NOW);

  it("is valid iCalendar with CRLF endings and short lines", () => {
    expect(file.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:")).toBe(
      true,
    );
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(file.replaceAll("\r\n", "")).not.toContain("\n");
    for (const line of file.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    for (const required of ["UID:", "DTSTAMP:", "DTSTART;VALUE=DATE:"]) {
      expect(file.split(required)).toHaveLength(3);
    }
  });

  it("uses the same UIDs every time", () => {
    const again = selectExportEvents(claims, "booking_com", true, NOW);
    expect(again.map((e) => e.uid)).toEqual(events.map((e) => e.uid));
  });

  it("keeps a UID when a hold becomes a booking", () => {
    const hold = claim({
      kind: "hold",
      sourceId: "b1",
      holdExpiresAt: "2027-05-02T00:00:00Z",
    });
    const booked = claim({ kind: "booking", sourceId: "b1" });
    expect(selectExportEvents([hold], "airbnb", true, NOW)[0].uid).toBe(
      selectExportEvents([booked], "airbnb", true, NOW)[0].uid,
    );
  });

  it("shows nothing but dates and one word", () => {
    const summaries = file
      .split("\r\n")
      .filter((line) => line.startsWith("SUMMARY:"));
    expect(new Set(summaries)).toEqual(new Set(["SUMMARY:Reserved"]));
    expect(file).not.toMatch(/DESCRIPTION|ATTENDEE|ORGANIZER|LOCATION|EMAIL/);
  });

  it("reads back through our own parser with dates unchanged", () => {
    const parsed = parseIcal(file, TODAY);
    expect(parsed.ok && parsed.unreadable).toBe(0);
    expect(
      parsed.ok && parsed.events.map(({ start, end }) => [start, end]),
    ).toEqual([
      ["2027-06-01", "2027-06-05"],
      ["2027-08-01", "2027-08-03"],
    ]);
  });

  it("is still valid with nothing in it", () => {
    const parsed = parseIcal(renderCalendar([], NOW), TODAY);
    expect(parsed).toMatchObject({ ok: true, events: [] });
  });
});

describe("tokens", () => {
  it("are long, random and stored only as a hash", () => {
    const token = createExportToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createExportToken()).not.toBe(token);
    expect(hashExportToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashExportToken(token)).not.toContain(token);
  });

  it("round-trip through the file name, even with dashes in them", () => {
    const token = `-_${"a".repeat(41)}`;
    expect(parseExportFileName(exportFileName("booking_com", token))).toEqual({
      channel: "booking_com",
      token,
    });
  });

  it.each([
    "",
    "x.ics",
    "airbnb.ics",
    `airbnb-${"a".repeat(42)}.ics`,
    `airbnb-${"a".repeat(44)}.ics`,
    `airbnb-${"a".repeat(43)}.txt`,
    `vrbo-${"a".repeat(43)}.ics`,
    `${"a".repeat(43)}.ics`,
    `airbnb-${"a".repeat(42)}/.ics`,
  ])("refuse %s", (name) => {
    expect(parseExportFileName(name)).toBeNull();
  });
});
