import type { Tables } from "@/lib/db/types";
import type {
  IsoDate,
  NightAvailability,
  StayCheck,
  StayRejection,
  StayRequest,
} from "./contracts";
import {
  addDays,
  addMonths,
  athensDate,
  athensHour,
  dayOfWeek,
  daysBetween,
  eachNight,
  isValidIsoDate,
} from "./dates";
import type { BookingSettings } from "./settings";

// How restrictions apply to a stay, including one that spans several periods:
//
// - min_stay, max_stay and allowed_check_in_days come from the restrictions
//   covering the check-in date. A period the stay merely runs into never
//   changes them, so a 3-night minimum from 1 July does not touch a stay that
//   arrives on 30 June.
// - closed_to_arrival is read on the check-in date and closed_to_departure on
//   the check-out date. Nights in between are not checked for either.
// - Restrictions may overlap, as the schema allows it. The strictest wins: the
//   highest minimum, the lowest maximum, and only the days every one allows.
// - start_date and end_date are both inclusive.

/** public_availability refuses longer ranges, and no stay is this long. */
export const MAX_STAY_NIGHTS = 731;

export type RoomCapacity = Pick<
  Tables<"rooms">,
  "is_active" | "max_adults" | "max_children"
>;

export type RestrictionRow = Pick<
  Tables<"restrictions">,
  | "start_date"
  | "end_date"
  | "min_stay"
  | "max_stay"
  | "closed_to_arrival"
  | "closed_to_departure"
  | "allowed_check_in_days"
>;

export interface EffectiveRestrictions {
  minStay: number | null;
  maxStay: number | null;
  closedToArrival: boolean;
  closedToDeparture: boolean;
  /** Null means any day. Empty means none: nothing can arrive. */
  allowedCheckInDays: number[] | null;
}

const covers = (row: RestrictionRow, date: IsoDate) =>
  row.start_date <= date && date <= row.end_date;

export function effectiveRestrictions(
  restrictions: RestrictionRow[],
  checkIn: IsoDate,
  checkOut: IsoDate,
): EffectiveRestrictions {
  const onArrival = restrictions.filter((row) => covers(row, checkIn));
  const minStays = onArrival.flatMap((row) => row.min_stay ?? []);
  const maxStays = onArrival.flatMap((row) => row.max_stay ?? []);

  return {
    minStay: minStays.length ? Math.max(...minStays) : null,
    maxStay: maxStays.length ? Math.min(...maxStays) : null,
    closedToArrival: onArrival.some((row) => row.closed_to_arrival),
    closedToDeparture: restrictions.some(
      (row) => covers(row, checkOut) && row.closed_to_departure,
    ),
    allowedCheckInDays: onArrival.reduce<number[] | null>((days, row) => {
      const allowed = row.allowed_check_in_days;
      if (allowed === null) return days;
      return days === null
        ? allowed
        : days.filter((day) => allowed.includes(day));
    }, null),
  };
}

type RoomLimits = Pick<RoomCapacity, "max_adults" | "max_children">;

/** Capacity has a floor too: a stay needs at least one adult. */
export function fitsRoom(stay: StayRequest, room: RoomLimits): boolean {
  return (
    Number.isInteger(stay.adults) &&
    Number.isInteger(stay.children) &&
    stay.adults >= 1 &&
    stay.children >= 0 &&
    stay.adults <= room.max_adults &&
    stay.children <= room.max_children
  );
}

/** Well-formed dates in the right order. Says nothing about today. */
export function hasValidDates(stay: StayRequest): boolean {
  return (
    isValidIsoDate(stay.checkIn) &&
    isValidIsoDate(stay.checkOut) &&
    stay.checkIn < stay.checkOut
  );
}

/**
 * Lead time, in Athens time: check-in today closes at sameDayCutoffHour sharp,
 * and minLeadDays pushes the earliest check-in further out.
 */
function meetsLeadTime(
  checkIn: IsoDate,
  today: IsoDate,
  now: Date,
  booking: BookingSettings,
): boolean {
  if (daysBetween(today, checkIn) < booking.minLeadDays) return false;
  return checkIn !== today || athensHour(now) < booking.sameDayCutoffHour;
}

/**
 * Horizon: the last night, not only the arrival, must fall on or before the
 * date horizonMonths from today, so no stay runs past the prices on sale.
 */
function withinHorizon(
  checkOut: IsoDate,
  today: IsoDate,
  booking: BookingSettings,
): boolean {
  return addDays(checkOut, -1) <= addMonths(today, booking.horizonMonths);
}

export interface StayRulesInput {
  stay: StayRequest;
  /** Null when the room does not exist. */
  room: RoomCapacity | null;
  restrictions: RestrictionRow[];
  booking: BookingSettings;
  now: Date;
}

/** Everything except occupied nights. Pure. */
export function checkStayRules({
  stay,
  room,
  restrictions,
  booking,
  now,
}: StayRulesInput): StayCheck {
  const reject = (reason: StayRejection): StayCheck => ({ ok: false, reason });

  if (!hasValidDates(stay)) return reject("invalid_dates");
  const today = athensDate(now);
  // Matches create_hold, which refuses a check-in before today in Athens.
  if (stay.checkIn < today) return reject("invalid_dates");
  if (!room?.is_active) return reject("room_inactive");

  if (!fitsRoom(stay, room)) return reject("over_capacity");

  if (!meetsLeadTime(stay.checkIn, today, now, booking)) {
    return reject("lead_time_not_met");
  }
  if (!withinHorizon(stay.checkOut, today, booking)) {
    return reject("beyond_booking_horizon");
  }

  const nights = daysBetween(stay.checkIn, stay.checkOut);
  const rules = effectiveRestrictions(
    restrictions,
    stay.checkIn,
    stay.checkOut,
  );
  if (rules.minStay !== null && nights < rules.minStay) {
    return reject("below_min_stay");
  }
  if (
    nights > MAX_STAY_NIGHTS ||
    nights > booking.maxStayNights ||
    (rules.maxStay !== null && nights > rules.maxStay)
  ) {
    return reject("above_max_stay");
  }
  if (rules.closedToArrival) return reject("closed_to_arrival");
  if (rules.closedToDeparture) return reject("closed_to_departure");
  if (
    rules.allowedCheckInDays !== null &&
    !rules.allowedCheckInDays.includes(dayOfWeek(stay.checkIn))
  ) {
    return reject("check_in_day_not_allowed");
  }
  return { ok: true };
}

/** Every night must be reported free. A missing night counts as taken. */
export function checkNightsFree(
  checkIn: IsoDate,
  checkOut: IsoDate,
  calendar: NightAvailability[],
): StayCheck {
  const free = new Set(
    calendar.filter((day) => day.isAvailable).map((day) => day.night),
  );
  return eachNight(checkIn, checkOut).every((night) => free.has(night))
    ? { ok: true }
    : { ok: false, reason: "dates_unavailable" };
}
