import type {
  BookingSettings,
  BreakdownInput,
  PromoRow,
  RestrictionRow,
  TaxFeeRow,
} from "@/lib/domain";
import type { PaymentRules, StayRequest } from "@/lib/domain/contracts";

export const ROOM_ID = "00000000-0000-4000-8000-000000000001";

/** The values in supabase/seed.sql, plus the defaulted keys. */
export const BOOKING: BookingSettings = {
  holdMinutes: 35,
  checkoutSessionMinutes: 30,
  sameDayCutoffHour: 12,
  horizonMonths: 18,
  weekendDays: [5, 6],
  minLeadDays: 0,
};

export const FULL: PaymentRules = {
  mode: "full",
  deposit: null,
  balanceDaysBefore: 14,
};

export const DEPOSIT_30: PaymentRules = {
  mode: "deposit",
  deposit: { kind: "percent", percent: 30 },
  balanceDaysBefore: 14,
};

export const ROOM = {
  is_active: true,
  max_adults: 4,
  max_children: 2,
  base_occupancy: 2,
  base_price_cents: 12000,
  extra_guest_fee_cents: 0,
  cleaning_fee_cents: 4000,
};

/** 09:00 in Athens on 1 June 2027, a Tuesday. */
export const NOW = new Date("2027-06-01T06:00:00Z");

export const stay = (overrides: Partial<StayRequest> = {}): StayRequest => ({
  roomId: ROOM_ID,
  checkIn: "2027-06-14",
  checkOut: "2027-06-17",
  adults: 2,
  children: 0,
  ...overrides,
});

export const restriction = (
  overrides: Partial<RestrictionRow> = {},
): RestrictionRow => ({
  start_date: "2027-06-01",
  end_date: "2027-06-30",
  min_stay: null,
  max_stay: null,
  closed_to_arrival: false,
  closed_to_departure: false,
  allowed_check_in_days: null,
  ...overrides,
});

export const fee = (overrides: Partial<TaxFeeRow> = {}): TaxFeeRow => ({
  name: { en: "Climate resilience fee", el: "Τέλος" },
  kind: "per_night",
  amount_cents: 200,
  rate_basis_points: null,
  is_vat: false,
  valid_from: null,
  valid_to: null,
  is_active: true,
  sort_order: 1,
  ...overrides,
});

export const promo = (overrides: Partial<PromoRow> = {}): PromoRow => ({
  code: "SUMMER",
  kind: "percent",
  value: 1000,
  valid_from: null,
  valid_to: null,
  max_uses: null,
  used_count: 0,
  room_ids: null,
  is_active: true,
  ...overrides,
});

export const breakdownInput = (
  overrides: Partial<BreakdownInput> = {},
): BreakdownInput => ({
  stay: stay(),
  room: ROOM,
  seasons: [],
  overrides: [],
  fees: [],
  weekendDays: BOOKING.weekendDays,
  payment: FULL,
  promo: null,
  now: NOW,
  ...overrides,
});
