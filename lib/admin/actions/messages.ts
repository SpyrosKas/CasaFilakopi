"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import { revalidatePath } from "next/cache";
import { assertAdminRole, writeAudit } from "@/lib/admin/audit";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import { messageSchema, messageStatusSchema } from "@/lib/admin/ops-schemas";
import { requireAdmin, type AdminContext } from "@/lib/admin/session";
import {
  loadBooking,
  loadExternalStay,
  loadMessage,
} from "@/lib/admin/stay-data";
import { createAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";

/** The key a future sender looks for. It builds the email from the payload. */
const HOST_MESSAGE_TEMPLATE = "host_message";

interface Recipient {
  email: string | null;
  locale: string;
  bookingId: string | null;
  contactMessageId: string | null;
  payload: Record<string, Json>;
}

/** The address always comes from the stored record, never from the form. */
async function findRecipient(
  admin: AdminContext,
  target: "booking" | "external" | "contact",
  id: string,
): Promise<Recipient | null> {
  switch (target) {
    case "booking": {
      const booking = await loadBooking(admin, id);
      if (!booking) return null;
      return {
        email: booking.guest_email,
        locale: booking.locale,
        bookingId: booking.id,
        contactMessageId: null,
        payload: {},
      };
    }
    case "external": {
      const stay = await loadExternalStay(admin, id);
      if (!stay) return null;
      return {
        email: stay.email,
        locale: stay.locale,
        bookingId: null,
        contactMessageId: null,
        // No booking row to hang it on, so the page finds it through this.
        payload: { external_event_id: stay.id },
      };
    }
    case "contact": {
      const message = await loadMessage(admin, id);
      if (!message) return null;
      return {
        email: message.email,
        locale: message.locale,
        bookingId: message.booking_id,
        contactMessageId: message.id,
        payload: {},
      };
    }
  }
}

/**
 * Queues the message only. Sending needs Resend, which is not connected, and
 * the sender is another track's work. Plain text from the admin, with no guest
 * links, so nothing secret sits in the payload that Staff can read.
 */
export async function queueGuestMessage(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = messageSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { target, id, subject, body } = parsed.data;

  const recipient = await findRecipient(admin, target, id);
  if (!recipient) return errorState(t.common.somethingWrong);
  if (!recipient.email) return errorState(t.write.noEmail);

  // email_logs has no write access for signed-in users, so this uses the
  // secret key, which skips the MFA check: the role is checked first.
  await assertAdminRole(admin);
  const { data, error } = await createAdminClient()
    .from("email_logs")
    .insert({
      template_key: HOST_MESSAGE_TEMPLATE,
      recipient: recipient.email,
      locale: recipient.locale,
      booking_id: recipient.bookingId,
      contact_message_id: recipient.contactMessageId,
      status: "queued",
      payload: { ...recipient.payload, subject, body, sent_by: admin.userId },
    })
    .select("id")
    .single();
  if (error) return errorState(t.common.somethingWrong);

  await writeAudit(admin, {
    action: "queue",
    entity: "email_logs",
    entityId: data.id,
    after: { target, target_id: id, template_key: HOST_MESSAGE_TEMPLATE },
  });

  revalidatePath("/admin", "layout");
  return okState(t.write.queued);
}

export async function setMessageStatus(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = messageStatusSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const { data, error } = await admin.supabase
    .from("contact_messages")
    .update({ status: parsed.data.status, is_read: true })
    .eq("id", parsed.data.id)
    .select("id");
  if (error || data.length !== 1) return errorState(t.common.somethingWrong);

  revalidatePath("/admin", "layout");
  return okState(t.messages.moved);
}
