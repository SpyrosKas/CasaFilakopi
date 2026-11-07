import "server-only";
import type { ActionState } from "@/lib/admin/form-state";
import { errorState } from "@/lib/admin/form-state";
import { ADMIN_LANGUAGE, t } from "@/lib/admin/strings";
import { createAdminClient } from "@/lib/db/admin";
import { buildPriceBreakdown, QuoteError } from "@/lib/domain/breakdown";
import type {
  Cents,
  IsoDate,
  PriceBreakdown,
  StayRequest,
} from "@/lib/domain/contracts";
import { checkNightsFree } from "@/lib/domain/availability";
import { addDays } from "@/lib/domain/dates";
import { findPromo } from "@/lib/domain/promos";
import {
  createAvailabilityService,
  createPricingService,
} from "@/lib/domain/services";
import { parseBookingSettings, parsePaymentRules } from "@/lib/domain/settings";
import { nightsWord } from "@/lib/admin/format";

// Server helpers shared by the booking actions. Every price comes from
// lib/domain, on the server. Settings and rates are read with the secret key,
// as lib/domain/services.ts asks, so call these only after the role check.

export interface PricePreview {
  totalCents: Cents;
  lines: { label: string; cents: Cents }[];
  warnings: string[];
  /** Change of dates only. */
  previousCents?: Cents;
  /** Change of dates only: paid above the new price. */
  overpaidCents?: Cents;
}

export interface PreviewState extends ActionState {
  preview?: PricePreview;
}

/** The plain sentence for a message raised by the database. */
export function dbErrorMessage(error: unknown): string {
  const code = (error as { message?: unknown } | null)?.message;
  return (
    (typeof code === "string" ? t.act.errors[code] : undefined) ??
    t.common.somethingWrong
  );
}

export const dbErrorState = (error: unknown): ActionState =>
  errorState(dbErrorMessage(error));

const lineLabel = (line: PriceBreakdown["lines"][number]): string => {
  const name = line.label[ADMIN_LANGUAGE] ?? Object.values(line.label)[0] ?? "";
  return line.kind === "accommodation"
    ? `${name}, ${nightsWord(line.quantity)}`
    : name;
};

/**
 * A booking keeps the promo it was made with (D4), even if the code has since
 * expired or run out. The stored code goes to the domain's own pricing with its
 * limits lifted, so the price is worked out exactly as for a guest. A code that
 * was deleted comes back rejected, and the caller warns about it.
 */
async function quoteWithOwnPromo(
  client: ReturnType<typeof createAdminClient>,
  stay: StayRequest,
  code: string,
  now: Date,
): Promise<PriceBreakdown> {
  const lastNight = addDays(stay.checkOut, -1);
  const [room, seasons, overrides, fees, promos, settings] = await Promise.all([
    client
      .from("rooms")
      .select(
        "is_active, max_adults, max_children, base_price_cents, base_occupancy, extra_guest_fee_cents, cleaning_fee_cents",
      )
      .eq("id", stay.roomId)
      .maybeSingle(),
    client
      .from("seasons")
      .select("start_date, end_date, nightly_cents, weekend_cents")
      .eq("room_id", stay.roomId)
      .lte("start_date", lastNight)
      .gte("end_date", stay.checkIn),
    client
      .from("rate_overrides")
      .select("night, nightly_cents")
      .eq("room_id", stay.roomId)
      .gte("night", stay.checkIn)
      .lte("night", lastNight),
    client
      .from("taxes_fees")
      .select(
        "name, kind, amount_cents, rate_basis_points, is_vat, valid_from, valid_to, is_active, sort_order",
      )
      .eq("is_active", true),
    client
      .from("promo_codes")
      .select(
        "code, kind, value, valid_from, valid_to, max_uses, used_count, room_ids, is_active",
      ),
    client
      .from("settings")
      .select("key, value")
      .in("key", ["booking", "payment"]),
  ]);
  for (const result of [room, seasons, overrides, fees, promos, settings]) {
    if (result.error) throw result.error;
  }
  if (!room.data?.is_active) throw new QuoteError("room_inactive");

  const setting = (key: string) =>
    settings.data?.find((row) => row.key === key)?.value;
  const stored = findPromo(promos.data ?? [], code);

  return buildPriceBreakdown({
    stay,
    room: room.data,
    seasons: seasons.data ?? [],
    overrides: overrides.data ?? [],
    fees: fees.data ?? [],
    weekendDays: parseBookingSettings(setting("booking")).weekendDays,
    payment: parsePaymentRules(setting("payment")),
    promoCode: code,
    promo: stored && {
      ...stored,
      is_active: true,
      valid_from: null,
      valid_to: null,
      max_uses: null,
      room_ids: null,
    },
    now,
  });
}

