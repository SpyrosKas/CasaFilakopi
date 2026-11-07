import { QuoteError } from "@/lib/domain/breakdown";
import {
  effectiveRestrictions,
  stayLengthLimits,
} from "@/lib/domain/availability";
import { nightlyPrices } from "@/lib/domain/pricing";
import type {
  IsoDate,
  Locale,
  PriceBreakdown,
  StayRejection,
  StayRequest,
} from "@/lib/domain/contracts";
import {
  addDays,
  addMonths,
  athensDate,
  athensHour,
  daysBetween,
} from "@/lib/domain/dates";
import {
  createAvailabilityService,
  createPricingService,
  loadRulesSnapshot,
} from "@/lib/domain/services";
import { parseBookingSettings } from "@/lib/domain/settings";
import { describeCancellation } from "@/lib/email/format";
import type { PaymentDeps } from "./deps";
import { turnstileReady } from "./env";
import { loadHouse } from "./room";
import type { QuoteRequest } from "./schemas";

// The calendar and the live price. Taken dates are a yes or no per night, so
// nothing here says whether a night is a booking, a block or an import (AVL-09).

const paymentsOpen = (deps: PaymentDeps) =>
  deps.stripe !== null && !!deps.guestTokenSecret && turnstileReady();

export interface AvailabilityView {
  today: IsoDate;
  /** The first date a stay can start, after lead time and the same-day cutoff. */
  firstCheckIn: IsoDate;
  /** The last night on sale. */
  lastNight: IsoDate;
  taken: IsoDate[];
  /** Price per night in cents for each night on sale, before extras. */
  prices: Record<IsoDate, number>;
  /** Shortest and longest stay from Admin's booking page. */
  minNights: number;
  maxNights: number;
  /** Stay rules for date ranges. The strictest wins on a check-in date. */
  stayRules: StayRuleView[];
  maxAdults: number;
  maxChildren: number;
  paymentsOpen: boolean;
}

export interface StayRuleView {
  from: IsoDate;
  to: IsoDate;
  min: number | null;
  max: number | null;
}

async function loadNightPrices(
  deps: PaymentDeps,
  roomId: string,
  from: IsoDate,
  lastNight: IsoDate,
  weekendDays: number[],
): Promise<Record<IsoDate, number>> {
  if (from > lastNight) return {};
  const [room, seasons, overrides] = await Promise.all([
    deps.db
      .from("rooms")
      .select(
        "base_price_cents, base_occupancy, extra_guest_fee_cents, cleaning_fee_cents",
      )
      .eq("id", roomId)
      .single(),
    deps.db
      .from("seasons")
      .select("start_date, end_date, nightly_cents, weekend_cents")
      .eq("room_id", roomId)
      .lte("start_date", lastNight)
      .gte("end_date", from),
    deps.db
      .from("rate_overrides")
      .select("night, nightly_cents")
      .eq("room_id", roomId)
      .gte("night", from)
      .lte("night", lastNight),
  ]);
  for (const result of [room, seasons, overrides]) {
    if (result.error) throw new Error(result.error.message);
  }
  const nights = nightlyPrices({
    stay: {
      roomId,
      checkIn: from,
      checkOut: addDays(lastNight, 1),
      adults: 1,
      children: 0,
    },
    room: room.data!,
    seasons: seasons.data!,
    overrides: overrides.data!,
    weekendDays,
  });
  return Object.fromEntries(nights.map(({ night, cents }) => [night, cents]));
}

export async function loadAvailability(
  deps: PaymentDeps,
): Promise<AvailabilityView | null> {
  // One round trip for both: each costs a trip to the database.
  const [house, { data, error }] = await Promise.all([
    loadHouse(deps),
    deps.db.from("settings").select("value").eq("key", "booking").single(),
  ]);
  if (!house) return null;
  if (error) throw new Error(error.message);
  const booking = parseBookingSettings(data.value);

  const now = deps.now();
  const today = athensDate(now);
  const lastNight = addMonths(today, booking.horizonMonths);
  const afterCutoff = athensHour(now) >= booking.sameDayCutoffHour;
  const firstCheckIn = addDays(
    today,
    Math.max(booking.minLeadDays, afterCutoff ? 1 : 0),
  );

  const calendar = await createAvailabilityService(deps.db).getCalendar(
    house.id,
    today,
    addDays(lastNight, 1),
  );
  const taken = calendar
    .filter((day) => !day.isAvailable)
    .map((day) => day.night);
  const takenSet = new Set(taken);

  const [allPrices, rules] = await Promise.all([
    loadNightPrices(
      deps,
      house.id,
      firstCheckIn,
      lastNight,
      booking.weekendDays,
    ),
    deps.db
      .from("restrictions")
      .select("start_date, end_date, min_stay, max_stay")
      .eq("room_id", house.id)
      .gte("end_date", firstCheckIn)
      .lte("start_date", lastNight),
  ]);
  if (rules.error) throw new Error(rules.error.message);
  // Only free nights carry a price, so a taken night says nothing more.
  const prices = Object.fromEntries(
    Object.entries(allPrices).filter(([night]) => !takenSet.has(night)),
  );

  return {
    today,
    firstCheckIn,
    lastNight,
    taken,
    prices,
    minNights: booking.minStayNights,
    maxNights: booking.maxStayNights,
    stayRules: rules.data.map((row) => ({
      from: row.start_date,
      to: row.end_date,
      min: row.min_stay,
      max: row.max_stay,
    })),
    maxAdults: house.maxAdults,
    maxChildren: house.maxChildren,
    paymentsOpen: paymentsOpen(deps),
  };
}

