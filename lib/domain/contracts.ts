// Shared contract for Waves 1 to 3 (T2.21). Tracks build against these types.
// Changing one after Gate 2 goes through LEAD.

export type Cents = number;
/** A calendar date in Europe/Athens, formatted YYYY-MM-DD. */
export type IsoDate = string;
export type Locale = "en" | "el";

export interface StayRequest {
  roomId: string;
  checkIn: IsoDate;
  /** Exclusive: the guest leaves this morning and the night is not charged. */
  checkOut: IsoDate;
  adults: number;
  children: number;
}

// Availability (Track ENGINE, AVL)

export interface NightAvailability {
  night: IsoDate;
  isAvailable: boolean;
}

export type StayRejection =
  | "dates_unavailable"
  | "room_inactive"
  | "invalid_dates"
  | "below_min_stay"
  | "above_max_stay"
  | "closed_to_arrival"
  | "closed_to_departure"
  | "check_in_day_not_allowed"
  | "lead_time_not_met"
  | "beyond_booking_horizon"
  | "over_capacity";

export type StayCheck = { ok: true } | { ok: false; reason: StayRejection };

// Pricing (Track ENGINE, BKG)

export type PriceLineKind =
  "accommodation" | "extra_guest" | "cleaning" | "fee" | "vat" | "discount";

export interface PriceLine {
  kind: PriceLineKind;
  /** Translated label, keyed by locale. */
  label: Record<string, string>;
  quantity: number;
  unitCents: Cents;
  totalCents: Cents;
}

/** Stored in bookings.price_breakdown. All amounts are whole cents. */
export interface PriceBreakdown {
  currency: "EUR";
  nights: { night: IsoDate; cents: Cents }[];
  lines: PriceLine[];
  totalCents: Cents;
  dueNowCents: Cents;
  balanceCents: Cents;
  balanceDueOn: IsoDate | null;
  promoCode: string | null;
}

// Rules Yorgos edits in Admin (D6). Copied onto each booking.

export type PaymentMode = "full" | "deposit" | "on_arrival";

export type DepositRule =
  { kind: "percent"; percent: number } | { kind: "fixed"; amountCents: Cents };

export interface PaymentRules {
  mode: PaymentMode;
  deposit: DepositRule | null;
  balanceDaysBefore: number;
}

export interface CancellationTier {
  /** Applies when cancelling at least this many days before check-in. */
  daysBefore: number;
  refundPercent: number;
}

export interface CancellationRules {
  isNonRefundable: boolean;
  tiers: CancellationTier[];
}

/** Stored in bookings.rules_snapshot. Editing settings never changes it. */
export interface RulesSnapshot {
  payment: PaymentRules;
  cancellation: CancellationRules;
  capturedAt: string;
}

// Function signatures implemented by Track ENGINE.

export interface PricingInput {
  stay: StayRequest;
  promoCode?: string;
}

export interface AvailabilityService {
  getCalendar(
    roomId: string,
    from: IsoDate,
    to: IsoDate,
  ): Promise<NightAvailability[]>;
  checkStay(stay: StayRequest): Promise<StayCheck>;
}

export interface PricingService {
  quote(input: PricingInput, now: Date): Promise<PriceBreakdown>;
}

export interface CancellationOutcome {
  refundCents: Cents;
  retainedCents: Cents;
  appliedTier: CancellationTier | null;
}

/** Pure. Uses the booking's snapshot, never current settings. */
export type CalculateRefund = (input: {
  rules: CancellationRules;
  checkIn: IsoDate;
  cancelledOn: IsoDate;
  paidCents: Cents;
}) => CancellationOutcome;

// Database operations (supabase/migrations/20261107000005_rpc.sql).

export type ConfirmOutcome =
  | { outcome: "confirmed"; reference: string }
  | { outcome: "already_confirmed"; reference: string }
  /** A second, different payment on a confirmed booking. Alert the host. */
  | { outcome: "extra_payment"; reference: string }
  /** Paid amount differs from the amount due. Not confirmed. Alert the host. */
  | { outcome: "amount_mismatch" }
  /** Money was taken but the dates are gone: refund and alert the host. */
  | { outcome: "dates_lost" };

/** Messages raised by the database functions. */
export type DbErrorCode =
  | "dates_unavailable"
  | "invalid_dates"
  | "room_inactive"
  | "hold_too_short"
  | "booking_not_found"
  | "invalid_transition"
  | "payment_not_found"
  | "refund_exceeds_payment"
  | "overpayment"
  | "calendar_not_found"
  | "empty_feed_refused"
  | "payment_intent_required"
  | "payment_booking_mismatch"
  | "payment_required"
  | "payment_not_refundable"
  | "refund_not_found"
  | "promo_unavailable"
  | "issued_invoice_immutable";
