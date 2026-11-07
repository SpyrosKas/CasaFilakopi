import { z } from "zod";
import type { Database } from "@/lib/db/types";
import type {
  CancellationOutcome,
  CancellationRules,
} from "@/lib/domain/contracts";
import { addDays, athensDate, daysBetween } from "@/lib/domain/dates";
import { sumCents } from "@/lib/domain/money";
import { calculateRefund } from "@/lib/domain/refund";
import { parseCancellationTiers } from "@/lib/domain/settings";

// One shape for every stay at the house, whether it came through this website
// or from an Airbnb or Booking.com calendar. Pure, so every rule can be tested
// with hand-worked numbers.

type Enums = Database["public"]["Enums"];
export type BookingStatus = Enums["booking_status"];
export type BookingSource = Enums["booking_source"];
export type PaymentMethod = Enums["payment_method"];
export type StayStatus = BookingStatus | "imported";

export type StayTab = "upcoming" | "staying" | "past" | "cancelled";
export const STAY_TABS: StayTab[] = [
  "upcoming",
  "staying",
  "past",
  "cancelled",
];

/** PAY-11, worked out from payments and refunds. */
export type MoneyState =
  "unpaid" | "part_paid" | "paid" | "refunded" | "disputed" | "dates_only";

export interface PaymentRow {
  id: string;
  booking_id: string;
  kind: Enums["payment_kind"];
  method: PaymentMethod;
  status: Enums["payment_status"];
  amount_cents: number;
  note: string | null;
  paid_at: string | null;
  created_at: string;
}

export interface RefundRow {
  id: string;
  booking_id: string;
  payment_id: string;
  amount_cents: number;
  status: Enums["refund_status"];
  reason: string | null;
  created_at: string;
  settled_at: string | null;
}

export interface MoneySummary {
  /** Payments that went through, before any refund. */
  receivedCents: number;
  /** Refunds that went out, and any still in progress. */
  refundedCents: number;
  /** received minus refunded: what the house is holding for this booking. */
  paidCents: number;
  /** Held by the bank while a card dispute runs. Not counted as received. */
  disputedCents: number;
}

const amounts = (rows: { amount_cents: number }[]) =>
  sumCents(rows.map((row) => row.amount_cents));

/** Matches record_payment: a refund in progress already counts as gone. */
export function summariseMoney(
  payments: Pick<PaymentRow, "status" | "amount_cents">[],
  refunds: Pick<RefundRow, "status" | "amount_cents">[],
): MoneySummary {
  const receivedCents = amounts(
    payments.filter((row) => row.status === "succeeded"),
  );
  const refundedCents = amounts(
    refunds.filter((row) => row.status !== "failed"),
  );
  return {
    receivedCents,
    refundedCents,
    paidCents: receivedCents - refundedCents,
    disputedCents: amounts(payments.filter((row) => row.status === "disputed")),
  };
}

/**
 * O1: a refund on a live booking is goodwill and creates no debt, so what is
 * owed ignores refunds. Disputed money was paid and is with the bank, so it is
 * not asked for twice (D8).
 */
export const balanceOf = (money: MoneySummary, totalCents: number): number =>
  Math.max(totalCents - money.receivedCents - money.disputedCents, 0);

export function moneyState(
  money: MoneySummary,
  totalCents: number,
): MoneyState {
  if (money.disputedCents > 0) return "disputed";
  if (money.paidCents <= 0) {
    return money.refundedCents > 0 ? "refunded" : "unpaid";
  }
  return balanceOf(money, totalCents) === 0 ? "paid" : "part_paid";
}

const snapshotSchema = z.looseObject({
  cancellation: z.looseObject({
    isNonRefundable: z.boolean(),
    tiers: z.unknown(),
  }),
});

/** The rules agreed when this booking was made. Null if they cannot be read. */
export function snapshotRules(snapshot: unknown): CancellationRules | null {
  const parsed = snapshotSchema.safeParse(snapshot);
  if (!parsed.success) return null;
  try {
    const { isNonRefundable, tiers } = parsed.data.cancellation;
    return { isNonRefundable, tiers: parseCancellationTiers(tiers) };
  } catch {
    return null;
  }
}

/**
 * calculateRefund from the booking's own snapshot, never current settings.
 * Null when the snapshot cannot be read, so nobody acts on a guess.
 */
export function cancellationOutcome(input: {
  snapshot: unknown;
  checkIn: string;
  cancelledOn: string;
  totalCents: number;
  paidCents: number;
}): CancellationOutcome | null {
  const rules = snapshotRules(input.snapshot);
  if (!rules) return null;
  return calculateRefund({
    rules,
    checkIn: input.checkIn,
    cancelledOn: input.cancelledOn,
    totalCents: input.totalCents,
    paidCents: Math.max(input.paidCents, 0),
  });
}

