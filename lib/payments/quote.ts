import { QuoteError } from "@/lib/domain/breakdown";
import { effectiveRestrictions } from "@/lib/domain/availability";
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
  maxAdults: number;
  maxChildren: number;
  paymentsOpen: boolean;
}

export async function loadAvailability(
  deps: PaymentDeps,
): Promise<AvailabilityView | null> {
  const house = await loadHouse(deps);
  if (!house) return null;

  const { data, error } = await deps.db
    .from("settings")
    .select("value")
    .eq("key", "booking")
    .single();
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
  return {
    today,
    firstCheckIn,
    lastNight,
    taken: calendar.filter((day) => !day.isAvailable).map((day) => day.night),
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
  | { ok: false; reason: StayRejection; minNights?: number };

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

async function minimumNights(
  deps: PaymentDeps,
  stay: StayRequest,
): Promise<number | undefined> {
  const { data, error } = await deps.db
    .from("restrictions")
    .select(
      "start_date, end_date, min_stay, max_stay, closed_to_arrival, closed_to_departure, allowed_check_in_days",
    )
    .eq("room_id", stay.roomId)
    .lte("start_date", stay.checkOut)
    .gte("end_date", stay.checkIn);
  if (error) throw new Error(error.message);
  return (
    effectiveRestrictions(data, stay.checkIn, stay.checkOut).minStay ??
    undefined
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
        ? { minNights: await minimumNights(deps, stay) }
        : {}),
    };
  }

  const now = deps.now();
  let breakdown: PriceBreakdown;
  try {
    breakdown = await createPricingService(deps.db).quote(
      { stay, promoCode: input.promoCode || undefined },
      now,
    );
  } catch (error) {
    if (error instanceof QuoteError) return { ok: false, reason: error.code };
    throw error;
  }

  const { cancellation } = await loadRulesSnapshot(deps.db, now);
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
