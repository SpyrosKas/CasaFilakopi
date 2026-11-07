import {
  isMissingAmount,
  isRealStay,
  tabOf,
  type BookingSource,
  type Stay,
  type StayTab,
} from "@/lib/admin/stays";
import { athensDate, eachNight } from "@/lib/domain/dates";
import { sumCents } from "@/lib/domain/money";

// Income and activity for a month or a year. Pure, so every figure is checked
// against numbers worked out by hand.
//
// Each figure has one fixed meaning, stated on the screen:
//
// - Received counts money on the day it moved: payments that went through
//   less refunds that went out, by Athens date. A disputed payment is not
//   received; a refund in progress or failed has not left.
// - Entered is the amount he typed for an Airbnb or Booking.com stay. It has
//   no payment date, so it belongs to the month of arrival.
// - Booked value, still to come and owed all follow the month of arrival.
// - Nights are split night by night, so a stay across two months counts in
//   each. A cancelled stay or a no-show has no nights: the house was free.

export interface MoneyMove {
  bookingId: string;
  amountCents: number;
  status: string;
  /** When the money moved. */
  at: string;
}

export interface BlockedPeriod {
  start: string;
  /** Exclusive, like a check-out. */
  end: string;
}

export interface ReportInput {
  stays: Stay[];
  payments: MoneyMove[];
  refunds: MoneyMove[];
  blocks: BlockedPeriod[];
  today: string;
}

export interface Period {
  year: number;
  /** 1 to 12, or null for the whole year. */
  month: number | null;
}

export interface SourceLine {
  source: BookingSource;
  bookings: number;
  nights: number;
  /** Total price of stays arriving in the period. Null for imports. */
  bookedCents: number | null;
  /** Payments less refunds in the period. */
  receivedCents: number;
  /** Typed in by him. Imports only. */
  enteredCents: number;
  /** Imports with no amount yet. */
  noAmount: number;
}

