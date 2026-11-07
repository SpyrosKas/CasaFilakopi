import { formatMoney } from "@/lib/email/format";
import { dedupeId } from "@/lib/email/queue";
import { queue, type PaymentDeps } from "./deps";

// Host alerts share the host_payment_failed template, whose reason line carries
// what happened. Each has a dedupe key, so a replayed event never mails twice.

export async function alertHost(
  deps: PaymentDeps,
  alert: {
    key: string;
    reason: string;
    bookingId?: string;
    amountCents?: number;
  },
): Promise<void> {
  const { key, ...data } = alert;
  await queue(deps, "host_payment_failed", data, {
    dedupeKey: `payment_alert:${key}`,
  });
}

const APOLOGY = {
  en: {
    subject:
      "We are sorry: your dates at Casa Filakopi are no longer available",
    body: (refund: string) =>
      `Hello,

We are very sorry. Your payment reached us, but the dates you chose were taken just before it did, so we could not confirm your stay.

We are refunding the full ${refund} to the card you used. Banks usually show it within 5 to 10 days. You do not need to do anything.

Yorgos will be in touch, and if you would like other dates he will gladly help. Just reply to this email.`,
  },
  el: {
    subject:
      "Λυπούμαστε: οι ημερομηνίες σας στο Casa Filakopi δεν είναι πια διαθέσιμες",
    body: (refund: string) =>
      `Γεια σας,

Λυπούμαστε πολύ. Η πληρωμή σας έφτασε, όμως οι ημερομηνίες που διαλέξατε κρατήθηκαν λίγο νωρίτερα, οπότε δεν μπορέσαμε να επιβεβαιώσουμε τη διαμονή σας.

Σας επιστρέφουμε ολόκληρο το ποσό των ${refund} στην κάρτα που χρησιμοποιήσατε. Οι τράπεζες συνήθως το εμφανίζουν μέσα σε 5 έως 10 ημέρες. Δεν χρειάζεται να κάνετε τίποτα.

Ο Γιώργος θα επικοινωνήσει μαζί σας, και αν θέλετε άλλες ημερομηνίες θα σας βοηθήσει με χαρά. Απλώς απαντήστε σε αυτό το email.`,
  },
};

/**
 * A booking that never confirmed has no reference, so the usual cancellation
 * template cannot send (it requires one). This uses the same row shape as a
 * message Yorgos writes in Admin, with a fixed id, so a replay cannot repeat it.
 */
export async function apologiseForLostDates(
  deps: PaymentDeps,
  bookingId: string,
  refundCents: number,
): Promise<void> {
  const { data: booking, error } = await deps.db
    .from("bookings")
    .select("guest_email, locale")
    .eq("id", bookingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!booking?.guest_email) return;

  const locale = booking.locale === "el" ? "el" : "en";
  const copy = APOLOGY[locale];
  const { data, error: insertError } = await deps.db
    .from("email_logs")
    .upsert(
      {
        id: dedupeId(`dates_lost:${bookingId}`),
        template_key: "host_message",
        recipient: booking.guest_email,
        locale,
        booking_id: bookingId,
        status: "queued",
        payload: {
          subject: copy.subject,
          body: copy.body(formatMoney(refundCents, locale)),
        },
      },
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");
  if (insertError) {
    // The refund is the part that matters, and the host has been told.
    console.error(`apology for ${bookingId}: ${insertError.message}`);
    return;
  }
  deps.queued.push(...data.map((row) => row.id));
}