export interface RefundShare {
  paymentId: string;
  amountCents: number;
}

export interface RefundPlan {
  /** Cash, bank or POS money that can be recorded as given back. */
  manual: RefundShare[];
  /** The part paid by card, which must go back through Stripe. */
  cardCents: number;
}

/** How much of one payment has not been refunded yet. */
export function refundableOf(
  payment: Pick<PaymentRow, "id" | "amount_cents">,
  refunds: Pick<RefundRow, "payment_id" | "status" | "amount_cents">[],
): number {
  return (
    payment.amount_cents -
    amounts(
      refunds.filter(
        (refund) =>
          refund.payment_id === payment.id && refund.status !== "failed",
      ),
    )
  );
}

/**
 * Which payments a refund comes out of. Manual payments first, newest first,
 * because only those can be settled here until the PAY track adds Stripe.
 */
export function planRefund(
  amountCents: number,
  payments: Pick<
    PaymentRow,
    "id" | "method" | "status" | "amount_cents" | "created_at"
  >[],
  refunds: Pick<RefundRow, "payment_id" | "status" | "amount_cents">[],
): RefundPlan {
  const manual: RefundShare[] = [];
  let remaining = amountCents;
  const usable = payments
    .filter((row) => row.status === "succeeded" && row.method !== "card")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  for (const payment of usable) {
    const share = Math.min(refundableOf(payment, refunds), remaining);
    if (share > 0) {
      manual.push({ paymentId: payment.id, amountCents: share });
      remaining -= share;
    }
  }
  return { manual, cardCents: remaining };
}

export interface Stay {
  kind: "booking" | "external";
  id: string;
  href: string;
  reference: string | null;
  status: StayStatus;
  source: BookingSource;
  checkIn: string;
  checkOut: string;
  nights: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  guestId: string | null;
  locale: string;
  adults: number | null;
  children: number | null;
  notes: string | null;
  /** Null for an import: iCal has no price. */
  totalCents: number | null;
  /** Only for an import, only for the Owner, only once he has typed it. */
  enteredCents: number | null;
  money: MoneySummary;
  moneyState: MoneyState;
  /** Still to pay. Always zero on a cancelled booking (D24). */
  balanceCents: number;
  /** Must still go back: after a cancellation, or paid above a new price. */
  toRefundCents: number;
  /** The nights this stay paid for. Empty for an import. */
  pricedNights: { night: string; cents: number }[];
  /** Imported dates that collide with something else at the house. */
  isConflicted: boolean;
  summary: string | null;
  createdAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
}

export interface BookingInput {
  id: string;
  reference: string | null;
  status: BookingStatus;
  source: BookingSource;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  guest_id: string;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_country: string | null;
  locale: string;
  special_requests: string | null;
  total_cents: number;
  price_breakdown: unknown;
  rules_snapshot: unknown;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
}

const pricedSchema = z.object({
  nights: z.array(z.object({ night: z.string(), cents: z.number().int() })),
  lines: z
    .array(z.object({ kind: z.string(), totalCents: z.number().int() }))
    .default([]),
});

const DISCOUNTED_LINES = ["accommodation", "extra_guest", "cleaning"];

/**
 * What the guest really paid for each night (O3). A promo comes off the house
 * lines together, so each night carries its share, with rounding kept so the
 * nights add up exactly.
 */
function nightsAfterPromo({
  nights,
  lines,
}: z.output<typeof pricedSchema>): { night: string; cents: number }[] {
  const of = (rows: { totalCents: number }[]) =>
    sumCents(rows.map((row) => row.totalCents));
  const discount = -of(lines.filter((line) => line.kind === "discount"));
  const base = of(lines.filter((line) => DISCOUNTED_LINES.includes(line.kind)));
  const nightsTotal = sumCents(nights.map((row) => row.cents));
  if (discount <= 0 || base <= 0 || nightsTotal <= 0) return nights;

  const off = Math.round((discount * nightsTotal) / base);
  let seen = 0;
  let given = 0;
  return nights.map(({ night, cents }) => {
    seen += cents;
    const target = Math.round((off * seen) / nightsTotal);
    const share = target - given;
    given = target;
    return { night, cents: cents - share };
  });
}

const OWES_BALANCE: BookingStatus[] = ["confirmed", "checked_in", "completed"];

