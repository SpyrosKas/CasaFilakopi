import "server-only";
import { z } from "zod";
import { DEFAULT_RULES, rulesSchema, type RulesInput } from "@/lib/admin/rules";
import type { AdminContext } from "@/lib/admin/session";
import type { Json } from "@/lib/db/types";

// Reads for the Owner screens, through the Owner's own client.

export async function loadProperty(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("property")
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The house is the only row in rooms for now (D1). */
export async function loadHouse(admin: AdminContext) {
  const { data, error } = await admin.supabase
    .from("rooms")
    .select(
      "id, name, description, max_adults, max_children, base_occupancy, is_active",
    )
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function loadSetting(
  admin: AdminContext,
  key: string,
): Promise<Json | null> {
  const { data, error } = await admin.supabase
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return data?.value ?? null;
}

const bookingSettings = z.looseObject({
  holdMinutes: z.number().default(35),
  checkoutSessionMinutes: z.number().default(30),
  sameDayCutoffHour: z.number().default(12),
  horizonMonths: z.number().default(18),
});

/** Keys this screen does not edit are kept as stored. */
export async function loadBookingSettings(admin: AdminContext) {
  return bookingSettings.parse((await loadSetting(admin, "booking")) ?? {});
}

/** The rules as stored, or the starting values if none are saved yet. */
export async function loadRules(admin: AdminContext): Promise<RulesInput> {
  const payment = await loadSetting(admin, "payment");
  const { data: policy, error } = await admin.supabase
    .from("cancellation_policies")
    .select("tiers, is_non_refundable")
    .eq("is_default", true)
    .maybeSingle();
  if (error) throw error;

  const parsed = rulesSchema.safeParse({
    payment: payment ?? DEFAULT_RULES.payment,
    cancellation: policy
      ? { isNonRefundable: policy.is_non_refundable, tiers: policy.tiers }
      : DEFAULT_RULES.cancellation,
  });
  return parsed.success ? parsed.data : DEFAULT_RULES;
}
