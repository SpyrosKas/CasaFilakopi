"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { callAdminRpc } from "@/lib/admin/audit";
import { errorState, okState, type ActionState } from "@/lib/admin/form-state";
import { findSubject } from "@/lib/admin/guest-data";
import { requireOwner } from "@/lib/admin/session";
import { t } from "@/lib/admin/strings";
import { createAdminClient } from "@/lib/db/admin";

const p = t.ops.privacy;

const schema = z.object({
  id: z.uuid(),
  understood: z.literal("on"),
});

/** Cannot be undone, so the box must be ticked, and the database decides. */
export async function anonymiseGuest(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const admin = await requireOwner();
  const parsed = schema.safeParse({
    id: formData.get("id"),
    understood: formData.get("understood"),
  });
  if (!parsed.success) return errorState(p.anonymiseMustConfirm);
  const { id } = parsed.data;

  let imported = false;
  try {
    const subject = await findSubject(createAdminClient(), id);
    if (!subject) return errorState(p.notFound);
    imported = subject.kind === "external";
    if (!imported) {
      await callAdminRpc(admin, "anonymise_guest", { p_guest_id: id });
    } else {
      await callAdminRpc(admin, "anonymise_external_guest", {
        p_event_id: id,
      });
    }
  } catch (error) {
    const message = (error as { message?: string }).message;
    if (message === "guest_has_stay") return errorState(p.hasStay);
    if (message === "guest_not_found") return errorState(p.notFound);
    throw error;
  }

  revalidatePath("/admin", "layout");
  // With no details left, an imported stay is no longer a guest to show.
  if (imported) redirect("/admin/guests");
  return okState(p.anonymiseDone);
}
