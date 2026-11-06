import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import { checkNightsFree, checkStayRules, hasValidDates } from "./availability";
import { buildPriceBreakdown, QuoteError } from "./breakdown";
import type {
  AvailabilityService,
  CancellationRules,
  CheckoutPaymentKind,
  CheckoutRejection,
  IsoDate,
  Locale,
  NightAvailability,
  PriceBreakdown,
  PricingInput,
  PricingService,
  RulesSnapshot,
  StayCheck,
  StayRequest,
} from "./contracts";
import { addDays } from "./dates";
import { paymentKindOf } from "./payments";
import { findPromo } from "./promos";
import { buildRulesSnapshot } from "./refund";
import {
  parseBookingSettings,
  parseCancellationTiers,
  parsePaymentRules,
  type BookingSettings,
} from "./settings";

// Thin database access. The rules live in the pure modules.
//
// Pass the secret-key client from lib/db/admin.ts. seasons, restrictions,
// taxes_fees and promo_codes are closed to anon and only admins can read them;
// RLS would return empty lists rather than an error, which looks like a house
// with no rules and no fees. The settings below are not public either, so a
// client without access fails on them loudly instead of pricing wrongly.
//
// Checkout routes use prepareCheckout and nothing else here: it is what makes
// the stay check, the price and the rules agree. The two services exist for
// the calendar and for showing a price.

export type DomainClient = SupabaseClient<Database>;

type DbResult<T> = { data: T | null; error: { message: string } | null };

function row<T>({ data, error }: DbResult<T>): T | null {
  if (error) throw new Error(error.message);
  return data;
}

