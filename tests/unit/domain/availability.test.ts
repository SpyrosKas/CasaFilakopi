import { describe, expect, it } from "vitest";
import {
  checkNightsFree,
  checkStayRules,
  effectiveRestrictions,
  MAX_STAY_NIGHTS,
  type RestrictionRow,
  type StayRulesInput,
} from "@/lib/domain";
import type { StayRequest } from "@/lib/domain/contracts";
import { BOOKING, NOW, restriction, ROOM, stay } from "./fixtures";

const check = (
  stayOverrides: Partial<StayRequest> = {},
  input: Partial<StayRulesInput> = {},
) =>
  checkStayRules({
    stay: stay(stayOverrides),
    room: ROOM,
    restrictions: [],
    booking: BOOKING,
    now: NOW,
    ...input,
  });

const rejected = (reason: string) => ({ ok: false, reason });
const OK = { ok: true };

const withRules = (
  rules: RestrictionRow[],
  stayOverrides: Partial<StayRequest> = {},
) => check(stayOverrides, { restrictions: rules });

describe("dates", () => {
  it("accepts a plain stay", () => {
    expect(check()).toEqual(OK);
  });

  it.each([
    ["an impossible date", { checkIn: "2027-02-30" }],
    ["a malformed date", { checkIn: "14/06/2027" }],
    ["check-out on check-in", { checkOut: "2027-06-14" }],
    ["check-out before check-in", { checkOut: "2027-06-13" }],
    ["check-in yesterday", { checkIn: "2027-05-31" }],
  ])("refuses %s", (_, overrides) => {
    expect(check(overrides)).toEqual(rejected("invalid_dates"));
  });

  it("uses the Athens date for yesterday, not the UTC date", () => {
    // 00:30 on 2 June in Athens, still 1 June in UTC.
    const now = new Date("2027-06-01T21:30:00Z");
    expect(
      check({ checkIn: "2027-06-01", checkOut: "2027-06-03" }, { now }),
    ).toEqual(rejected("invalid_dates"));
  });
});

describe("room", () => {
  it("refuses an inactive room", () => {
    expect(check({}, { room: { ...ROOM, is_active: false } })).toEqual(
      rejected("room_inactive"),
    );
  });

  it("treats a missing room as inactive", () => {
    expect(check({}, { room: null })).toEqual(rejected("room_inactive"));
  });
});

describe("capacity", () => {
  it("accepts a full house", () => {
    expect(check({ adults: 4, children: 2 })).toEqual(OK);
  });

  it.each([
    ["too many adults", { adults: 5 }],
    ["too many children", { children: 3 }],
    ["no adult", { adults: 0, children: 2 }],
    ["a negative count", { children: -1 }],
    ["a fractional count", { adults: 1.5 }],
  ])("refuses %s", (_, overrides) => {
    expect(check(overrides)).toEqual(rejected("over_capacity"));
  });
});

describe("lead time", () => {
  const today = { checkIn: "2027-06-01", checkOut: "2027-06-03" };

  it("allows same-day arrival before the cutoff", () => {
    expect(check(today)).toEqual(OK);
  });

  it("closes same-day arrival at the cutoff hour sharp", () => {
    expect(check(today, { now: new Date("2027-06-01T08:59:59Z") })).toEqual(OK);
    expect(check(today, { now: new Date("2027-06-01T09:00:00Z") })).toEqual(
      rejected("lead_time_not_met"),
    );
  });

  it("does not apply the cutoff to tomorrow", () => {
    expect(
      check(
        { checkIn: "2027-06-02", checkOut: "2027-06-04" },
        { now: new Date("2027-06-01T20:00:00Z") },
      ),
    ).toEqual(OK);
  });

  it("uses the winter offset", () => {
    const winter = { checkIn: "2027-01-15", checkOut: "2027-01-17" };
    expect(check(winter, { now: new Date("2027-01-15T09:59:59Z") })).toEqual(
      OK,
    );
    expect(check(winter, { now: new Date("2027-01-15T10:00:00Z") })).toEqual(
      rejected("lead_time_not_met"),
    );
  });

  it("uses the new offset on the day clocks go forward", () => {
    const stayDates = { checkIn: "2027-03-28", checkOut: "2027-03-30" };
    expect(check(stayDates, { now: new Date("2027-03-28T08:59:59Z") })).toEqual(
      OK,
    );
    expect(check(stayDates, { now: new Date("2027-03-28T09:00:00Z") })).toEqual(
      rejected("lead_time_not_met"),
    );
  });

  it("uses the new offset on the day clocks go back", () => {
    const stayDates = { checkIn: "2027-10-31", checkOut: "2027-11-02" };
    expect(check(stayDates, { now: new Date("2027-10-31T09:59:59Z") })).toEqual(
      OK,
    );
    expect(check(stayDates, { now: new Date("2027-10-31T10:00:00Z") })).toEqual(
      rejected("lead_time_not_met"),
    );
  });

  it("a cutoff of 0 closes same-day booking, 24 never does", () => {
    expect(
      check(today, { booking: { ...BOOKING, sameDayCutoffHour: 0 } }),
    ).toEqual(rejected("lead_time_not_met"));
    expect(
      check(today, {
        booking: { ...BOOKING, sameDayCutoffHour: 24 },
        now: new Date("2027-06-01T20:59:59Z"),
      }),
    ).toEqual(OK);
  });

  it("enforces minLeadDays on its boundary", () => {
    const booking = { ...BOOKING, minLeadDays: 2 };
    expect(
      check({ checkIn: "2027-06-02", checkOut: "2027-06-05" }, { booking }),
    ).toEqual(rejected("lead_time_not_met"));
    expect(
      check({ checkIn: "2027-06-03", checkOut: "2027-06-05" }, { booking }),
    ).toEqual(OK);
  });
});

