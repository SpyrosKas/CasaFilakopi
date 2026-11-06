import type { Tables } from "@/lib/db/types";
import type { Cents, IsoDate } from "./contracts";
import { basisPointsOf } from "./money";

export type PromoRow = Pick<
  Tables<"promo_codes">,
  | "code"
  | "kind"
  | "value"
  | "valid_from"
  | "valid_to"
  | "max_uses"
  | "used_count"
  | "room_ids"
  | "is_active"
>;

/**
 * BUSINESS DECISION, flagged for Yorgos: a promo also discounts the cleaning
 * fee, so a 100% code leaves only taxes and fees. Accommodation and extra
 * guests are always discounted; taxes and fees never are.
 */
export const PROMO_DISCOUNTS_CLEANING = true;

/** For Admin and server logs. Guests only ever see that a code failed. */
export type PromoRejection =
  | "not_found"
  | "inactive"
  | "not_yet_valid"
  | "expired"
  | "room_not_eligible"
  | "exhausted";

export type PromoCheck =
  { ok: true; promo: PromoRow } | { ok: false; reason: PromoRejection };

/** Case-insensitive, like the promo_codes_code index and create_hold. */
export function findPromo(rows: PromoRow[], code: string): PromoRow | null {
  const wanted = code.trim().toLowerCase();
  return rows.find((row) => row.code.toLowerCase() === wanted) ?? null;
}

/**
 * For display only. The same conditions run inside create_hold, which alone
 * counts the use, so a code shown as valid can still lose the race for its
 * last use. Validity is the booking date, not the stay, as in create_hold.
 */
export function checkPromo(
  promo: PromoRow | null,
  roomId: string,
  today: IsoDate,
): PromoCheck {
  const reject = (reason: PromoRejection): PromoCheck => ({
    ok: false,
    reason,
  });

  if (!promo) return reject("not_found");
  if (!promo.is_active) return reject("inactive");
  if (promo.valid_from !== null && today < promo.valid_from) {
    return reject("not_yet_valid");
  }
  if (promo.valid_to !== null && today > promo.valid_to) {
    return reject("expired");
  }
  if (promo.room_ids !== null && !promo.room_ids.includes(roomId)) {
    return reject("room_not_eligible");
  }
  if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
    return reject("exhausted");
  }
  return { ok: true, promo };
}

/** Never more than the base: value is basis points or cents, by kind. */
export function promoDiscount(promo: PromoRow, baseCents: Cents): Cents {
  const discount =
    promo.kind === "percent"
      ? basisPointsOf(baseCents, promo.value)
      : promo.value;
  return Math.min(discount, baseCents);
}