function rows<T>({ data, error }: DbResult<T[]>): T[] {
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function loadSettings(client: DomainClient) {
  const settings = await client
    .from("settings")
    .select("key, value")
    .in("key", ["booking", "payment"])
    .then(rows);

  const value = (key: string) =>
    settings.find((candidate) => candidate.key === key)?.value;

  // No payment row means full payment (D6). There is no such fallback for
  // booking rules, so a client that cannot read settings still fails here.
  const booking = value("booking");
  if (booking === undefined) throw new Error("Missing setting: booking");
  return {
    booking: parseBookingSettings(booking),
    payment: parsePaymentRules(value("payment")),
  };
}

type Settings = Awaited<ReturnType<typeof loadSettings>>;

async function loadCalendar(
  client: DomainClient,
  roomId: string,
  from: IsoDate,
  to: IsoDate,
): Promise<NightAvailability[]> {
  const calendar = await client
    .rpc("public_availability", {
      p_room_id: roomId,
      p_from: from,
      p_to: to,
    })
    .then(rows);
  return calendar.map(({ night, is_available }) => ({
    night,
    isAvailable: is_available,
  }));
}

async function checkStayUnder(
  client: DomainClient,
  stay: StayRequest,
  booking: BookingSettings,
  now: Date,
): Promise<StayCheck> {
  const [room, restrictions] = await Promise.all([
    client
      .from("rooms")
      .select("is_active, max_adults, max_children")
      .eq("id", stay.roomId)
      .maybeSingle()
      .then(row),
    client
      .from("restrictions")
      .select(
        "start_date, end_date, min_stay, max_stay, closed_to_arrival, closed_to_departure, allowed_check_in_days",
      )
      .eq("room_id", stay.roomId)
      .lte("start_date", stay.checkOut)
      .gte("end_date", stay.checkIn)
      .then(rows),
  ]);

  const rules = checkStayRules({ stay, room, restrictions, booking, now });
  if (!rules.ok) return rules;

  return checkNightsFree(
    stay.checkIn,
    stay.checkOut,
    await loadCalendar(client, stay.roomId, stay.checkIn, stay.checkOut),
  );
}

// Matched in code: ilike would treat % and * in guest input as wildcards, and
// this table only ever holds a handful of rows.
async function loadPromo(client: DomainClient, code: string | undefined) {
  if (!code) return null;
  const promos = await client
    .from("promo_codes")
    .select(
      "code, kind, value, valid_from, valid_to, max_uses, used_count, room_ids, is_active",
    )
    .then(rows);
  return findPromo(promos, code);
}

async function quoteUnder(
  client: DomainClient,
  { stay, promoCode }: PricingInput,
  settings: Settings,
  now: Date,
): Promise<PriceBreakdown> {
  if (!hasValidDates(stay)) throw new QuoteError("invalid_dates");
  const lastNight = addDays(stay.checkOut, -1);

  const [room, seasons, overrides, fees, promo] = await Promise.all([
    client
      .from("rooms")
      .select(
        "is_active, max_adults, max_children, base_price_cents, base_occupancy, extra_guest_fee_cents, cleaning_fee_cents",
      )
      .eq("id", stay.roomId)
      .maybeSingle()
      .then(row),
    client
      .from("seasons")
      .select("start_date, end_date, nightly_cents, weekend_cents")
      .eq("room_id", stay.roomId)
      .lte("start_date", lastNight)
      .gte("end_date", stay.checkIn)
      .then(rows),
    client
      .from("rate_overrides")
      .select("night, nightly_cents")
      .eq("room_id", stay.roomId)
      .gte("night", stay.checkIn)
      .lte("night", lastNight)
      .then(rows),
    client
      .from("taxes_fees")
      .select(
        "name, kind, amount_cents, rate_basis_points, is_vat, valid_from, valid_to, is_active, sort_order",
      )
      .eq("is_active", true)
      .then(rows),
    loadPromo(client, promoCode?.trim()),
  ]);

  if (!room?.is_active) throw new QuoteError("room_inactive");

  return buildPriceBreakdown({
    stay,
    room,
    seasons,
    overrides,
    fees,
    weekendDays: settings.booking.weekendDays,
    payment: settings.payment,
    promoCode,
    promo,
    now,
  });
}

async function loadCancellationRules(
  client: DomainClient,
): Promise<CancellationRules> {
  const policy = await client
    .from("cancellation_policies")
    .select("tiers, is_non_refundable")
    .eq("is_default", true)
    .eq("is_active", true)
    .maybeSingle()
    .then(row);
  if (!policy) throw new Error("Missing default cancellation policy");

  return {
    isNonRefundable: policy.is_non_refundable,
    tiers: parseCancellationTiers(policy.tiers),
  };
}

/** `clock` exists for tests. checkStay's contract takes no `now`. */
export function createAvailabilityService(
  client: DomainClient,
  clock: () => Date = () => new Date(),
): AvailabilityService {
  return {
    getCalendar: (roomId, from, to) => loadCalendar(client, roomId, from, to),

    async checkStay(stay) {
      if (!hasValidDates(stay)) return { ok: false, reason: "invalid_dates" };
      const { booking } = await loadSettings(client);
      return checkStayUnder(client, stay, booking, clock());
    },
  };
}

export function createPricingService(client: DomainClient): PricingService {
  return {
    quote: async (input, now) =>
      quoteUnder(client, input, await loadSettings(client), now),
  };
}

/** Admin's manual bookings need this alone. Guests go through prepareCheckout. */
export async function loadRulesSnapshot(
  client: DomainClient,
  now: Date,
): Promise<RulesSnapshot> {
  const [{ payment }, cancellation] = await Promise.all([
    loadSettings(client),
    loadCancellationRules(client),
  ]);
  return buildRulesSnapshot(payment, cancellation, now);
}

export type HoldArgs = Database["public"]["Functions"]["create_hold"]["Args"];

/** The p_guest keys create_hold reads. */
export type CheckoutGuest = {
  name: string;
  email: string;
  locale: Locale;
  phone?: string;
  country?: string;
  arrival_time?: string;
  special_requests?: string;
  marketing_consent?: boolean;
};

export interface CheckoutInput extends PricingInput {
  guest: CheckoutGuest;
  termsVersion: string;
  tokenHash: string;
  tokenExpiresAt: string;
}

export type CheckoutPreparation =
  | {
      ok: true;
      /** Pass as is: client.rpc("create_hold", holdArgs). */
      holdArgs: HoldArgs;
      breakdown: PriceBreakdown;
      /** confirm_booking's p_kind. */
      paymentKind: CheckoutPaymentKind;
    }
  | { ok: false; reason: CheckoutRejection };

/**
 * The one way into a booking. Checks the stay, prices it and captures the
 * rules from a single read of settings, so the deposit charged and the rules
 * stored can never come from different versions of them. A code that fails is
 * a rejection, not a quiet full price. The guest sees only that it failed.
 */
export async function prepareCheckout(
  client: DomainClient,
  input: CheckoutInput,
  now: Date,
): Promise<CheckoutPreparation> {
  const { stay, promoCode } = input;
  if (!hasValidDates(stay)) return { ok: false, reason: "invalid_dates" };

  const settings = await loadSettings(client);
  const check = await checkStayUnder(client, stay, settings.booking, now);
  if (!check.ok) return check;

  try {
    const [breakdown, cancellation] = await Promise.all([
      quoteUnder(client, { stay, promoCode }, settings, now),
      loadCancellationRules(client),
    ]);
    if (breakdown.promoRejected) {
      return { ok: false, reason: "promo_unavailable" };
    }

    const snapshot = buildRulesSnapshot(settings.payment, cancellation, now);
    return {
      ok: true,
      breakdown,
      paymentKind: paymentKindOf(breakdown),
      holdArgs: {
        p_room_id: stay.roomId,
        p_check_in: stay.checkIn,
        p_check_out: stay.checkOut,
        p_adults: stay.adults,
        p_children: stay.children,
        p_guest: input.guest,
        p_price_breakdown: breakdown as unknown as Json,
        p_total_cents: breakdown.totalCents,
        p_due_now_cents: breakdown.dueNowCents,
        p_rules_snapshot: snapshot as unknown as Json,
        p_terms_version: input.termsVersion,
        p_token_hash: input.tokenHash,
        p_token_expires_at: input.tokenExpiresAt,
        p_hold_minutes: settings.booking.holdMinutes,
        p_promo_code: breakdown.promoCode ?? undefined,
      },
    };
  } catch (error) {
    // The room can change between the check and the price.
    if (error instanceof QuoteError) return { ok: false, reason: error.code };
    throw error;
  }
}