export function stayFromBooking(
  booking: BookingInput,
  payments: Pick<PaymentRow, "status" | "amount_cents">[],
  refunds: Pick<RefundRow, "status" | "amount_cents">[],
): Stay {
  const money = summariseMoney(payments, refunds);
  const isCancelled =
    booking.status === "cancelled" || booking.status === "refunded";
  const outcome =
    isCancelled && booking.cancelled_at
      ? cancellationOutcome({
          snapshot: booking.rules_snapshot,
          checkIn: booking.check_in,
          cancelledOn: athensDate(new Date(booking.cancelled_at)),
          totalCents: booking.total_cents,
          paidCents: money.paidCents,
        })
      : null;
  const priced = pricedSchema.safeParse(booking.price_breakdown);
  const isLive = OWES_BALANCE.includes(booking.status);

  return {
    kind: "booking",
    id: booking.id,
    href: `/admin/bookings/${booking.id}`,
    reference: booking.reference,
    status: booking.status,
    source: booking.source,
    checkIn: booking.check_in,
    checkOut: booking.check_out,
    nights: daysBetween(booking.check_in, booking.check_out),
    name: booking.guest_name,
    email: booking.guest_email,
    phone: booking.guest_phone,
    country: booking.guest_country,
    guestId: booking.guest_id,
    locale: booking.locale,
    adults: booking.adults,
    children: booking.children,
    notes: booking.special_requests,
    totalCents: booking.total_cents,
    enteredCents: null,
    money,
    moneyState: moneyState(money, booking.total_cents),
    balanceCents: isLive ? balanceOf(money, booking.total_cents) : 0,
    toRefundCents:
      outcome?.refundCents ??
      (isLive ? Math.max(money.paidCents - booking.total_cents, 0) : 0),
    pricedNights: priced.success ? nightsAfterPromo(priced.data) : [],
    isConflicted: false,
    summary: null,
    createdAt: booking.created_at,
    confirmedAt: booking.confirmed_at,
    cancelledAt: booking.cancelled_at,
  };
}

export interface ExternalInput {
  id: string;
  start_date: string;
  end_date: string;
  summary: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  guest_notes: string | null;
  amount_cents: number | null;
  created_at: string;
  channel: Enums["channel"];
  is_conflicted: boolean;
}

const CHANNEL_SOURCE: Record<Enums["channel"], BookingSource> = {
  airbnb: "airbnb",
  booking_com: "booking_com",
  other_ical: "other",
};

export function stayFromExternal(event: ExternalInput): Stay {
  return {
    kind: "external",
    id: event.id,
    href: `/admin/bookings/external/${event.id}`,
    reference: null,
    status: "imported",
    source: CHANNEL_SOURCE[event.channel],
    checkIn: event.start_date,
    checkOut: event.end_date,
    nights: daysBetween(event.start_date, event.end_date),
    name: event.guest_name,
    email: event.guest_email,
    phone: event.guest_phone,
    country: null,
    guestId: null,
    locale: "en",
    adults: null,
    children: null,
    notes: event.guest_notes,
    totalCents: null,
    enteredCents: event.amount_cents,
    money: {
      receivedCents: 0,
      refundedCents: 0,
      paidCents: 0,
      disputedCents: 0,
    },
    moneyState: "dates_only",
    balanceCents: 0,
    toRefundCents: 0,
    pricedNights: [],
    isConflicted: event.is_conflicted,
    summary: event.summary,
    createdAt: event.created_at,
    confirmedAt: null,
    cancelledAt: null,
  };
}

/**
 * Which tab a stay belongs in. An arrival today stays in Upcoming until he
 * marks it arrived. A departure today is still Staying now. An abandoned
 * checkout is in no tab: it was never a booking.
 */
export function tabOf(stay: Stay, today: string): StayTab | null {
  switch (stay.status) {
    case "cancelled":
    case "refunded":
    case "no_show":
      return "cancelled";
    case "expired":
      return null;
    case "completed":
      return "past";
    case "checked_in":
      return "staying";
    case "pending_payment":
    case "confirmed":
    case "imported":
      if (stay.checkOut < today) return "past";
      return stay.checkIn < today ? "staying" : "upcoming";
  }
}

const COUNTS_AS_STAY: StayStatus[] = [
  "confirmed",
  "checked_in",
  "completed",
  "imported",
];

/** Holds the house: not cancelled, not abandoned, not a checkout in progress. */
export const isRealStay = (stay: Stay): boolean =>
  COUNTS_AS_STAY.includes(stay.status);

/** A filter of its own: imports he has not given an amount for yet. */
export const NO_AMOUNT = "no_amount";

export const isMissingAmount = (stay: Stay): boolean =>
  stay.kind === "external" && stay.enteredCents === null;

