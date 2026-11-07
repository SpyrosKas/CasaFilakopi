"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { callAdminRpc } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { rulesSchema } from "@/lib/admin/rules";
import {
  bookingSettingsErrors,
  bookingSettingsSchema,
  houseSchema,
  propertySchema,
} from "@/lib/admin/schemas";
import { requireOwner } from "@/lib/admin/session";
import { loadBookingSettings, loadHouse } from "@/lib/admin/settings-data";
import type { Json } from "@/lib/db/types";

// Writes run through the Owner's own client, so RLS applies and the database
// triggers name the Owner in the audit log. saveRules uses the one secret-key
// call, because two tables must change together.

function asObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export async function saveProperty(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = propertySchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { instagram, facebook, ...fields } = parsed.data;

  const { data: before, error: readError } = await admin.supabase
    .from("property")
    .select("social_links")
    .maybeSingle();
  // Saving after a failed read would wipe the links this screen does not show.
  if (readError) return errorState(t.common.somethingWrong);

  // Keeps any other social links already stored.
  const social_links = {
    ...asObject(before?.social_links),
    instagram,
    facebook,
  };

  const { error } = await admin.supabase
    .from("property")
    .upsert({ id: true, ...fields, social_links });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/property");
  // The registration number is in every public footer (WEB-15).
  revalidatePath("/", "layout");
  return okState(t.common.saved);
}

export async function saveHouse(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = houseSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  const { data, error } = await admin.supabase
    .from("rooms")
    .update({
      name: { ...asObject(house.name), en: value.name_en, el: value.name_el },
      description: {
        ...asObject(house.description),
        en: value.description_en,
        el: value.description_el,
      },
      max_adults: value.max_adults,
      max_children: value.max_children,
      base_occupancy: value.base_occupancy,
    })
    .eq("id", house.id)
    .select("id");
  if (error || data.length !== 1) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/house");
  return okState(t.common.saved);
}

export async function saveBookingSettings(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, sayAll, t } = await adminI18n();

  const admin = await requireOwner();
  const parsed = bookingSettingsSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const stored = await loadBookingSettings(admin);
  const value = { ...stored, ...parsed.data };
  const fieldErrors = bookingSettingsErrors(value);
  if (fieldErrors) {
    return {
      status: "error",
      message: t.common.fixErrors,
      fieldErrors: sayAll(fieldErrors),
    };
  }

  const { error } = await admin.supabase.from("settings").upsert({
    key: "booking",
    is_public: false,
    value,
  });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/booking");
  return okState(t.common.saved);
}

export async function saveRules(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t, say } = await adminI18n();

  const admin = await requireOwner();

  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("rules")));
  } catch {
    return errorState(t.common.somethingWrong);
  }
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { payment, cancellation } = parsed.data;

  try {
    await callAdminRpc(admin, "save_rules", {
      p_payment: payment as unknown as NonNullable<Json>,
      p_tiers: cancellation.tiers as unknown as NonNullable<Json>,
      p_is_non_refundable: cancellation.isNonRefundable,
    });
  } catch {
    return errorState(t.common.somethingWrong);
  }

  revalidatePath("/admin/rules");
  return okState(t.rules.saved);
}