export type QuoteResult =
  | { ok: true; breakdown: PriceBreakdown; warnings: string[] }
  | { ok: false; message: string };

/**
 * A price for a stay Yorgos is arranging himself. Website rules such as the
 * minimum stay do not stop him; they show as warnings. Taken dates do stop him
 * on a new booking. For a change of dates the booking's own nights look taken,
 * so there the database function alone decides.
 */
export async function quoteForAdmin(
  stay: StayRequest,
  options: {
    /** The code stored on the booking being changed. */
    ownPromoCode?: string;
    ownDatesAllowed: boolean;
    now?: Date;
  },
): Promise<QuoteResult> {
  const client = createAdminClient();
  const now = options.now ?? new Date();

  let breakdown: PriceBreakdown;
  try {
    breakdown = options.ownPromoCode
      ? await quoteWithOwnPromo(client, stay, options.ownPromoCode, now)
      : await createPricingService(client).quote({ stay }, now);
  } catch (error) {
    if (error instanceof QuoteError) {
      return {
        ok: false,
        message: t.stayForm.quoteError[error.code] ?? t.common.somethingWrong,
      };
    }
    throw error;
  }

  const availability = createAvailabilityService(client, () => now);
  // Website rules stop at their first problem, so taken nights are asked
  // about on their own: a far-off date must not hide them.
  if (!options.ownDatesAllowed) {
    const nights = await availability.getCalendar(
      stay.roomId,
      stay.checkIn,
      stay.checkOut,
    );
    if (!checkNightsFree(stay.checkIn, stay.checkOut, nights).ok) {
      return { ok: false, message: t.act.errors.dates_unavailable };
    }
  }

  const check = await availability.checkStay(stay);
  const warnings: string[] = [];
  if (!check.ok) {
    if (check.reason === "invalid_dates") {
      warnings.push(t.stayForm.warnPast);
    } else {
      const reason = t.stayForm.warnReason[check.reason];
      if (reason) warnings.push(reason, t.stayForm.warnAllowed);
    }
  }
  if (breakdown.promoRejected) warnings.push(t.stayForm.promoGone);
  return { ok: true, breakdown, warnings };
}

export function toPreview(
  breakdown: PriceBreakdown,
  warnings: string[],
): PricePreview {
  return {
    totalCents: breakdown.totalCents,
    lines: breakdown.lines.map((line) => ({
      label: lineLabel(line),
      cents: line.totalCents,
    })),
    warnings,
  };
}

/**
 * Nothing is taken online for a booking added by hand, so all of it stays to
 * be paid. create_manual_booking stores due_now_cents as 0, and this keeps the
 * stored breakdown saying the same.
 */
export function manualBreakdown(breakdown: PriceBreakdown): PriceBreakdown {
  return {
    ...breakdown,
    dueNowCents: 0,
    balanceCents: breakdown.totalCents,
    balanceDueOn: null,
  };
}

/**
 * The quote splits payment under today's settings. A booking keeps the rules
 * it was made with (D6), so its own snapshot decides when the balance is due,
 * and what was due at booking stays as it was, as modify_booking stores it.
 */
export function modifiedBreakdown(
  breakdown: PriceBreakdown,
  booking: {
    due_now_cents: number;
    rules_snapshot: unknown;
  },
  checkIn: IsoDate,
): PriceBreakdown {
  const dueNowCents = Math.min(booking.due_now_cents, breakdown.totalCents);
  const balanceCents = breakdown.totalCents - dueNowCents;
  const payment = parsePaymentRules(
    (booking.rules_snapshot as { payment?: unknown } | null)?.payment,
  );
  return {
    ...breakdown,
    dueNowCents,
    balanceCents,
    balanceDueOn:
      balanceCents > 0 && payment.mode === "deposit"
        ? addDays(checkIn, -payment.balanceDaysBefore)
        : null,
  };
}

/** The promo stored on a booking, so a change of dates keeps its discount. */
export function promoOf(priceBreakdown: unknown): string | undefined {
  const code = (priceBreakdown as { promoCode?: unknown } | null)?.promoCode;
  return typeof code === "string" && code ? code : undefined;
}