describe("booking horizon", () => {
  // 18 months from 1 June 2027 is 1 December 2028.
  it("allows a last night exactly on the horizon", () => {
    expect(check({ checkIn: "2028-11-29", checkOut: "2028-12-02" })).toEqual(
      OK,
    );
  });

  it("refuses a last night one day past it", () => {
    expect(check({ checkIn: "2028-11-29", checkOut: "2028-12-03" })).toEqual(
      rejected("beyond_booking_horizon"),
    );
  });

  it("clamps at a month end across a leap year", () => {
    const now = new Date("2026-08-31T09:00:00Z");
    expect(
      check({ checkIn: "2028-02-28", checkOut: "2028-03-01" }, { now }),
    ).toEqual(OK);
    expect(
      check({ checkIn: "2028-02-28", checkOut: "2028-03-02" }, { now }),
    ).toEqual(rejected("beyond_booking_horizon"));
  });

  it("refuses a stay longer than the calendar RPC can read", () => {
    const booking = { ...BOOKING, horizonMonths: 60 };
    expect(MAX_STAY_NIGHTS).toBe(731);
    expect(
      check({ checkIn: "2027-06-14", checkOut: "2029-06-14" }, { booking }),
    ).toEqual(OK);
    expect(
      check({ checkIn: "2027-06-14", checkOut: "2029-06-15" }, { booking }),
    ).toEqual(rejected("above_max_stay"));
  });
});

describe("min and max stay", () => {
  const rule = restriction({ min_stay: 3, max_stay: 5 });

  it.each([
    ["2027-06-16", "below_min_stay"],
    ["2027-06-17", null],
    ["2027-06-19", null],
    ["2027-06-20", "above_max_stay"],
  ])("checking out %s gives %s", (checkOut, reason) => {
    expect(withRules([rule], { checkOut })).toEqual(
      reason ? rejected(reason) : OK,
    );
  });

  it("applies by check-in: a period the stay only runs into does not bind", () => {
    const july = restriction({
      start_date: "2027-07-01",
      end_date: "2027-07-31",
      min_stay: 7,
    });
    expect(
      withRules([july], { checkIn: "2027-06-29", checkOut: "2027-07-03" }),
    ).toEqual(OK);
  });

  it("applies on the first day of a period", () => {
    const july = restriction({
      start_date: "2027-07-01",
      end_date: "2027-07-31",
      min_stay: 7,
    });
    expect(
      withRules([july], { checkIn: "2027-07-01", checkOut: "2027-07-05" }),
    ).toEqual(rejected("below_min_stay"));
  });

  it("applies on the last day of a period, which is inclusive", () => {
    const june = restriction({ end_date: "2027-06-30", min_stay: 7 });
    expect(
      withRules([june], { checkIn: "2027-06-30", checkOut: "2027-07-03" }),
    ).toEqual(rejected("below_min_stay"));
    expect(
      withRules([june], { checkIn: "2027-07-01", checkOut: "2027-07-03" }),
    ).toEqual(OK);
  });

  it("across two periods, only the check-in period decides", () => {
    const rules = [
      restriction({ end_date: "2027-06-30", min_stay: 2, max_stay: 4 }),
      restriction({
        start_date: "2027-07-01",
        end_date: "2027-07-31",
        min_stay: 7,
        max_stay: 14,
      }),
    ];
    expect(
      withRules(rules, { checkIn: "2027-06-29", checkOut: "2027-07-03" }),
    ).toEqual(OK);
    expect(
      withRules(rules, { checkIn: "2027-06-29", checkOut: "2027-07-04" }),
    ).toEqual(rejected("above_max_stay"));
  });

  it("uses the strictest of overlapping restrictions", () => {
    const rules = [
      restriction({ min_stay: 2, max_stay: 10 }),
      restriction({ min_stay: 4, max_stay: 6 }),
    ];
    expect(effectiveRestrictions(rules, "2027-06-14", "2027-06-17")).toEqual({
      minStay: 4,
      maxStay: 6,
      closedToArrival: false,
      closedToDeparture: false,
      allowedCheckInDays: null,
    });
  });
});

