"use server";

import { adminI18n } from "@/lib/admin/i18n-server";
import type { AdminI18n } from "@/lib/admin/i18n";
import type { AdminStrings } from "@/lib/admin/strings";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import {
  assertAdminRole,
  callAdminRpc,
  callRecordingRpc,
} from "@/lib/admin/audit";
import {
  dbErrorState,
  manualBreakdown,
  modifiedBreakdown,
  promoOf,
  quoteForAdmin,
  toPreview,
  type PreviewState,
} from "@/lib/admin/booking-ops";
import {
  errorState,
  formFields,
  fromZodError,
  okState,
  type ActionState,
} from "@/lib/admin/form-state";
import {
  cancelSchema,
  cardRefundSchema,
  changeDatesSchema,
  externalDetailsSchema,
  newBookingSchema,
  notesSchema,
  idSchema,
  paymentSchema,
  refundSchema,
  transitionSchema,
} from "@/lib/admin/ops-schemas";
import {
  requireAdmin,
  requireOwner,
  type AdminContext,
} from "@/lib/admin/session";
import { loadBooking, loadBookingMoney } from "@/lib/admin/stay-data";
import {
  balanceOf,
  cancellationOutcome,
  planRefund,
  summariseMoney,
  type BookingStatus,
} from "@/lib/admin/stays";
import { createAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";
import { athensDate } from "@/lib/domain/dates";
import { loadRulesSnapshot } from "@/lib/domain/services";
import { kickEmails, queueEmail, type QueueResult } from "@/lib/email";
import {
  closeBalanceSessions,
  settleBalanceSessions,
} from "@/lib/payments/balance";
import { queue } from "@/lib/payments/deps";
import { sendQueued } from "@/lib/payments/http";
import { planCardRefund } from "@/lib/payments/policy";
import { refundShares, type RefundRun } from "@/lib/payments/refunds";
import { paymentDeps } from "@/lib/payments/server";

// Staff may do booking work, so these use requireAdmin. Money moves only
// through the database functions, after the role check inside callAdminRpc.
// Nothing about price or refund is taken from the browser: the amounts sent
// back are only compared, so a stale screen cannot act on old numbers.

const houseError = (t: AdminStrings) => errorState(t.house.missing);

function refresh() {
  revalidatePath("/admin", "layout");
}

async function houseId(admin: AdminContext): Promise<string | null> {
  const { data, error } = await admin.supabase
    .from("rooms")
    .select("id")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function previewNewBooking(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const i18n = await adminI18n();
  const { t, say } = i18n;

  const admin = await requireAdmin();
  const parsed = newBookingSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const roomId = await houseId(admin);
  if (!roomId) return houseError(t);

  const quote = await quoteForAdmin(
    {
      roomId,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      adults: value.adults,
      children: value.children,
    },
    { ownDatesAllowed: false },
    t,
  );
  if (!quote.ok) return errorState(quote.message);
  return {
    status: "ok",
    preview: toPreview(manualBreakdown(quote.breakdown), quote.warnings, i18n),
  };
}

export async function createBooking(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const i18n = await adminI18n();
  const { say, t } = i18n;

  const admin = await requireAdmin();
  const parsed = newBookingSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const roomId = await houseId(admin);
  if (!roomId) return houseError(t);

  const now = new Date();
  const quote = await quoteForAdmin(
    {
      roomId,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      adults: value.adults,
      children: value.children,
    },
    { ownDatesAllowed: false, now },
    t,
  );
  if (!quote.ok) return errorState(quote.message);
  const breakdown = manualBreakdown(quote.breakdown);
  if (value.expectedTotal !== breakdown.totalCents) {
    return {
      ...errorState(t.stayForm.priceMoved),
      preview: toPreview(breakdown, quote.warnings, i18n),
    };
  }

  const snapshot = await loadRulesSnapshot(createAdminClient(), now);
  let bookingId: string;
  try {
    const result = await callAdminRpc(admin, "create_manual_booking", {
      p_room_id: roomId,
      p_check_in: value.checkIn,
      p_check_out: value.checkOut,
      p_adults: value.adults,
      p_children: value.children,
      p_guest: {
        name: value.name,
        email: value.email,
        phone: value.phone,
        country: value.country,
        locale: value.locale,
      },
      p_price_breakdown: breakdown as unknown as NonNullable<Json>,
      p_total_cents: breakdown.totalCents,
      p_rules_snapshot: snapshot as unknown as NonNullable<Json>,
      p_source: value.source,
      p_internal_notes: value.notes ?? undefined,
    });
    bookingId = (result as { booking_id: string }).booking_id;
  } catch (error) {
    return dbErrorState(error, t);
  }

  refresh();
  redirect(`/admin/bookings/${bookingId}`);
}

async function priceChange(
  admin: AdminContext,
  value: { id: string; checkIn: string; checkOut: string },
) {
  const i18n = await adminI18n();
  const { t } = i18n;

  const booking = await loadBooking(admin, value.id);
  if (!booking)
    return {
      ok: false as const,
      state: errorState(t.act.errors.booking_not_found),
    };

  const quote = await quoteForAdmin(
    {
      roomId: booking.room_id,
      checkIn: value.checkIn,
      checkOut: value.checkOut,
      adults: booking.adults,
      children: booking.children,
    },
    { ownPromoCode: promoOf(booking.price_breakdown), ownDatesAllowed: true },
    t,
  );
  if (!quote.ok) {
    return { ok: false as const, state: errorState(quote.message) };
  }
  const breakdown = modifiedBreakdown(quote.breakdown, booking, value.checkIn);
  const { payments, refunds } = await loadBookingMoney(admin, value.id);
  const { paidCents } = summariseMoney(payments, refunds);
  return {
    ok: true as const,
    booking,
    breakdown,
    preview: {
      ...toPreview(breakdown, quote.warnings, i18n),
      previousCents: booking.total_cents,
      overpaidCents: Math.max(paidCents - breakdown.totalCents, 0),
    },
  };
}

export async function previewChangeDates(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const { say } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = changeDatesSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  const priced = await priceChange(admin, parsed.data);
  if (!priced.ok) return priced.state;
  return { status: "ok", preview: priced.preview };
}

export async function changeDates(
  _previous: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = changeDatesSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const priced = await priceChange(admin, value);
  if (!priced.ok) return priced.state;
  if (value.expectedTotal !== priced.breakdown.totalCents) {
    return {
      ...errorState(t.stayForm.priceMoved),
      preview: priced.preview,
    };
  }

  try {
    await callAdminRpc(admin, "modify_booking", {
      p_booking_id: value.id,
      p_room_id: priced.booking.room_id,
      p_check_in: value.checkIn,
      p_check_out: value.checkOut,
      p_price_breakdown: priced.breakdown as unknown as NonNullable<Json>,
      p_total_cents: priced.breakdown.totalCents,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }

  // The balance has changed, so an open payment page asks for the wrong sum.
  await closeBalanceSessions(paymentDeps(), value.id);

  refresh();
  redirect(`/admin/bookings/${value.id}`);
}

export async function saveNotes(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = notesSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);

  try {
    await callAdminRpc(admin, "update_booking_notes", {
      p_booking_id: parsed.data.id,
      p_notes: parsed.data.notes,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }
  refresh();
  return okState(t.detail.notesSaved);
}

export async function markStay(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = transitionSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { id, to } = parsed.data;

  const booking = await loadBooking(admin, id);
  if (!booking) return errorState(t.act.errors.booking_not_found);
  if (to !== "completed" && booking.check_in > athensDate(new Date())) {
    return errorState(t.act.notYetArrived);
  }

  try {
    await callAdminRpc(admin, "transition_booking", {
      p_booking_id: id,
      p_status: to,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }
  refresh();
  return okState(t.common.saved);
}

const TAKES_PAYMENT: BookingStatus[] = [
  "confirmed",
  "checked_in",
  "completed",
  "no_show",
];

export async function recordPayment(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = paymentSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const booking = await loadBooking(admin, value.id);
  if (!booking) return errorState(t.act.errors.booking_not_found);
  if (!TAKES_PAYMENT.includes(booking.status)) {
    return errorState(t.act.notThisStatus);
  }

  const { payments, refunds } = await loadBookingMoney(admin, value.id);
  const money = summariseMoney(payments, refunds);
  // A second tab or a repeat tap saw other numbers, so it must not pay again.
  if (money.receivedCents !== value.expectedReceived) {
    return errorState(t.act.moneyMoved);
  }
  const balance = balanceOf(money, booking.total_cents);
  if (value.amount > balance) return errorState(t.act.errors.overpayment);
  const kind =
    payments.length > 0
      ? "balance"
      : value.amount === balance
        ? "full"
        : "deposit";

  try {
    await callRecordingRpc(admin, "record_payment", {
      p_booking_id: value.id,
      p_kind: kind,
      p_method: value.method,
      p_amount_cents: value.amount,
      p_note: value.note ?? undefined,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }

  // What is owed has changed, so an open payment page is now out of date.
  await closeBalanceSessions(paymentDeps(), value.id);

  refresh();
  return okState(t.act.paymentSaved);
}

/**
 * For cash, bank or card-machine money already given back. Card payments go
 * through refundToCard instead, so the record can never say money left that
 * did not.
 */
export async function recordRefund(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = refundSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const { payments, refunds } = await loadBookingMoney(admin, value.id);
  if (
    summariseMoney(payments, refunds).refundedCents !== value.expectedRefunded
  ) {
    return errorState(t.act.moneyMoved);
  }
  const payment = payments.find((row) => row.id === value.paymentId);
  if (!payment) return errorState(t.act.errors.payment_not_found);
  if (payment.method === "card") return errorState(t.act.cardNotHere);

  try {
    await callRecordingRpc(admin, "record_refund", {
      p_booking_id: value.id,
      p_payment_id: value.paymentId,
      p_amount_cents: value.amount,
      p_reason: value.reason ?? undefined,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }
  refresh();
  return okState(t.act.refundSaved);
}

/**
 * Owner only (O2). The secret key skips MFA, so the database is asked first.
 * Tells the guest about each refund Stripe accepted.
 */
async function sendCardRefund(
  admin: AdminContext,
  bookingId: string,
  shares: { paymentId: string; amountCents: number }[],
  reason: string | null,
): Promise<RefundRun | null> {
  const { data: role, error } = await admin.supabase.rpc("current_admin_role");
  if (error) throw error;
  if (role !== "owner") throw new Error("not_authorised");

  const deps = paymentDeps();
  if (!deps.stripe) return null;
  const run = await refundShares(deps, bookingId, shares, {
    reason: reason ?? undefined,
    actorId: admin.userId,
  });
  for (const refundId of run.refundIds) {
    await queue(deps, "refund_confirmation", { bookingId, refundId });
  }
  sendQueued(deps);
  return run;
}

function refundMessage(
  run: RefundRun,
  { t, formatEuro }: AdminI18n,
): ActionState {
  if (run.failedCents > 0) {
    return errorState(t.act.cardRefundFailed(formatEuro(run.failedCents)));
  }
  return run.unknownCents > 0
    ? errorState(t.act.cardRefundUnclear)
    : okState(t.act.cardRefundSent);
}

/**
 * PAY-06: reserve_refund, then Stripe, then settle_refund, across as many card
 * payments as the amount needs. A refund Stripe refuses releases its
 * reservation, so nothing says money left that did not.
 */
export async function refundToCard(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const i18n = await adminI18n();
  const { t, say } = i18n;
  const admin = await requireOwner();
  const parsed = cardRefundSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const { payments, refunds } = await loadBookingMoney(admin, value.id);
  if (
    summariseMoney(payments, refunds).refundedCents !== value.expectedRefunded
  ) {
    return errorState(t.act.moneyMoved);
  }
  const { shares, shortCents } = planCardRefund(
    value.amount,
    payments,
    refunds,
  );
  if (shortCents > 0) return errorState(t.act.errors.refund_exceeds_payment);

  let run: RefundRun | null;
  try {
    run = await sendCardRefund(admin, value.id, shares, value.reason);
  } catch (error) {
    return dbErrorState(error, t);
  }
  if (!run) return errorState(t.act.cardNotConnected);
  refresh();
  return refundMessage(run, i18n);
}

/** PAY-03. The link in the email is the guest's page, which works out the sum. */
export async function sendPaymentLink(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { t, say } = await adminI18n();
  const admin = await requireAdmin();
  const parsed = idSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const { id } = parsed.data;

  const booking = await loadBooking(admin, id);
  if (!booking) return errorState(t.act.errors.booking_not_found);
  if (!booking.guest_email) return errorState(t.act.sendLinkNoEmail);
  const { payments, refunds } = await loadBookingMoney(admin, id);
  const balance = balanceOf(
    summariseMoney(payments, refunds),
    booking.total_cents,
  );
  if (balance <= 0) return errorState(t.act.sendLinkNothing);

  await assertAdminRole(admin);
  // Each tap is a new email: the automatic one is keyed per booking.
  const result = await queueEmail(
    "balance_request",
    { bookingId: id },
    { dedupeKey: `balance_request:manual:${id}:${Date.now()}` },
  );
  if (!result.ok) return errorState(t.common.somethingWrong);
  await kickEmails(result.ids);
  refresh();
  return okState(t.act.sendLinkSent);
}

export async function cancelBooking(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = cancelSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  const booking = await loadBooking(admin, value.id);
  if (!booking) return errorState(t.act.errors.booking_not_found);
  if (booking.status === "cancelled" || booking.status === "refunded") {
    return errorState(t.cancel.alreadyCancelled);
  }
  // A checkout in progress ends by itself. Cancelling it could race the payment.
  if (booking.status !== "confirmed" && booking.status !== "checked_in") {
    return errorState(t.act.errors.invalid_transition);
  }

  const { payments, refunds } = await loadBookingMoney(admin, value.id);
  const money = summariseMoney(payments, refunds);
  // Worked out here, on the day it happens, from this booking's own snapshot.
  const outcome = cancellationOutcome({
    snapshot: booking.rules_snapshot,
    checkIn: booking.check_in,
    cancelledOn: athensDate(new Date()),
    totalCents: booking.total_cents,
    paidCents: money.paidCents,
  });
  if (!outcome) return errorState(t.detail.unreadableRules);
  if (outcome.refundCents !== value.expectedRefund) {
    return errorState(t.cancel.moved);
  }

  // A balance paid a moment ago changes what goes back.
  if (!(await settleBalanceSessions(paymentDeps(), value.id))) {
    return errorState(t.cancel.moved);
  }

  let cancelled: { outcome: string };
  try {
    cancelled = (await callAdminRpc(admin, "cancel_booking", {
      p_booking_id: value.id,
      p_reason: value.reason ?? undefined,
    })) as { outcome: string };
  } catch (error) {
    return dbErrorState(error, t);
  }
  // A second tap landed first, so the refund belongs to that request.
  if (cancelled.outcome !== "cancelled") {
    return errorState(t.cancel.alreadyCancelled);
  }

  const emails: string[] = [];
  const mail = (result: QueueResult) => {
    if (result.ok) emails.push(...result.ids);
  };
  mail(
    await queueEmail("booking_cancellation", {
      bookingId: value.id,
      refundCents: outcome.refundCents,
    }),
  );

  const plan = planRefund(outcome.refundCents, payments, refunds);
  if (value.gaveBack) {
    try {
      for (const share of plan.manual) {
        const refundId = await callRecordingRpc(admin, "record_refund", {
          p_booking_id: value.id,
          p_payment_id: share.paymentId,
          p_amount_cents: share.amountCents,
          p_reason: value.reason ?? undefined,
        });
        mail(
          await queueEmail("refund_confirmation", {
            bookingId: value.id,
            refundId,
          }),
        );
      }
    } catch {
      after(() => kickEmails(emails));
      refresh();
      return errorState(t.cancel.partial);
    }
  }

  after(() => kickEmails(emails));

  if (value.refundCard && plan.cardCents > 0) {
    const { shares } = planCardRefund(plan.cardCents, payments, refunds);
    let run: RefundRun | null = null;
    try {
      run = await sendCardRefund(admin, value.id, shares, value.reason);
    } catch {
      // Handled below: the amount stays on the booking as still to give back.
    }
    if (!run || run.failedCents > 0) {
      refresh();
      return errorState(t.cancel.cardFailed);
    }
    if (run.unknownCents > 0) {
      refresh();
      return errorState(t.act.cardRefundUnclear);
    }
  }

  refresh();
  redirect(`/admin/bookings/${value.id}`);
}

export async function saveExternalDetails(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const { say, t } = await adminI18n();

  const admin = await requireAdmin();
  const parsed = externalDetailsSchema.safeParse(formFields(formData));
  if (!parsed.success) return fromZodError(parsed.error, say);
  const value = parsed.data;

  // Only the Owner's save touches the amount. In a Staff request it is ignored,
  // and the function leaves what is stored, even mid-edit by the Owner.
  const isOwner = admin.role === "owner";
  try {
    await callAdminRpc(admin, "update_external_event_details", {
      p_event_id: value.id,
      p_guest_name: value.name ?? "",
      p_guest_email: value.email ?? "",
      p_guest_phone: value.phone ?? "",
      p_guest_notes: value.notes ?? "",
      // Null clears the amount. The generated type does not allow for that.
      p_amount_cents: (isOwner ? value.amount : null) as number,
      p_update_amount: isOwner,
    });
  } catch (error) {
    return dbErrorState(error, t);
  }
  refresh();
  return okState(t.external.saved);
}
