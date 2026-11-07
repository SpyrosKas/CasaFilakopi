"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { callAdminRpc, callRecordingRpc } from "@/lib/admin/audit";
import { dbErrorState } from "@/lib/admin/booking-ops";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { blockSchema, idSchema } from "@/lib/admin/ops-schemas";
import { requireAdmin } from "@/lib/admin/session";
import { loadHouse } from "@/lib/admin/settings-data";
import { addDays } from "@/lib/domain/dates";

// Staff manage availability (ADM-02). Both go through the database functions,
// which take the room lock and keep inventory_claims right.

export async function closeDates(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = blockSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const house = await loadHouse(admin);
  if (!house) return errorState(t.house.missing);

  try {
    await callRecordingRpc(admin, "create_block", {
      p_room_id: house.id,
      p_start: value.from,
      // He picks the last night. The database holds the morning after it.
      p_end: addDays(value.lastNight, 1),
      p_reason: value.reason,
      p_note: value.note ?? undefined,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }
  revalidatePath("/admin", "layout");
  return okState(t.calendar.closed);
}

export async function reopenDates(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  try {
    await callAdminRpc(admin, "remove_block", { p_block_id: parsed.data.id });
  } catch (error) {
    return dbErrorState(error, t);
  }
  revalidatePath("/admin", "layout");
  return okState(t.calendar.reopened);
}
