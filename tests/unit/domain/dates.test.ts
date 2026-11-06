import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  athensDate,
  athensHour,
  dayOfWeek,
  daysBetween,
  eachNight,
  isValidIsoDate,
} from "@/lib/domain";

describe("isValidIsoDate", () => {
  it.each(["2028-02-29", "2027-12-31", "2027-01-01"])("accepts %s", (date) => {
    expect(isValidIsoDate(date)).toBe(true);
  });

  it.each([
    "2027-02-29",
    "2027-13-01",
    "2027-04-31",
    "2027-1-1",
    "27-01-01",
    "2027-01-01T00:00:00Z",
    "",
    null,
    20270101,
  ])("rejects %s", (date) => {
    expect(isValidIsoDate(date)).toBe(false);
  });
});

describe("calendar arithmetic", () => {
  it("crosses a leap day", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(daysBetween("2028-02-01", "2028-03-01")).toBe(29);
  });

  it("crosses a year boundary", () => {
    expect(addDays("2027-12-31", 1)).toBe("2028-01-01");
    expect(addDays("2028-01-01", -1)).toBe("2027-12-31");
    expect(daysBetween("2027-12-31", "2028-01-01")).toBe(1);
  });

  it("counts whole days across both DST changes", () => {
    expect(daysBetween("2027-03-27", "2027-03-29")).toBe(2);
    expect(daysBetween("2027-10-30", "2027-11-01")).toBe(2);
    expect(addDays("2027-03-28", 1)).toBe("2027-03-29");
    expect(addDays("2027-10-31", 1)).toBe("2027-11-01");
  });

  it("is negative when going backwards", () => {
    expect(daysBetween("2027-06-02", "2027-06-01")).toBe(-1);
  });

  it("clamps addMonths to the end of a shorter month", () => {
    expect(addMonths("2026-08-31", 18)).toBe("2028-02-29");
    expect(addMonths("2025-08-31", 18)).toBe("2027-02-28");
    expect(addMonths("2026-11-06", 18)).toBe("2028-05-06");
    expect(addMonths("2027-12-15", 1)).toBe("2028-01-15");
  });

  it("numbers days from Sunday as 0", () => {
    expect(dayOfWeek("2027-03-28")).toBe(0);
    expect(dayOfWeek("2027-06-01")).toBe(2);
    expect(dayOfWeek("2027-06-18")).toBe(5);
    expect(dayOfWeek("2028-02-29")).toBe(2);
  });

  it("excludes the check-out date from a stay's nights", () => {
    expect(eachNight("2027-12-30", "2028-01-02")).toEqual([
      "2027-12-30",
      "2027-12-31",
      "2028-01-01",
    ]);
    expect(eachNight("2027-06-02", "2027-06-02")).toEqual([]);
    expect(eachNight("2027-06-03", "2027-06-02")).toEqual([]);
  });
});

describe("Europe/Athens", () => {
  const at = (iso: string) => {
    const now = new Date(iso);
    return { date: athensDate(now), hour: athensHour(now) };
  };

  it("is UTC+2 in winter and UTC+3 in summer", () => {
    expect(at("2027-01-15T10:00:00Z")).toEqual({
      date: "2027-01-15",
      hour: 12,
    });
    expect(at("2027-07-15T10:00:00Z")).toEqual({
      date: "2027-07-15",
      hour: 13,
    });
  });

  it("starts the new day at 21:00 UTC in summer", () => {
    expect(at("2027-06-30T20:59:59Z").date).toBe("2027-06-30");
    expect(at("2027-06-30T21:00:00Z")).toEqual({ date: "2027-07-01", hour: 0 });
  });

  it("starts the new year at 22:00 UTC", () => {
    expect(at("2027-12-31T21:59:59Z").date).toBe("2027-12-31");
    expect(at("2027-12-31T22:00:00Z")).toEqual({ date: "2028-01-01", hour: 0 });
  });

  it("reaches a leap day two hours before UTC does", () => {
    expect(at("2028-02-28T22:00:00Z").date).toBe("2028-02-29");
    expect(at("2028-02-29T21:59:59Z").date).toBe("2028-02-29");
    expect(at("2028-02-29T22:00:00Z").date).toBe("2028-03-01");
  });

  it("skips 03:00 on the last Sunday of March", () => {
    expect(at("2027-03-28T00:59:59Z")).toEqual({ date: "2027-03-28", hour: 2 });
    expect(at("2027-03-28T01:00:00Z")).toEqual({ date: "2027-03-28", hour: 4 });
  });

  it("repeats 03:00 on the last Sunday of October", () => {
    expect(at("2027-10-31T00:30:00Z")).toEqual({ date: "2027-10-31", hour: 3 });
    expect(at("2027-10-31T01:30:00Z")).toEqual({ date: "2027-10-31", hour: 3 });
    expect(at("2027-10-31T02:00:00Z")).toEqual({ date: "2027-10-31", hour: 4 });
  });

  it("shows midnight as hour 0, not 24", () => {
    expect(at("2027-06-30T21:30:00Z").hour).toBe(0);
  });
});