export interface Report {
  from: string;
  to: string;
  money: {
    paymentsCents: number;
    refundsCents: number;
    /** Payments less refunds. */
    receivedCents: number;
    enteredCents: number;
    /** received + entered. */
    incomeCents: number;
    disputedCents: number;
    bookedCents: number;
    /** What guests still have to pay on stays yet to arrive. */
    expectedCents: number;
    /** Unpaid on stays that have started or finished. */
    owedCents: number;
    /** Money owed back after a cancellation. */
    toRefundCents: number;
  };
  bookings: {
    made: number;
    had: number;
    expected: number;
    cancelled: number;
    noShows: number;
  };
  nights: {
    booked: number;
    available: number;
    /** Tenths of a percent: 666 is 66.6%. Null with nothing to divide by. */
    occupancyTenths: number | null;
    /** What guests paid per night for the house, after promos (O3). */
    averageNightCents: number | null;
    /** How many nights that average covers. */
    pricedNights: number;
    /** Tenths of a night: 35 is 3.5. */
    averageStayTenths: number | null;
  };
  bySource: SourceLine[];
  noAmount: {
    stays: number;
    nights: number;
    /** Where the first of them is listed. */
    tab: StayTab;
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** First day, and the first day after the period. */
export function periodRange({ year, month }: Period): {
  from: string;
  to: string;
} {
  if (month === null) {
    return { from: `${year}-01-01`, to: `${year + 1}-01-01` };
  }
  return {
    from: `${year}-${pad(month)}-01`,
    to: month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`,
  };
}

const ratio = (part: number, whole: number, scale: number) =>
  whole > 0 ? Math.round((part * scale) / whole) : null;

const isCancelled = (stay: Stay) =>
  stay.status === "cancelled" || stay.status === "refunded";

/** Yet to come: a confirmed booking not arrived, or an import not started. */
function isExpected(stay: Stay, today: string): boolean {
  if (stay.status === "confirmed") return stay.checkIn >= today;
  return stay.kind === "external" && stay.checkIn >= today;
}

export function buildReport(input: ReportInput, period: Period): Report {
  const { stays, today } = input;
  const { from, to } = periodRange(period);
  const inPeriod = (date: string) => from <= date && date < to;
  const movedInPeriod = (move: MoneyMove) =>
    inPeriod(athensDate(new Date(move.at)));

  const sourceOf = new Map(stays.map((stay) => [stay.id, stay.source]));
  const lines = new Map<BookingSource, SourceLine>();
  const line = (source: BookingSource) => {
    const existing = lines.get(source);
    if (existing) return existing;
    const created: SourceLine = {
      source,
      bookings: 0,
      nights: 0,
      bookedCents: null,
      receivedCents: 0,
      enteredCents: 0,
      noAmount: 0,
    };
    lines.set(source, created);
    return created;
  };

  const payments = input.payments.filter(movedInPeriod);
  const paid = payments.filter((move) => move.status === "succeeded");
  const refunded = input.refunds.filter(
    (move) => move.status === "succeeded" && movedInPeriod(move),
  );
  const total = (moves: MoneyMove[]) =>
    sumCents(moves.map((move) => move.amountCents));

  for (const move of paid) {
    line(sourceOf.get(move.bookingId) ?? "other").receivedCents +=
      move.amountCents;
  }
  for (const move of refunded) {
    line(sourceOf.get(move.bookingId) ?? "other").receivedCents -=
      move.amountCents;
  }

  const real = stays.filter(isRealStay);
  const arriving = real.filter((stay) => inPeriod(stay.checkIn));

  // A set, because a colliding import can sit on the same night as a booking.
  const bookedNights = new Set<string>();
  const pricedHere: number[] = [];
  for (const stay of real) {
    const here = eachNight(stay.checkIn, stay.checkOut).filter(inPeriod);
    here.forEach((night) => bookedNights.add(night));
    if (here.length > 0) line(stay.source).nights += here.length;
    for (const { night, cents } of stay.pricedNights) {
      if (inPeriod(night)) pricedHere.push(cents);
    }
  }

  for (const stay of arriving) {
    const row = line(stay.source);
    row.bookings += 1;
    if (stay.kind === "booking") {
      row.bookedCents = (row.bookedCents ?? 0) + (stay.totalCents ?? 0);
    } else if (stay.enteredCents === null) {
      row.noAmount += 1;
    } else {
      row.enteredCents += stay.enteredCents;
    }
  }

  const blockedNights = new Set(
    input.blocks
      .flatMap((block) => eachNight(block.start, block.end))
      .filter((night) => inPeriod(night) && !bookedNights.has(night)),
  );
  const available = eachNight(from, to).length - blockedNights.size;

  const own = arriving.filter((stay) => stay.kind === "booking");
  const imported = arriving.filter((stay) => stay.kind === "external");
  const missing = imported.filter(isMissingAmount);
  const cancelledStays = stays.filter(isCancelled);
  const cancelledArrivals = cancelledStays.filter((stay) =>
    inPeriod(stay.checkIn),
  );

  const paymentsCents = total(paid);
  const refundsCents = total(refunded);
  const enteredCents = sumCents(imported.map((s) => s.enteredCents ?? 0));
  const expected = arriving.filter((stay) => isExpected(stay, today));

  return {
    from,
    to,
    money: {
      paymentsCents,
      refundsCents,
      receivedCents: paymentsCents - refundsCents,
      enteredCents,
      incomeCents: paymentsCents - refundsCents + enteredCents,
      disputedCents: total(
        payments.filter((move) => move.status === "disputed"),
      ),
      bookedCents: sumCents(own.map((stay) => stay.totalCents ?? 0)),
      expectedCents: sumCents(
        own
          .filter((stay) => isExpected(stay, today))
          .map((stay) => stay.balanceCents),
      ),
      owedCents: sumCents(
        own
          .filter((stay) => !isExpected(stay, today))
          .map((stay) => stay.balanceCents),
      ),
      toRefundCents: sumCents(
        cancelledArrivals.map((stay) => stay.toRefundCents),
      ),
    },
    bookings: {
      made: stays.filter((stay) => {
        const made =
          stay.kind === "external" ? stay.createdAt : stay.confirmedAt;
        return made !== null && inPeriod(athensDate(new Date(made)));
      }).length,
      had: arriving.length - expected.length,
      expected: expected.length,
      cancelled: cancelledStays.filter(
        (stay) =>
          stay.cancelledAt !== null &&
          inPeriod(athensDate(new Date(stay.cancelledAt))),
      ).length,
      noShows: stays.filter(
        (stay) => stay.status === "no_show" && inPeriod(stay.checkIn),
      ).length,
    },
    nights: {
      booked: bookedNights.size,
      available,
      occupancyTenths: ratio(bookedNights.size, available, 1000),
      averageNightCents: ratio(sumCents(pricedHere), pricedHere.length, 1),
      pricedNights: pricedHere.length,
      averageStayTenths: ratio(
        sumCents(arriving.map((stay) => stay.nights)),
        arriving.length,
        10,
      ),
    },
    bySource: [...lines.values()].sort((a, b) =>
      a.source.localeCompare(b.source),
    ),
    noAmount: {
      stays: missing.length,
      nights: sumCents(missing.map((stay) => stay.nights)),
      tab: (missing[0] && tabOf(missing[0], today)) ?? "upcoming",
    },
  };
}

export interface MonthBar {
  month: number;
  key: string;
  report: Report;
}

/** One report per month of a year, for the chart and the Excel file. */
export function monthlyReports(input: ReportInput, year: number): MonthBar[] {
  return Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    key: `${year}-${pad(index + 1)}`,
    report: buildReport(input, { year, month: index + 1 }),
  }));
}

/** The years with anything to show, newest first. */
export function yearsWithData(input: ReportInput, thisYear: number): number[] {
  const years = new Set([thisYear]);
  for (const stay of input.stays) {
    if (stay.status !== "expired") years.add(Number(stay.checkIn.slice(0, 4)));
  }
  for (const move of [...input.payments, ...input.refunds]) {
    years.add(Number(athensDate(new Date(move.at)).slice(0, 4)));
  }
  return [...years].sort((a, b) => b - a);
}