export interface StayFilters {
  tab: StayTab;
  search: string;
  from: string | null;
  to: string | null;
  status: string | null;
  source: string | null;
  money: string | null;
}

export function matchesSearch(stay: Stay, search: string): boolean {
  const wanted = search.trim().toLowerCase();
  if (!wanted) return true;
  return [stay.name, stay.email, stay.reference, stay.phone, stay.summary].some(
    (value) => value?.toLowerCase().includes(wanted),
  );
}

/** Every filter but the tab, which the tab counts need to leave out. */
export function matchesFilters(stay: Stay, filters: StayFilters): boolean {
  if (filters.status && stay.status !== filters.status) return false;
  if (filters.source && stay.source !== filters.source) return false;
  if (filters.money === NO_AMOUNT) {
    if (!isMissingAmount(stay)) return false;
  } else if (filters.money && stay.moneyState !== filters.money) {
    return false;
  }
  if (filters.from && stay.checkOut <= filters.from) return false;
  if (filters.to && stay.checkIn > filters.to) return false;
  return matchesSearch(stay, filters.search);
}

/** A chosen status of "expired" is the one way to see abandoned checkouts. */
export function filterStays(
  stays: Stay[],
  filters: StayFilters,
  today: string,
): Stay[] {
  const showAbandoned = filters.status === "expired";
  const rows = stays.filter(
    (stay) =>
      (showAbandoned || tabOf(stay, today) === filters.tab) &&
      matchesFilters(stay, filters),
  );
  // Soonest first for what is ahead, newest first for what is behind.
  const ahead = filters.tab === "upcoming" || filters.tab === "staying";
  return rows.sort((a, b) =>
    ahead
      ? a.checkIn.localeCompare(b.checkIn)
      : b.checkIn.localeCompare(a.checkIn),
  );
}

export interface GuestRecord {
  key: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  locale: string;
  stays: Stay[];
}

const hasContact = (stay: Stay) =>
  Boolean(stay.name || stay.email || stay.phone);

/**
 * Guests are built from their bookings, the same email being the same person.
 * Bookings with no email stay apart under their guest record. An import joins
 * only once he has added a name or contact to it.
 */
export function buildGuests(stays: Stay[]): GuestRecord[] {
  const groups = new Map<string, Stay[]>();
  for (const stay of stays) {
    if (stay.status === "expired" || stay.status === "pending_payment") {
      continue;
    }
    if (stay.kind === "external" && !hasContact(stay)) continue;
    const group =
      stay.email?.trim().toLowerCase() ??
      (stay.guestId ? `guest:${stay.guestId}` : `event:${stay.id}`);
    groups.set(group, [...(groups.get(group) ?? []), stay]);
  }

  return [...groups.values()]
    .map((group) => {
      const newest = [...group].sort((a, b) =>
        b.checkIn.localeCompare(a.checkIn),
      );
      const first = (pick: (stay: Stay) => string | null) =>
        newest.map(pick).find(Boolean) ?? null;
      const owner = group.find((stay) => stay.guestId);
      return {
        key: owner?.guestId ?? group[0].id,
        name: first((stay) => stay.name),
        email: first((stay) => stay.email),
        phone: first((stay) => stay.phone),
        country: first((stay) => stay.country),
        locale: owner?.locale ?? "en",
        stays: newest,
      };
    })
    .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
}

/** Money on a booking that never became a stay. */
export const holdsMoneyUnconfirmed = (stay: Stay): boolean =>
  (stay.status === "expired" || stay.status === "pending_payment") &&
  stay.money.paidCents > 0;

/** What the day looks like. An unmarked arrival today is listed as an arrival. */
export function dayPlan(stays: Stay[], today: string) {
  const real = stays.filter(isRealStay);
  const byArrival = (a: Stay, b: Stay) => a.checkIn.localeCompare(b.checkIn);
  return {
    arrivals: real.filter(
      (stay) => stay.checkIn === today && stay.status !== "checked_in",
    ),
    departures: real.filter(
      (stay) => stay.checkOut === today && stay.status !== "completed",
    ),
    inHouse: real.filter((stay) => tabOf(stay, today) === "staying"),
    next: real
      .filter(
        (stay) => stay.checkIn > today && stay.checkIn <= addDays(today, 60),
      )
      .sort(byArrival)
      .slice(0, 5),
    balances: real.filter((stay) => stay.balanceCents > 0).sort(byArrival),
    toGiveBack: stays.filter((stay) => stay.toRefundCents > 0).sort(byArrival),
    // The webhook can leave money on a booking that never completed (D7).
    moneyHeld: stays.filter(holdsMoneyUnconfirmed).sort(byArrival),
  };
}