describe("closed to arrival and departure", () => {
  it("reads closed to arrival on the check-in date only", () => {
    const rule = restriction({
      start_date: "2027-06-14",
      end_date: "2027-06-14",
      closed_to_arrival: true,
    });
    expect(withRules([rule])).toEqual(rejected("closed_to_arrival"));
    expect(withRules([rule], { checkIn: "2027-06-13" })).toEqual(OK);
    expect(withRules([rule], { checkIn: "2027-06-15" })).toEqual(OK);
  });

  it("reads closed to departure on the check-out date only", () => {
    const rule = restriction({
      start_date: "2027-06-17",
      end_date: "2027-06-17",
      closed_to_departure: true,
    });
    expect(withRules([rule])).toEqual(rejected("closed_to_departure"));
    expect(withRules([rule], { checkOut: "2027-06-16" })).toEqual(OK);
    expect(withRules([rule], { checkOut: "2027-06-18" })).toEqual(OK);
  });

  it("closed to departure does not stop a check-in on that date", () => {
    const rule = restriction({ closed_to_departure: true });
    expect(
      withRules([rule], { checkIn: "2027-06-30", checkOut: "2027-07-02" }),
    ).toEqual(OK);
  });

  it("closed to arrival does not stop a check-out on that date", () => {
    const rule = restriction({
      start_date: "2027-06-17",
      end_date: "2027-06-17",
      closed_to_arrival: true,
    });
    expect(withRules([rule])).toEqual(OK);
  });
});

describe("allowed check-in days", () => {
  // 14 June 2027 is a Monday.
  it("accepts an allowed day and refuses others", () => {
    const rule = restriction({ allowed_check_in_days: [1, 6] });
    expect(withRules([rule])).toEqual(OK);
    expect(withRules([rule], { checkIn: "2027-06-15" })).toEqual(
      rejected("check_in_day_not_allowed"),
    );
  });

  it("numbers Sunday as 0", () => {
    const rule = restriction({ allowed_check_in_days: [0] });
    expect(withRules([rule], { checkIn: "2027-06-13" })).toEqual(OK);
  });

  it("intersects overlapping restrictions", () => {
    const rules = [
      restriction({ allowed_check_in_days: [1, 2] }),
      restriction({ allowed_check_in_days: [2, 3] }),
      restriction({ allowed_check_in_days: null }),
    ];
    expect(
      effectiveRestrictions(rules, "2027-06-14", "2027-06-17")
        .allowedCheckInDays,
    ).toEqual([2]);
  });

  it("treats an empty list as no day allowed", () => {
    const rule = restriction({ allowed_check_in_days: [] });
    expect(withRules([rule])).toEqual(rejected("check_in_day_not_allowed"));
  });
});

describe("checkNightsFree", () => {
  const free = (night: string, isAvailable = true) => ({ night, isAvailable });

  it("needs every night of [checkIn, checkOut)", () => {
    expect(
      checkNightsFree("2027-06-14", "2027-06-16", [
        free("2027-06-14"),
        free("2027-06-15"),
      ]),
    ).toEqual(OK);
  });

  it("does not need the check-out night, so turnover days work", () => {
    expect(
      checkNightsFree("2027-06-14", "2027-06-16", [
        free("2027-06-14"),
        free("2027-06-15"),
        free("2027-06-16", false),
      ]),
    ).toEqual(OK);
  });

  it("refuses when any night is taken", () => {
    expect(
      checkNightsFree("2027-06-14", "2027-06-16", [
        free("2027-06-14"),
        free("2027-06-15", false),
      ]),
    ).toEqual(rejected("dates_unavailable"));
  });

  it("treats a missing night as taken", () => {
    expect(checkNightsFree("2027-06-14", "2027-06-16", [])).toEqual(
      rejected("dates_unavailable"),
    );
  });
});
