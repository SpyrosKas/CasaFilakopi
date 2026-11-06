import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import { checkNightsFree, checkStayRules, hasValidDates } from "./availability";
import { buildPriceBreakdown, QuoteError } from "./breakdown";
import type {
  AvailabilityService,
  CancellationRules,
  IsoDate,
  NightAvailability,
  PricingService,
  RulesSnapshot,
} from "./contracts";
import { addDays } from "./dates";
import { findPromo } from "./promos";
import { buildRulesSnapshot } from "./refund";
import {
  parseBookingSettings,
  parseCancellationTiers,
  parsePaymentRules,
} from "./settings";

// Thin database access. The rules live in the pure modules.
//
// Pass the secret-key client from lib/db/admin.ts. seasons, restrictions,
// taxes_fees and promo_codes are closed to anon and only admins can read them;
// RLS would return empty lists rather than an error, which looks like a house
// with no rules and no fees. The settings below are not public either, so a
// client without access fails on them loudly instead of pricing wrongly.

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

  const value = (key: string) => {
    const setting = settings.find((candidate) => candidate.key === key);
    if (!setting) throw new Error(`Missing setting: ${key}`);
    return setting.value;
  };
  return {
    booking: parseBookingSettings(value("booking")),
    payment: parsePaymentRules(value("payment")),
  };
}

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

/** `clock` exists for tests. checkStay's contract takes no `now`. */
export function createAvailabilityService(
  client: DomainClient,
  clock: () => Date = () => new Date(),
): AvailabilityService {
  return {
    getCalendar: (roomId, from, to) => loadCalendar(client, roomId, from, to),

    async checkStay(stay) {
      if (!hasValidDates(stay)) return { ok: false, reason: "invalid_dates" };

      const [settings, room, restrictions] = await Promise.all([
        loadSettings(client),
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

      const rules = checkStayRules({
        stay,
        room,
        restrictions,
        booking: settings.booking,
        now: clock(),
      });
      if (!rules.ok) return rules;

      return checkNightsFree(
        stay.checkIn,
        stay.checkOut,
        await loadCalendar(client, stay.roomId, stay.checkIn, stay.checkOut),
      );
    },
  };
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

export function createPricingService(client: DomainClient): PricingService {
  return {
    async quote({ stay, promoCode }, now) {
      if (!hasValidDates(stay)) throw new QuoteError("invalid_dates");
      const lastNight = addDays(stay.checkOut, -1);

      const [settings, room, seasons, overrides, fees, promo] =
        await Promise.all([
          loadSettings(client),
          client
            .from("rooms")
            .select(
              "is_active, base_price_cents, base_occupancy, extra_guest_fee_cents, cleaning_fee_cents",
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
    },
  };
}

/** The rules a new booking is sold under, for create_hold's p_rules_snapshot. */
export async function loadRulesSnapshot(
  client: DomainClient,
  now: Date,
): Promise<RulesSnapshot> {
  const [{ payment }, policy] = await Promise.all([
    loadSettings(client),
    client
      .from("cancellation_policies")
      .select("tiers, is_non_refundable")
      .eq("is_default", true)
      .eq("is_active", true)
      .maybeSingle()
      .then(row),
  ]);
  if (!policy) throw new Error("Missing default cancellation policy");

  const cancellation: CancellationRules = {
    isNonRefundable: policy.is_non_refundable,
    tiers: parseCancellationTiers(policy.tiers),
  };
  return buildRulesSnapshot(payment, cancellation, now);
}