export interface PriceLineView {
  kind: string;
  label: string;
  quantity: number;
  unitCents: number;
  totalCents: number;
}

export type QuoteView =
  | {
      ok: true;
      nights: number;
      lines: PriceLineView[];
      totalCents: number;
      dueNowCents: number;
      balanceCents: number;
      balanceDueOn: IsoDate | null;
      /** 0 days before arrival in Admin means the balance is paid on arrival. */
      balanceOnArrival: boolean;
      promoApplied: boolean;
      promoRejected: boolean;
      cancellation: string | null;
      paymentsOpen: boolean;
    }
  | {
      ok: false;
      reason: StayRejection;
      minNights?: number;
      maxNights?: number;
    };

export function priceLines(
  breakdown: Pick<PriceBreakdown, "lines">,
  locale: Locale,
): PriceLineView[] {
  return breakdown.lines.map((line) => ({
    kind: line.kind,
    label: line.label[locale] ?? line.label.en ?? "",
    quantity: line.quantity,
    unitCents: line.unitCents,
    totalCents: line.totalCents,
  }));
}

async function lengthLimits(
  deps: PaymentDeps,
  stay: StayRequest,
): Promise<{ minNights: number; maxNights: number }> {
  const [restrictions, settings] = await Promise.all([
    deps.db
      .from("restrictions")
      .select(
        "start_date, end_date, min_stay, max_stay, closed_to_arrival, closed_to_departure, allowed_check_in_days",
      )
      .eq("room_id", stay.roomId)
      .lte("start_date", stay.checkOut)
      .gte("end_date", stay.checkIn),
    deps.db.from("settings").select("value").eq("key", "booking").single(),
  ]);
  if (restrictions.error) throw new Error(restrictions.error.message);
  if (settings.error) throw new Error(settings.error.message);
  return stayLengthLimits(
    effectiveRestrictions(restrictions.data, stay.checkIn, stay.checkOut),
    parseBookingSettings(settings.data.value),
  );
}

export async function quoteStay(
  deps: PaymentDeps,
  input: QuoteRequest,
): Promise<QuoteView> {
  const house = await loadHouse(deps);
  if (!house) return { ok: false, reason: "room_inactive" };

  const stay: StayRequest = {
    roomId: house.id,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    adults: input.adults,
    children: input.children,
  };

  const check = await createAvailabilityService(deps.db, deps.now).checkStay(
    stay,
  );
  if (!check.ok) {
    return {
      ok: false,
      reason: check.reason,
      ...(check.reason === "below_min_stay"
        ? { minNights: (await lengthLimits(deps, stay)).minNights }
        : {}),
      ...(check.reason === "above_max_stay"
        ? { maxNights: (await lengthLimits(deps, stay)).maxNights }
        : {}),
    };
  }

  const now = deps.now();
  let breakdown: PriceBreakdown;
  let cancellation: Awaited<
    ReturnType<typeof loadRulesSnapshot>
  >["cancellation"];
  try {
    // The price and the cancellation rules do not depend on each other.
    [breakdown, { cancellation }] = await Promise.all([
      createPricingService(deps.db).quote(
        { stay, promoCode: input.promoCode || undefined },
        now,
      ),
      loadRulesSnapshot(deps.db, now),
    ]);
  } catch (error) {
    if (error instanceof QuoteError) return { ok: false, reason: error.code };
    throw error;
  }
  return {
    ok: true,
    nights: daysBetween(input.checkIn, input.checkOut),
    lines: priceLines(breakdown, input.locale),
    totalCents: breakdown.totalCents,
    dueNowCents: breakdown.dueNowCents,
    balanceCents: breakdown.balanceCents,
    balanceDueOn: breakdown.balanceDueOn,
    balanceOnArrival: breakdown.balanceDueOn === input.checkIn,
    promoApplied: breakdown.promoCode !== null,
    promoRejected: breakdown.promoRejected === true,
    cancellation: describeCancellation(cancellation, input.locale),
    paymentsOpen: paymentsOpen(deps),
  };
}
