"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import {
  basePricesSchema,
  bulkRatesSchema,
  clearRatesSchema,
  feeSchema,
  idSchema,
  promoSchema,
  restrictionSchema,
  seasonSchema,
} from "@/lib/admin/ops-schemas";
import { requireAdmin, requireOwner } from "@/lib/admin/session";
import { loadHouse } from "@/lib/admin/settings-data";
import { addDays, dayOfWeek, eachNight } from "@/lib/domain/dates";

// Prices, fees and promo codes are the Owner's. Staff may edit stay rules
// (migration 6 gives them that table). These write through the admin's own
// client, so RLS applies and the audit triggers name the person.

/** Postgres error codes. */
const OVERLAPS_EXISTING = "23P01";
const ALREADY_EXISTS = "23505";

function refreshRates() {
  revalidatePath("/admin/rates", "layout");
}

const nightsMatching = (from: string, to: string, weekdays: number[]) =>
  eachNight(from, addDays(to, 1)).filter((night) =>
    weekdays.includes(dayOfWeek(night)),
  );

function bulkFields(formData: FormData) {
  return {
    ...formFields(formData),
    weekdays: formData.getAll("weekdays").map(String),
  };
}

export async function setDailyPrices(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = bulkRatesSchema.safeParse(bulkFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { from, to, weekdays, price } = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const nights = nightsMatching(from, to, weekdays);
  if (nights.length === 0) return errorState(t.rates.nothingMatched);

  const { error } = await admin.supabase.from("rate_overrides").upsert(
    nights.map((night) => ({
      room_id: house.id,
      night,
      nightly_cents: price,
    })),
  );
  if (error) return errorState(t.common.somethingWrong);

  refreshRates();
  return okState(t.rates.applied(nights.length));
}

export async function clearDailyPrices(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = clearRatesSchema.safeParse(bulkFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { from, to, weekdays } = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const nights = nightsMatching(from, to, weekdays);
  if (nights.length === 0) return errorState(t.rates.nothingMatched);

  const { data, error } = await admin.supabase
    .from("rate_overrides")
    .delete()
    .eq("room_id", house.id)
    .in("night", nights)
    .select("night");
  if (error) return errorState(t.common.somethingWrong);

  refreshRates();
  return okState(t.rates.cleared(data.length));
}

export async function saveBasePrices(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = basePricesSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { base, cleaning, extraGuest } = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const { data, error } = await admin.supabase
    .from("rooms")
    .update({
      base_price_cents: base,
      cleaning_fee_cents: cleaning,
      extra_guest_fee_cents: extraGuest,
    })
    .eq("id", house.id)
    .select("id");
  if (error || data.length !== 1) return errorState(t.common.somethingWrong);

  refreshRates();
  return okState(t.common.saved);
}

export async function saveSeason(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = seasonSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { id, name, from, to, night, weekend } = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const row = {
    room_id: house.id,
    name,
    start_date: from,
    end_date: to,
    nightly_cents: night,
    weekend_cents: weekend,
  };
  const { error } = id
    ? await admin.supabase.from("seasons").update(row).eq("id", id)
    : await admin.supabase.from("seasons").insert(row);
  if (error) {
    return errorState(
      error.code === OVERLAPS_EXISTING
        ? t.rates.seasonOverlap
        : t.common.somethingWrong,
    );
  }
  refreshRates();
  return okState(t.common.saved);
}

export async function deleteSeason(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { error } = await admin.supabase
    .from("seasons")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.rates.deleted);
}

export async function saveRestriction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = restrictionSchema.safeParse({
    ...formFields(formData),
    days: formData.getAll("days").map(String),
  });
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const row = {
    room_id: house.id,
    start_date: value.from,
    end_date: value.to,
    min_stay: value.minStay,
    max_stay: value.maxStay,
    closed_to_arrival: value.noArrival,
    closed_to_departure: value.noDeparture,
    allowed_check_in_days: value.days.length > 0 ? value.days : null,
  };
  const { error } = value.id
    ? await admin.supabase.from("restrictions").update(row).eq("id", value.id)
    : await admin.supabase.from("restrictions").insert(row);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.common.saved);
}

export async function deleteRestriction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { error } = await admin.supabase
    .from("restrictions")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.rates.deleted);
}

export async function saveFee(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = feeSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const row = {
    name: { en: value.nameEn, el: value.nameEl },
    kind: value.kind,
    amount_cents: value.amount,
    rate_basis_points: value.points,
    is_vat: value.isVat,
    valid_from: value.validFrom,
    valid_to: value.validTo,
    is_active: value.isActive,
  };
  const { error } = value.id
    ? await admin.supabase.from("taxes_fees").update(row).eq("id", value.id)
    : await admin.supabase.from("taxes_fees").insert(row);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.common.saved);
}

export async function deleteFee(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { error } = await admin.supabase
    .from("taxes_fees")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.rates.deleted);
}

export async function savePromo(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = promoSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const row = {
    code: value.code,
    kind: value.kind,
    value: value.amount,
    valid_from: value.validFrom,
    valid_to: value.validTo,
    max_uses: value.maxUses,
    is_active: value.isActive,
  };
  const { error } = value.id
    ? await admin.supabase.from("promo_codes").update(row).eq("id", value.id)
    : await admin.supabase.from("promo_codes").insert(row);
  if (error) {
    return errorState(
      error.code === ALREADY_EXISTS
        ? t.rates.promoTaken
        : t.common.somethingWrong,
    );
  }
  refreshRates();
  return okState(t.common.saved);
}

export async function deletePromo(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { error } = await admin.supabase
    .from("promo_codes")
    .delete()
    .eq("id", parsed.data.id);
  if (error) return errorState(t.common.somethingWrong);
  refreshRates();
  return okState(t.rates.deleted);
}
