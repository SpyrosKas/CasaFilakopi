"use server";

import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { rulesSchema } from "@/lib/admin/rules";
import {
  bookingSettingsSchema,
  houseSchema,
  propertySchema,
} from "@/lib/admin/schemas";
import { requireOwner } from "@/lib/admin/session";
import { loadBookingSettings, loadHouse } from "@/lib/admin/settings-data";
import { t } from "@/lib/admin/strings";
import type { Json } from "@/lib/db/types";

// Every write here runs through the Owner's own client, so RLS applies and the
// database triggers name the Owner in the audit log.

function asObject(value: Json | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export async function saveProperty(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = propertySchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
  const { instagram, facebook, ...fields } = parsed.data;

  const { data: before } = await admin.supabase
    .from("property")
    .select("*")
    .maybeSingle();

  // Keeps any other social links already stored.
  const social_links = {
    ...asObject(before?.social_links),
    instagram,
    facebook,
  };

  const { data: after, error } = await admin.supabase
    .from("property")
    .upsert({ id: true, ...fields, social_links })
    .select()
    .single();
  if (error || !after) return errorState(t.common.somethingWrong);

  // The property table has no audit trigger.
  await writeAudit(admin, {
    action: before ? "update" : "insert",
    entity: "property",
    entityId: "true",
    before: before ?? null,
    after,
  });

  revalidatePath("/admin/property");
  return okState(t.common.saved);
}

export async function saveHouse(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = houseSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);
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
  const admin = await requireOwner();
  const parsed = bookingSettingsSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error);

  const stored = await loadBookingSettings(admin);
  const { error } = await admin.supabase.from("settings").upsert({
    key: "booking",
    is_public: false,
    value: { ...stored, ...parsed.data },
  });
  if (error) return errorState(t.common.somethingWrong);

  revalidatePath("/admin/booking");
  return okState(t.common.saved);
}

export async function saveRules(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();

  let input: unknown;
  try {
    input = JSON.parse(String(formData.get("rules")));
  } catch {
    return errorState(t.common.somethingWrong);
  }
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { payment, cancellation } = parsed.data;

  const { supabase } = admin;
  const { data: oldPolicy, error: readError } = await supabase
    .from("cancellation_policies")
    .select("id, tiers, is_non_refundable")
    .eq("is_default", true)
    .maybeSingle();
  if (readError) return errorState(t.common.somethingWrong);

  const policy = {
    tiers: cancellation.tiers as unknown as NonNullable<Json>,
    is_non_refundable: cancellation.isNonRefundable,
  };
  const { error: policyError } = oldPolicy
    ? await supabase
        .from("cancellation_policies")
        .update(policy)
        .eq("id", oldPolicy.id)
    : await supabase.from("cancellation_policies").insert({
        ...policy,
        name: { en: "Standard", el: "Τυπική" },
        is_default: true,
      });
  if (policyError) return errorState(t.common.somethingWrong);

  const { error: paymentError } = await supabase.from("settings").upsert({
    key: "payment",
    is_public: false,
    value: payment as unknown as NonNullable<Json>,
  });

  // Two tables cannot be saved in one step from here. Put the first one back
  // so a failure never leaves half of Yorgos's change in force.
  if (paymentError) {
    if (oldPolicy) {
      await supabase
        .from("cancellation_policies")
        .update({
          tiers: oldPolicy.tiers,
          is_non_refundable: oldPolicy.is_non_refundable,
        })
        .eq("id", oldPolicy.id);
    }
    return errorState(t.common.somethingWrong);
  }

  revalidatePath("/admin/rules");
  return okState(t.rules.saved);
}
